/**
 * Acceso al storage del plugin: colecciones, índices y utilidades de paginación.
 *
 * El host limita cada `query` a 100 filas y solo permite filtrar u ordenar por
 * campos indexados. Todo lo que necesite más filas sigue el cursor.
 */

import type { PluginContext, StorageCollection } from "emdash";

import type {
	AprendizajeDoc,
	AuditoriaDoc,
	CambioDoc,
	ComentarioDoc,
	GuiaDoc,
	GuiaHistorialDoc,
	LecturaDoc,
	ReglaDoc,
	RevisionDoc,
	SenalDoc,
	TrabajoDoc,
	VersionDoc,
} from "./types.js";

/** Opciones de `StorageCollection.query` (emdash no exporta QueryOptions). */
export type QueryOptions = NonNullable<Parameters<StorageCollection["query"]>[0]>;
export type WhereClause = NonNullable<QueryOptions["where"]>;

export interface CollectionConfig {
	indexes: Array<string | string[]>;
}

export const STORAGE: Record<
	"revisiones"
	| "lecturas"
	| "comentarios"
	| "reglas"
	| "trabajos"
	| "cambios"
	| "guias"
	| "auditoria"
	| "versiones"
	| "senales"
	| "aprendizajes"
	| "guias_historial",
	CollectionConfig
> = {
	revisiones: { indexes: ["collection", "estado", "actualizado"] },
	lecturas: { indexes: ["userId", "entryId"] },
	comentarios: {
		indexes: ["entryId", "estado", "creado", "reglaId", ["entryId", "estado"], ["entryId", "creado"]],
	},
	reglas: { indexes: ["creado"] },
	trabajos: { indexes: ["entryId", "estado", "creado", ["estado", "creado"], ["entryId", "creado"]] },
	cambios: { indexes: ["entryId", "vuelta", "orden", ["entryId", "vuelta"]] },
	guias: { indexes: ["orden"] },
	auditoria: { indexes: ["entryId", "fecha", ["entryId", "fecha"]] },
	versiones: { indexes: ["entryId", "tipo", "fecha", ["entryId", "tipo", "fecha"]] },
	senales: { indexes: ["fecha", "procesada", "entryId", ["procesada", "fecha"]] },
	aprendizajes: { indexes: ["estado", "creado"] },
	guias_historial: { indexes: ["fecha"] },
};

/** Índices planos para el descriptor (el manifest no admite compuestos). */
export const STORAGE_FLAT: Record<keyof typeof STORAGE, { indexes: string[] }> = Object.fromEntries(
	Object.entries(STORAGE).map(([name, cfg]) => [
		name,
		{ indexes: cfg.indexes.filter((i): i is string => typeof i === "string") },
	]),
) as Record<keyof typeof STORAGE, { indexes: string[] }>;

export type Collections = {
	revisiones: StorageCollection<RevisionDoc>;
	lecturas: StorageCollection<LecturaDoc>;
	comentarios: StorageCollection<ComentarioDoc>;
	reglas: StorageCollection<ReglaDoc>;
	trabajos: StorageCollection<TrabajoDoc>;
	cambios: StorageCollection<CambioDoc>;
	guias: StorageCollection<GuiaDoc>;
	auditoria: StorageCollection<AuditoriaDoc>;
	versiones: StorageCollection<VersionDoc>;
	senales: StorageCollection<SenalDoc>;
	aprendizajes: StorageCollection<AprendizajeDoc>;
	guias_historial: StorageCollection<GuiaHistorialDoc>;
};

/** Storage tipado a partir del contexto del plugin. */
export function collections(ctx: PluginContext): Collections {
	return ctx.storage as unknown as Collections;
}

export const MAX_PAGE = 100;

/**
 * Recorre todas las páginas de una consulta hasta `max` filas. Detecta cursores
 * que no avanzan para no quedarse en bucle.
 */
export async function allRows<T>(
	collection: StorageCollection<T>,
	options: Omit<QueryOptions, "cursor" | "limit"> = {},
	max = 1000,
): Promise<Array<{ id: string; data: T }>> {
	const rows: Array<{ id: string; data: T }> = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await collection.query({ ...options, limit: MAX_PAGE, cursor });
		rows.push(...page.items);
		if (!page.hasMore || rows.length >= max) break;
		if (!page.cursor || page.cursor === cursor) break;
		cursor = page.cursor;
	}
	return rows.slice(0, max);
}

/**
 * Lee-modifica-escribe con control de versión y reintentos ante conflicto.
 * `update` recibe el valor actual (o null) y devuelve el nuevo; si devuelve null,
 * no escribe.
 */
export async function upsertVersioned<T>(
	collection: StorageCollection<T>,
	id: string,
	update: (current: T | null) => T | null,
	retries = 5,
): Promise<T | null> {
	for (let attempt = 0; attempt < retries; attempt++) {
		const current = await collection.getVersioned(id);
		const next = update(current?.value ?? null);
		if (next === null) return current?.value ?? null;
		const result = await collection.compareAndSet(id, current?.revision ?? null, next);
		if (result.applied) return next;
	}
	throw new Error(`No se pudo actualizar ${id} tras ${retries} intentos`);
}

export function nowIso(): string {
	return new Date().toISOString();
}

/** Identificador ordenable por tiempo. */
export function nuevoId(): string {
	return `${Date.now().toString(36).padStart(9, "0")}-${crypto.randomUUID().slice(0, 8)}`;
}

export function revisionId(collection: string, entryId: string): string {
	return `${collection}:${entryId}`;
}

export function lecturaId(userId: string, collection: string, entryId: string): string {
	return `${userId}:${collection}:${entryId}`;
}
