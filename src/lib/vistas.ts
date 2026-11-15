/**
 * Respuestas compuestas para el panel: `inicio` y `articulo/get`.
 */

import type { PluginContentItem } from "emdash";

import { usuarioVista, type Usuario } from "./acceso.js";
import { leerAjustes, leerClaveApi } from "./ajustes.js";
import { minutosDeLectura } from "./bloques.js";
import { cambiosDeVuelta } from "./cambios.js";
import { comentarioVista } from "./comentarios.js";
import {
	camposDe,
	docDeDatos,
	leerNormalizada,
	portadaDe,
	publicacionDe,
	tituloDe,
	urlEditorDe,
	urlPublicaDe,
	type Entorno,
} from "./contenido.js";
import { preguntasPendientes } from "./preguntas.js";
import { comentariosDe, leerRevision, revisionNueva, sincronizar } from "./revisiones.js";
import { allRows, collections, lecturaId, revisionId } from "./store.js";
import { trabajoVista, ultimoTrabajo } from "./trabajos.js";
import type {
	Ajustes,
	ArticuloFila,
	ArticuloVista,
	ConfigVista,
	InicioVista,
	LecturaDoc,
	RevisionDoc,
	TrabajoDoc,
	TrabajoVista,
} from "./types.js";

const MAX_ENTRADAS = 500;

export async function configVista(env: Entorno, ajustes: Ajustes): Promise<ConfigVista> {
	const l = env.opciones.lectura;
	return {
		etiqueta: env.opciones.etiqueta ?? "Revisión",
		lectura: { cuerpo: l?.cuerpo ?? null, titulos: l?.titulos ?? null, css: l?.css ?? null },
		adminNombre: ajustes.adminNombre,
		motorHeTerminado: ajustes.motorHeTerminado,
		apiDisponible: !!(await leerClaveApi(env.opciones.claveApi ?? "ANTHROPIC_API_KEY")),
		requiereAprobacion: ajustes.requiereAprobacion,
	};
}

/** Progreso de lectura 0-100 sobre los bloques actuales. */
export function porcentajeLeido(lectura: LecturaDoc | null | undefined, claves: string[]): number {
	if (!lectura) return 0;
	if (lectura.completada) return 100;
	if (claves.length === 0) return 0;
	const vistos = new Set(lectura.bloquesVistos);
	const n = claves.filter((k) => vistos.has(k)).length;
	return Math.min(100, Math.round((n / claves.length) * 100));
}

// ─── Panorama (filas de todos los artículos) ───────────────────────

async function listarItems(env: Entorno): Promise<Array<{ collection: string; item: PluginContentItem }>> {
	const out: Array<{ collection: string; item: PluginContentItem }> = [];
	const content = env.ctx.content;
	if (!content) return out;
	for (const collection of Object.keys(env.opciones.collections)) {
		let cursor: string | undefined;
		for (;;) {
			const page = await content.list(collection, { limit: 100, cursor });
			for (const item of page.items) out.push({ collection, item });
			if (!page.hasMore || !page.cursor || page.cursor === cursor || out.length >= MAX_ENTRADAS) break;
			cursor = page.cursor;
		}
		if (out.length >= MAX_ENTRADAS) break;
	}
	return out.slice(0, MAX_ENTRADAS);
}

export interface Panorama {
	filas: ArticuloFila[];
	lecturas: Map<string, LecturaDoc>;
}

export async function panorama(env: Entorno, user: Usuario): Promise<Panorama> {
	const { ctx } = env;
	const cols = collections(ctx);
	const items = await listarItems(env);
	const revs = await cols.revisiones.getMany(items.map((i) => revisionId(i.collection, i.item.id)));
	const activos = await allRows(cols.trabajos, { where: { estado: { in: ["cola", "en_curso", "error", "conflicto"] } } }, 2000);
	const trabajoPor = new Map<string, { id: string; data: TrabajoDoc }>();
	for (const t of activos) {
		const k = revisionId(t.data.collection, t.data.entryId);
		const prev = trabajoPor.get(k);
		if (!prev || prev.data.creado < t.data.creado) trabajoPor.set(k, t);
	}
	const lecturasRows = await allRows(cols.lecturas, { where: { userId: user.id } }, 2000);
	const lecturas = new Map(lecturasRows.map((l) => [revisionId(l.data.collection, l.data.entryId), l.data]));

	const filas: ArticuloFila[] = [];
	for (const { collection, item } of items) {
		const k = revisionId(collection, item.id);
		const rev = revs.get(k) ?? revisionNueva(collection, item.id);
		const campos = camposDe(env.opciones, collection);
		const doc = docDeDatos(item.data, campos);
		let cambiosPendientes = 0;
		if (rev.estado === "cambios_por_ver") {
			cambiosPendientes = (await cambiosDeVuelta(env, collection, item.id, rev.vuelta)).filter((c) => c.veredicto === "pendiente").length;
		}
		const t = trabajoPor.get(k);
		filas.push({
			collection,
			id: item.id,
			slug: item.slug,
			titulo: tituloDe(item, campos),
			publicacion: publicacionDe(item),
			estado: rev.estado,
			vuelta: rev.vuelta,
			abiertos: rev.abiertos,
			preguntasPendientes: rev.preguntasPendientes,
			cambiosPendientes,
			aprobacion: rev.aprobacion,
			trabajo: t ? trabajoVista(t.id, t.data) : null,
			minutosLectura: minutosDeLectura(doc),
			actualizado: rev.actualizado > item.updatedAt ? rev.actualizado : item.updatedAt,
			leido: porcentajeLeido(lecturas.get(k), doc.content.map((b) => b._key)),
		});
	}
	const publicadoPrimero = (f: ArticuloFila) => (f.publicacion === "publicado" || f.publicacion === "publicado_con_cambios" ? 0 : 1);
	filas.sort((a, b) => publicadoPrimero(a) - publicadoPrimero(b) || a.titulo.localeCompare(b.titulo, env.opciones.locale ?? "es-ES"));
	return { filas, lecturas };
}

