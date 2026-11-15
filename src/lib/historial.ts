/**
 * Historial de versiones: listar y ver copias, restaurar (y publicar), y las
 * copias que guardan los hooks (publicación y ediciones en el editor nativo).
 */

import { PluginRouteError } from "emdash";
import type { ContentPolicyEvent } from "emdash";

import { buscarUsuario, esAdmin, puedePublicar, type Usuario } from "./acceso.js";
import { aprobacionVigente, publicar } from "./aprobacion.js";
import { leerAjustes } from "./ajustes.js";
import { normalizarClaves } from "./bloques.js";
import {
	camposDe,
	clavePropia,
	coleccionConfigurada,
	docDeDatos,
	escribirDoc,
	leerEntrada,
	type Entorno,
	type Entrada,
} from "./contenido.js";
import { hashDoc } from "./hash.js";
import { auditar, leerRevision, reanclar, recalcular } from "./revisiones.js";
import { collections } from "./store.js";
import type { Aprobacion, HistorialVista, VersionDetalle, VersionDoc } from "./types.js";
import { compararDocs, guardarVersion, resumenDe, versionesDe, versionVista } from "./versiones.js";

export const MOTIVO_RESTAURAR = "Antes de restaurar una versión";
export const MOTIVO_EDITOR = "Antes de una edición en el editor";

/** «Versión publicada hasta el 15 nov». */
export function motivoPublicada(fecha: Date, locale = "es-ES"): string {
	let texto: string;
	try {
		texto = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(fecha);
	} catch {
		texto = fecha.toISOString().slice(0, 10);
	}
	return `Versión publicada hasta el ${texto.replace(/\.$/, "")}`;
}

async function leerVersion(env: Entorno, id: string): Promise<VersionDoc> {
	const v = await collections(env.ctx).versiones.get(id);
	if (!v) throw PluginRouteError.notFound("No se encuentra esa versión. Puede que se haya borrado al guardar copias más nuevas.");
	if (!coleccionConfigurada(env.opciones, v.collection)) {
		throw PluginRouteError.notFound(`La colección «${v.collection}» no está en revisión.`);
	}
	return v;
}

/** Texto publicado ahora mismo (columnas vivas), o null si no está publicado. */
async function docPublicado(env: Entorno, collection: string, id: string): Promise<{ hash: string } | null> {
	try {
		const item = await env.ctx.content?.get(collection, id);
		if (!item || item.status !== "published") return null;
		return { hash: await hashDoc(docDeDatos(item.data, camposDe(env.opciones, collection))) };
	} catch {
		return null;
	}
}

// ─── Rutas ─────────────────────────────────────────────────────────

export async function listarVersiones(env: Entorno, input: { collection: string; id: string }): Promise<HistorialVista> {
	const entrada = await leerEntrada(env, input.collection, input.id);
	const vista = (rows: Array<{ id: string; data: VersionDoc }>) =>
		rows.map((r) => versionVista(r.id, r.data, entrada.doc, entrada.hash));
	return {
		cambios: vista(await versionesDe(env.ctx, input.collection, entrada.id, "cambio")),
		publicaciones: vista(await versionesDe(env.ctx, input.collection, entrada.id, "publicacion")),
		actual: { hash: entrada.hash },
		publicada: await docPublicado(env, input.collection, entrada.id),
	};
}

export async function verVersion(env: Entorno, id: string): Promise<VersionDetalle> {
	const v = await leerVersion(env, id);
	const entrada = await leerEntrada(env, v.collection, v.entryId);
	const comparacion = v.hash === entrada.hash ? [] : compararDocs(v.doc, entrada.doc);
	return {
		version: {
			id,
			tipo: v.tipo,
			motivo: v.motivo,
			fecha: v.fecha,
			nombre: v.nombre,
			resumen: resumenDe(comparacion),
			igualQueActual: v.hash === entrada.hash,
			doc: v.doc,
		},
		comparacion,
	};
}

