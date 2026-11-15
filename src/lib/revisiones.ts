/**
 * Estado de revisión por entrada, contadores, auditoría, detección de
 * ediciones externas y purga.
 */

import type { PluginContext } from "emdash";

import { resolverAncla } from "./anclas.js";
import { clavePropia, type Entorno } from "./contenido.js";
import { allRows, collections, nowIso, nuevoId, revisionId, upsertVersioned } from "./store.js";
import type { AuditoriaDoc, ComentarioDoc, DocRevisable, EstadoRevision, RevisionDoc } from "./types.js";

export function revisionNueva(collection: string, entryId: string, hash: string | null = null): RevisionDoc {
	return {
		collection,
		entryId,
		estado: "por_revisar",
		vuelta: 0,
		aprobacion: null,
		abiertos: 0,
		preguntasPendientes: 0,
		hash,
		actualizado: nowIso(),
	};
}

export async function leerRevision(ctx: PluginContext, collection: string, entryId: string): Promise<RevisionDoc> {
	const r = await collections(ctx).revisiones.get(revisionId(collection, entryId));
	return r ?? revisionNueva(collection, entryId);
}

/** Lee-modifica-escribe la revisión (crea una si no existe). */
export async function cambiarRevision(
	ctx: PluginContext,
	collection: string,
	entryId: string,
	cambio: (r: RevisionDoc) => RevisionDoc | void,
): Promise<RevisionDoc> {
	const r = await upsertVersioned(collections(ctx).revisiones, revisionId(collection, entryId), (actual) => {
		const base = actual ? structuredClone(actual) : revisionNueva(collection, entryId);
		const nuevo = cambio(base) ?? base;
		nuevo.actualizado = nowIso();
		return nuevo;
	});
	return r ?? revisionNueva(collection, entryId);
}

// ─── Contadores y estado ───────────────────────────────────────────

export async function comentariosDe(ctx: PluginContext, collection: string, entryId: string): Promise<Array<{ id: string; data: ComentarioDoc }>> {
	const rows = await allRows(collections(ctx).comentarios, { where: { entryId }, orderBy: { creado: "asc" } }, 5000);
	return rows.filter((r) => r.data.collection === collection);
}

export interface Contadores {
	abiertos: number;
	preguntasPendientes: number;
	cambiosPendientes: number;
}

export function esAbiertoPrincipal(c: ComentarioDoc): boolean {
	return c.estado === "abierto" && !c.parentId && c.tipo === "comentario";
}

export function esPreguntaPendiente(c: ComentarioDoc): boolean {
	return c.estado === "abierto" && !c.parentId && c.tipo === "pregunta";
}

export async function contar(ctx: PluginContext, rev: RevisionDoc): Promise<Contadores> {
	const coms = await comentariosDe(ctx, rev.collection, rev.entryId);
	let cambiosPendientes = 0;
	if (rev.vuelta > 0) {
		const cambios = await allRows(collections(ctx).cambios, { where: { entryId: rev.entryId, vuelta: rev.vuelta } }, 2000);
		cambiosPendientes = cambios.filter((c) => c.data.collection === rev.collection && c.data.veredicto === "pendiente").length;
	}
	return {
		abiertos: coms.filter((c) => esAbiertoPrincipal(c.data)).length,
		preguntasPendientes: coms.filter((c) => esPreguntaPendiente(c.data)).length,
		cambiosPendientes,
	};
}

/**
 * Estado que corresponde a unos contadores. «aprobado» solo se deja con
 * aprobar o se pierde al anularlo de forma explícita.
 */
export function estadoPara(actual: EstadoRevision, n: Contadores): EstadoRevision {
	if (actual === "aprobado") return "aprobado";
	if (actual === "cambios_por_ver" && n.cambiosPendientes > 0) return "cambios_por_ver";
	if (n.abiertos > 0) return "con_comentarios";
	if (actual === "cambios_por_ver") return "cambios_por_ver";
	return "por_revisar";
}

/**
 * Recalcula contadores y estado. Con `anularAprobacion`, un artículo aprobado
 * pierde la aprobación (comentario nuevo sobre un aprobado).
 */
export async function recalcular(
	ctx: PluginContext,
	collection: string,
	entryId: string,
	opts: { anularAprobacion?: boolean; extra?: (r: RevisionDoc) => void } = {},
): Promise<RevisionDoc> {
	const actual = await leerRevision(ctx, collection, entryId);
	// Los contadores se calculan ya con lo que `extra` vaya a cambiar (p. ej. la vuelta).
	const previsto: RevisionDoc = { ...actual };
	opts.extra?.(previsto);
	const n = await contar(ctx, previsto);
	return cambiarRevision(ctx, collection, entryId, (r) => {
		opts.extra?.(r);
		if (opts.anularAprobacion && r.estado === "aprobado" && n.abiertos > 0) {
			r.aprobacion = null;
			r.estado = "con_comentarios";
		}
		r.abiertos = n.abiertos;
		r.preguntasPendientes = n.preguntasPendientes;
		r.estado = estadoPara(r.estado, n);
	});
}