function seguirCon(p: Panorama): InicioVista["seguirCon"] {
	const porClave = new Map(p.filas.map((f) => [revisionId(f.collection, f.id), f]));
	const abiertas = [...p.lecturas.values()]
		.filter((l) => !l.completada)
		.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
	for (const l of abiertas) {
		const f = porClave.get(revisionId(l.collection, l.entryId));
		if (f && f.estado !== "aprobado") return { collection: f.collection, id: f.id, titulo: f.titulo, empezado: true };
	}
	const f = p.filas.find((x) => x.estado === "cambios_por_ver") ?? p.filas.find((x) => x.estado === "por_revisar");
	return f ? { collection: f.collection, id: f.id, titulo: f.titulo, empezado: false } : null;
}

export async function inicio(env: Entorno, user: Usuario): Promise<InicioVista> {
	const ajustes = await leerAjustes(env.ctx);
	const p = await panorama(env, user);
	const titulos = new Map(p.filas.map((f) => [revisionId(f.collection, f.id), f.titulo]));
	return {
		usuario: usuarioVista(user, ajustes),
		config: await configVista(env, ajustes),
		resumen: {
			total: p.filas.length,
			aprobados: p.filas.filter((f) => f.estado === "aprobado").length,
			porRevisar: p.filas.filter((f) => f.estado === "por_revisar").length,
			cambiosQueEsperan: p.filas.filter((f) => f.estado === "cambios_por_ver").length,
		},
		seguirCon: seguirCon(p),
		preguntas: await preguntasPendientes(env, titulos),
		articulos: p.filas,
	};
}

// ─── Artículo ──────────────────────────────────────────────────────

export async function articulo(env: Entorno, user: Usuario, collection: string, id: string): Promise<ArticuloVista> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	const entrada = await leerNormalizada(env, collection, id);
	const revision: RevisionDoc =
		(await sincronizar(env, collection, entrada.id, entrada.doc, entrada.hash)) ??
		(await leerRevision(ctx, collection, entrada.id));
	if (revision.hash === null) revision.hash = entrada.hash;

	const coms = await comentariosDe(ctx, collection, entrada.id);
	const comentarios = coms.map((c) => comentarioVista(c.id, c.data, user));
	const cambios = revision.estado === "cambios_por_ver" ? await cambiosDeVuelta(env, collection, entrada.id, revision.vuelta) : [];
	const noAplicados =
		revision.estado === "cambios_por_ver"
			? comentarios.filter(
					(c) => c.estado === "descartado" && !c.parentId && c.tipo === "comentario" && !!c.respuestaIA && c.vuelta < revision.vuelta,
				)
			: [];
	const ultimo = await ultimoTrabajo(ctx, collection, entrada.id);
	const trabajo: TrabajoVista | null = ultimo ? trabajoVista(ultimo.id, ultimo.data) : null;
	const lectura = await collections(ctx).lecturas.get(lecturaId(user.id, collection, entrada.id));

	const p = await panorama(env, user);
	const pendientes = p.filas.filter((f) => f.estado !== "aprobado");
	const sig =
		pendientes.find((f) => !(f.collection === collection && f.id === entrada.id) && f.estado === "cambios_por_ver") ??
		pendientes.find((f) => !(f.collection === collection && f.id === entrada.id) && f.estado === "por_revisar") ??
		pendientes.find((f) => !(f.collection === collection && f.id === entrada.id));

	return {
		usuario: usuarioVista(user, ajustes),
		config: await configVista(env, ajustes),
		articulo: {
			collection,
			id: entrada.id,
			slug: entrada.item.slug,
			doc: entrada.doc,
			portada: portadaDe(entrada.item, entrada.campos),
			publicacion: publicacionDe(entrada.item),
			urlPublica: await urlPublicaDe(env, entrada),
			urlEditor: urlEditorDe(collection, entrada.id),
			draftRevisionId: entrada.draftRevisionId,
			hash: entrada.hash,
			minutosLectura: minutosDeLectura(entrada.doc),
		},
		revision,
		comentarios,
		cambios,
		noAplicados,
		trabajo,
		lectura: lectura ?? null,
		leyoVersionAnterior: !!lectura?.completada,
		siguiente: sig ? { collection: sig.collection, id: sig.id, titulo: sig.titulo } : null,
		pendientesTotal: pendientes.length,
	};
}