export type RespuestaRestaurar =
	| { collection: string; entryId: string; restaurada: boolean; urlPublica?: string | null }
	| { requiereConfirmacion: true; motivo: string; aprobacion: Aprobacion | null };

/**
 * Restaura una copia en el borrador. Antes guarda el texto actual como copia
 * («Antes de restaurar una versión»), así que se puede deshacer. Con
 * `publicar`, publica después con las mismas reglas que «Publicar ahora»; si
 * hace falta confirmar, no toca nada hasta recibir `confirmar: true`.
 */
export async function restaurarVersion(
	env: Entorno,
	user: Usuario,
	input: { id: string; publicar?: boolean; confirmar?: boolean },
): Promise<RespuestaRestaurar> {
	const { ctx } = env;
	const v = await leerVersion(env, input.id);
	const entrada = await leerEntrada(env, v.collection, v.entryId);

	if (input.publicar) {
		if (!puedePublicar(user)) throw PluginRouteError.forbidden("No tienes permiso para publicar.");
		if (!ctx.content?.publish || !ctx.content.getVersioned) {
			throw PluginRouteError.internal("El plugin no puede publicar (falta la capacidad content:publish).");
		}
		// Lo que diría «Publicar ahora» con el texto ya restaurado.
		const rev = await leerRevision(ctx, v.collection, entrada.id);
		const vigente = v.hash === entrada.hash && aprobacionVigente(rev, entrada.hash);
		if (!vigente) {
			if (!input.confirmar) {
				const motivo = !rev.aprobacion
					? "Este artículo no está aprobado."
					: `Al restaurar esta versión, el texto no será el que aprobó ${rev.aprobacion.nombre}.`;
				return { requiereConfirmacion: true, motivo, aprobacion: rev.aprobacion };
			}
			const ajustes = await leerAjustes(ctx);
			if (ajustes.requiereAprobacion && !esAdmin(user)) {
				throw PluginRouteError.forbidden("Solo un administrador puede publicar un artículo sin aprobar.");
			}
		}
	}

	const restaurada = await escribirVersion(env, user, entrada, v, input.id);

	if (input.publicar) {
		const r = await publicar(env, user, { collection: v.collection, id: entrada.id, confirmar: input.confirmar });
		if ("requiereConfirmacion" in r) return r;
		return { collection: v.collection, entryId: entrada.id, restaurada, urlPublica: r.urlPublica };
	}
	return { collection: v.collection, entryId: entrada.id, restaurada };
}

async function escribirVersion(env: Entorno, user: Usuario, entrada: Entrada, v: VersionDoc, versionId: string): Promise<boolean> {
	const { ctx } = env;
	if (v.hash === entrada.hash) return false;
	// Las claves de la copia pueden chocar si vienen de un estado antiguo.
	const doc = { ...v.doc, content: normalizarClaves(structuredClone(v.doc.content)).content };
	const guardada = await escribirDoc(env, entrada, doc, MOTIVO_RESTAURAR);
	await reanclar(ctx, v.collection, entrada.id, guardada.doc);
	await recalcular(ctx, v.collection, entrada.id, {
		extra: (r) => {
			r.hash = guardada.hash;
			if (r.aprobacion && r.aprobacion.hash !== guardada.hash) r.aprobacion.cambiadoDespues = true;
		},
	});
	await auditar(ctx, {
		accion: "restaurar",
		userId: user.id,
		collection: v.collection,
		entryId: entrada.id,
		revisionId: guardada.draftRevisionId,
		hash: guardada.hash,
		detalle: `${versionId}: ${v.motivo}`,
	});
	return true;
}

// ─── Hooks ─────────────────────────────────────────────────────────

/**
 * `content:beforePublish`: si la entrada ya estaba publicada y lo que se va a
 * publicar es distinto, guarda lo publicado (columnas vivas, no el borrador)
 * como copia de tipo «publicacion». Nunca cancela ni lanza.
 */
