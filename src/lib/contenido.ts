/**
 * Lectura y escritura del contenido revisable.
 *
 * - Leer: `ctx.content.getVersioned` devuelve el borrador fusionado (si hay un
 *   borrador pendiente, `item.data` es el del borrador) y el `_rev` para publicar.
 * - Escribir: `ctx.content.update(collection, id, campos)`. En EmDash 1.4.0
 *   `ContentWriteInput` es un objeto plano campo → valor (no `{ data }`), y la
 *   escritura es «draft-aware»: en colecciones con revisiones va al borrador.
 *   Las escrituras de un plugin NO disparan `content:afterSave`; aun así se
 *   marcan en `propias` por si una versión futura las notificara.
 */

import { PluginRouteError } from "emdash";
import type { PluginContentItem, PluginContext } from "emdash";

import type { OpcionesColeccion, RevisionPluginOptions } from "../index.js";
import { normalizarClaves } from "./bloques.js";
import { hashDoc } from "./hash.js";
import type { DocRevisable, PTNode, Publicacion } from "./types.js";

export interface Entorno {
	ctx: PluginContext;
	opciones: RevisionPluginOptions;
	/** Escrituras propias pendientes de confirmar: `collection:id:hash`. */
	propias: Set<string>;
}

export interface CamposColeccion {
	titulo: string;
	extracto: string | null;
	contenido: string;
	referencias: string | null;
	portada: string | null;
	campoRevisado: string | null;
	urlPublica: string | null;
}

export function camposDe(opciones: RevisionPluginOptions, collection: string): CamposColeccion {
	const o: OpcionesColeccion | undefined = Object.hasOwn(opciones.collections, collection)
		? opciones.collections[collection]
		: undefined;
	if (!o) throw PluginRouteError.notFound(`La colección «${collection}» no está en revisión.`);
	return {
		titulo: o.titulo ?? "title",
		extracto: o.extracto === undefined ? "excerpt" : o.extracto,
		contenido: o.contenido ?? "content",
		referencias: o.referencias === undefined ? "references" : o.referencias,
		portada: o.portada === undefined ? "featured_image" : o.portada,
		campoRevisado: o.campoRevisado ?? null,
		urlPublica: o.urlPublica ?? null,
	};
}

export function coleccionConfigurada(opciones: RevisionPluginOptions, collection: string): boolean {
	return Object.hasOwn(opciones.collections, collection);
}

// ─── Documento ─────────────────────────────────────────────────────

function texto(v: unknown): string {
	if (typeof v === "string") return v;
	if (v === null || v === undefined) return "";
	return String(v);
}

function contenidoPT(v: unknown): PTNode[] {
	if (Array.isArray(v)) return v as PTNode[];
	if (typeof v === "string" && v.trim().startsWith("[")) {
		try {
			const parsed = JSON.parse(v) as unknown;
			if (Array.isArray(parsed)) return parsed as PTNode[];
		} catch {
			/* no es PT */
		}
	}
	return [];
}

export function docDeDatos(data: Record<string, unknown>, c: CamposColeccion): DocRevisable {
	return {
		titulo: texto(data[c.titulo]),
		extracto: c.extracto ? texto(data[c.extracto]) : "",
		referencias: c.referencias ? texto(data[c.referencias]) : "",
		content: contenidoPT(data[c.contenido]),
	};
}

/** Campos de contenido que difieren entre dos documentos, listos para `update`. */
export function camposCambiados(antes: DocRevisable, despues: DocRevisable, c: CamposColeccion): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	if (antes.titulo !== despues.titulo) data[c.titulo] = despues.titulo;
	if (c.extracto && antes.extracto !== despues.extracto) data[c.extracto] = despues.extracto;
	if (c.referencias && antes.referencias !== despues.referencias) data[c.referencias] = despues.referencias;
	if (JSON.stringify(antes.content) !== JSON.stringify(despues.content)) data[c.contenido] = despues.content;
	return data;
}

// ─── Lectura ───────────────────────────────────────────────────────

export interface Entrada {
	collection: string;
	id: string;
	item: PluginContentItem;
	/** `_rev` para publicar; null si el host no ofrece getVersioned. */
	rev: string | null;
	campos: CamposColeccion;
	doc: DocRevisable;
	hash: string;
	draftRevisionId: string | null;
}

export async function leerEntrada(env: Entorno, collection: string, id: string): Promise<Entrada> {
	const campos = camposDe(env.opciones, collection);
	const content = env.ctx.content;
	if (!content) throw PluginRouteError.internal("El plugin no tiene acceso al contenido (content:read).");
	let item: PluginContentItem | null;
	let rev: string | null = null;
	if (content.getVersioned) {
		const v = await content.getVersioned(collection, id);
		item = v?.item ?? null;
		rev = v?._rev ?? null;
	} else {
		item = await content.get(collection, id);
	}
	if (!item) throw PluginRouteError.notFound("No se encuentra el artículo.");
	const doc = docDeDatos(item.data, campos);
	return {
		collection,
		id: item.id,
		item,
		rev,
		campos,
		doc,
		hash: await hashDoc(doc),
		draftRevisionId: item.draftRevisionId ?? null,
	};
}