// ─── Auditoría ─────────────────────────────────────────────────────

export async function auditar(
	ctx: PluginContext,
	entrada: Omit<AuditoriaDoc, "fecha" | "revisionId" | "hash"> & { revisionId?: string | null; hash?: string | null },
): Promise<void> {
	try {
		await collections(ctx).auditoria.put(nuevoId(), {
			...entrada,
			revisionId: entrada.revisionId ?? null,
			hash: entrada.hash ?? null,
			detalle: entrada.detalle ?? null,
			fecha: nowIso(),
		});
	} catch (error) {
		ctx.log.warn("[auditoría] no se pudo registrar", { error: String(error) });
	}
}

// ─── Ediciones externas ────────────────────────────────────────────

/**
 * Compara el hash actual con el último visto. Si cambió y no fue el plugin:
 * re-ancla los comentarios abiertos (marca huérfanos) y, si hay aprobación con
 * otro hash, la marca «cambiado después». Devuelve la revisión actualizada.
 */
export async function sincronizar(
	env: Entorno,
	collection: string,
	entryId: string,
	doc: DocRevisable,
	hash: string,
): Promise<RevisionDoc | null> {
	const { ctx } = env;
	const rev = await collections(ctx).revisiones.get(revisionId(collection, entryId));
	if (!rev) return null;
	if (rev.hash === hash) return rev;
	const propia = clavePropia(collection, entryId, hash);
	const esPropia = env.propias.delete(propia);
	if (!esPropia) await reanclar(ctx, collection, entryId, doc);
	return cambiarRevision(ctx, collection, entryId, (r) => {
		r.hash = hash;
		if (!esPropia && r.aprobacion && r.aprobacion.hash !== hash) r.aprobacion.cambiadoDespues = true;
	});
}

/** Vuelve a colocar las anclas de los comentarios abiertos sobre el texto actual. */
export async function reanclar(ctx: PluginContext, collection: string, entryId: string, doc: DocRevisable): Promise<number> {
	const { comentarios } = collections(ctx);
	let huerfanos = 0;
	for (const { id, data } of await comentariosDe(ctx, collection, entryId)) {
		if (data.estado !== "abierto" || !data.ancla) continue;
		const r = resolverAncla(doc, data.ancla);
		const huerfano = r.estado === "huerfana";
		if (huerfano) huerfanos++;
		const cambiaAncla = r.estado === "recolocada" && JSON.stringify(r.ancla) !== JSON.stringify(data.ancla);
		if (cambiaAncla || !!data.huerfano !== huerfano) {
			await comentarios.put(id, { ...data, ancla: huerfano ? data.ancla : r.ancla, huerfano });
		}
	}
	return huerfanos;
}

// ─── Purga ─────────────────────────────────────────────────────────

/** Borra todo lo del plugin sobre una entrada (borrado permanente). */
export async function purgarEntrada(ctx: PluginContext, collection: string, entryId: string): Promise<void> {
	const cols = collections(ctx);
	await cols.revisiones.delete(revisionId(collection, entryId));
	const porEntrada = [cols.lecturas, cols.comentarios, cols.trabajos, cols.cambios, cols.auditoria, cols.versiones, cols.senales] as const;
	for (const col of porEntrada) {
		const c = col as unknown as {
			query: (o: { where: Record<string, unknown>; limit: number; cursor?: string }) => Promise<{
				items: Array<{ id: string; data: { collection: string } }>;
				hasMore: boolean;
				cursor?: string;
			}>;
			deleteMany: (ids: string[]) => Promise<number>;
		};
		for (let vuelta = 0; vuelta < 200; vuelta++) {
			const page = await c.query({ where: { entryId }, limit: 100 });
			const ids = page.items.filter((i) => i.data.collection === collection).map((i) => i.id);
			if (ids.length === 0) break;
			await c.deleteMany(ids);
			if (ids.length < page.items.length && !page.hasMore) break;
		}
	}
	for (const { id, data } of await allRows(cols.reglas, {}, 5000)) {
		const quedan = data.entradas.filter((e) => !(e.collection === collection && e.entryId === entryId));
		if (quedan.length !== data.entradas.length) await cols.reglas.put(id, { ...data, entradas: quedan });
	}
}