export async function copiaAntesDePublicar(env: Entorno, event: ContentPolicyEvent): Promise<void> {
	const { ctx } = env;
	try {
		if (!coleccionConfigurada(env.opciones, event.collection)) return;
		const id = typeof event.content.id === "string" ? event.content.id : null;
		if (!id || !ctx.content) return;
		const vivo = await ctx.content.get(event.collection, id);
		if (!vivo || vivo.status !== "published") return;
		const campos = camposDe(env.opciones, event.collection);
		const doc = docDeDatos(vivo.data, campos);
		const hash = await hashDoc(doc);
		// El evento trae el borrador que se va a publicar: si es igual, no hay nada que guardar.
		const data = event.content.data;
		if (data && typeof data === "object" && (await hashDoc(docDeDatos(data as Record<string, unknown>, campos))) === hash) return;
		const actor = event.actor?.id ? await buscarUsuario(ctx, event.actor.id) : null;
		await guardarVersion(ctx, {
			collection: event.collection,
			entryId: vivo.id,
			tipo: "publicacion",
			motivo: motivoPublicada(new Date(), env.opciones.locale),
			doc,
			hash,
			userId: actor?.id ?? event.actor?.id ?? null,
			nombre: actor?.nombre ?? null,
		});
	} catch (error) {
		ctx.log.error("[historial] no se pudo guardar la versión publicada", { error: String(error) });
	}
}

/**
 * `content:afterSave` con una edición que no es del plugin: guarda como copia
 * el estado anterior, tomado de las revisiones de EmDash (la anterior a la
 * actual; si hay varias, la que coincide con el último texto conocido). Si no
 * se puede obtener, no guarda nada y no falla.
 */
export async function copiaDeEdicionExterna(
	env: Entorno,
	entrada: Entrada,
	hashAnterior: string | null,
	actorId: string | null,
): Promise<void> {
	const { ctx } = env;
	try {
		const content = ctx.content;
		if (!content?.listRevisions || !entrada.draftRevisionId) return;
		const lista = await content.listRevisions(entrada.collection, entrada.id, { limit: 20 });
		const i = lista.findIndex((r) => r.id === entrada.draftRevisionId);
		if (i < 0) return;
		const candidatas = lista.slice(i + 1, i + 11);
		let elegida: { doc: ReturnType<typeof docDeDatos>; hash: string } | null = null;
		for (const r of candidatas) {
			let data = r.data;
			if ((!data || typeof data !== "object") && content.getRevision) {
				data = (await content.getRevision(entrada.collection, entrada.id, r.id))?.data ?? {};
			}
			if (!data || typeof data !== "object") continue;
			const doc = docDeDatos(data, entrada.campos);
			const hash = await hashDoc(doc);
			if (hash === entrada.hash) continue;
			if (!elegida) elegida = { doc, hash };
			if (!hashAnterior || hash === hashAnterior) {
				elegida = { doc, hash };
				break;
			}
		}
		if (!elegida) return;
		const actor = actorId ? await buscarUsuario(ctx, actorId) : null;
		await guardarVersion(ctx, {
			collection: entrada.collection,
			entryId: entrada.id,
			tipo: "cambio",
			motivo: MOTIVO_EDITOR,
			doc: elegida.doc,
			hash: elegida.hash,
			userId: actor?.id ?? actorId,
			nombre: actor?.nombre ?? null,
		});
	} catch (error) {
		ctx.log.warn("[historial] no se pudo guardar la copia de una edición externa", { error: String(error) });
	}
}

/** true si el hash nuevo viene de una edición externa (no del plugin). */
export function esEdicionExterna(env: Entorno, collection: string, id: string, hashVisto: string | null, hashNuevo: string): boolean {
	return hashVisto !== hashNuevo && !env.propias.has(clavePropia(collection, id, hashNuevo));
}