/**
 * Lee la entrada y garantiza claves `_key` presentes y únicas. Si hubo que
 * normalizarlas, guarda el contenido (las anclas necesitan claves estables).
 */
export async function leerParaAnclar(env: Entorno, collection: string, id: string): Promise<Entrada> {
	const entrada = await leerEntrada(env, collection, id);
	const { content, cambiado } = normalizarClaves(entrada.doc.content);
	if (!cambiado) return entrada;
	return escribirDoc(env, entrada, { ...entrada.doc, content });
}

/** Igual que leerEntrada pero sin guardar: claves normalizadas solo en memoria. */
export async function leerNormalizada(env: Entorno, collection: string, id: string): Promise<Entrada> {
	const entrada = await leerEntrada(env, collection, id);
	const { content, cambiado } = normalizarClaves(entrada.doc.content);
	if (!cambiado) return entrada;
	const doc = { ...entrada.doc, content };
	return { ...entrada, doc, hash: await hashDoc(doc) };
}

// ─── Escritura ─────────────────────────────────────────────────────

export function clavePropia(collection: string, id: string, hash: string): string {
	return `${collection}:${id}:${hash}`;
}

/** Escribe campos sueltos (p. ej. `campoRevisado`). */
export async function escribirCampos(
	env: Entorno,
	collection: string,
	id: string,
	data: Record<string, unknown>,
	hashEsperado?: string,
): Promise<void> {
	if (Object.keys(data).length === 0) return;
	const content = env.ctx.content;
	if (!content?.update) throw PluginRouteError.internal("El plugin no puede escribir contenido (content:write).");
	if (hashEsperado) env.propias.add(clavePropia(collection, id, hashEsperado));
	await content.update(collection, id, data);
}

/** Guarda los campos que cambian entre `entrada.doc` y `nuevo`, y devuelve la entrada releída. */
export async function escribirDoc(env: Entorno, entrada: Entrada, nuevo: DocRevisable): Promise<Entrada> {
	const data = camposCambiados(entrada.doc, nuevo, entrada.campos);
	if (Object.keys(data).length === 0) return entrada;
	const hash = await hashDoc(nuevo);
	await escribirCampos(env, entrada.collection, entrada.id, data, hash);
	const releida = await leerEntrada(env, entrada.collection, entrada.id);
	// Si el host devuelve otra cosa (normalización propia), la que vale es la releída.
	if (releida.hash !== hash) env.propias.add(clavePropia(entrada.collection, entrada.id, releida.hash));
	return releida;
}

// ─── Publicación y enlaces ─────────────────────────────────────────

export function publicacionDe(item: PluginContentItem): Publicacion {
	if (item.status === "published") {
		const conBorrador = !!item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId;
		return conBorrador ? "publicado_con_cambios" : "publicado";
	}
	if (item.status === "scheduled") return "programado";
	return "sin_publicar";
}

export async function urlPublicaDe(env: Entorno, entrada: Pick<Entrada, "collection" | "id" | "item" | "campos">): Promise<string | null> {
	const { item, campos } = entrada;
	if (item.status !== "published") return null;
	if (campos.urlPublica && item.slug) {
		const prefijo = campos.urlPublica.endsWith("/") ? campos.urlPublica : `${campos.urlPublica}/`;
		return env.ctx.url(`${prefijo.startsWith("/") ? "" : "/"}${prefijo}${item.slug}`);
	}
	try {
		return (await env.ctx.content?.getPublicUrl?.(entrada.collection, entrada.id)) ?? null;
	} catch {
		return null;
	}
}

export function urlEditorDe(collection: string, id: string): string {
	return `/_emdash/admin/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

export function portadaDe(item: PluginContentItem, campos: CamposColeccion): { url: string; alt: string } | null {
	if (!campos.portada) return null;
	const v = item.data[campos.portada];
	if (!v || typeof v !== "object") return null;
	const img = v as { src?: unknown; url?: unknown; alt?: unknown; asset?: { url?: unknown } };
	const url = [img.src, img.url, img.asset?.url].find((u): u is string => typeof u === "string" && u.length > 0);
	if (!url) return null;
	return { url, alt: typeof img.alt === "string" ? img.alt : "" };
}

export function tituloDe(item: PluginContentItem, campos: CamposColeccion): string {
	const t = item.data[campos.titulo];
	return typeof t === "string" && t.trim() ? t : (item.slug ?? item.id);
}
