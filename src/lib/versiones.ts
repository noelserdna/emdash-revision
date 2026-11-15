/**
 * Copias del texto (historial de versiones): guardar con rotación y comparar
 * una copia con el texto actual.
 *
 * - «cambio»: el texto ANTERIOR a cada escritura (del plugin o del editor).
 * - «publicacion»: lo que estaba publicado antes de publicar otra cosa.
 *
 * Se guardan como mucho las copias que digan los ajustes (`copiasCambios`, 20 por
 * defecto; `copiasPublicaciones`, 5 por defecto) por artículo y tipo; al guardar la
 * siguiente se borra la más antigua de ese tipo. No se guarda una copia igual
 * (mismo hash) que la más reciente de su tipo.
 *
 * Este módulo no importa `contenido.ts` (que lo usa al escribir).
 */

import type { PluginContext } from "emdash";

import { textoDeBloque, tipoDeBloque } from "./bloques.js";
import { diffPalabras } from "./diff.js";
import { canonico, hashDoc } from "./hash.js";
import { allRows, collections, nuevoId } from "./store.js";
import type { BloqueComparado, DocRevisable, PTNode, ResumenVersion, TipoVersion, VersionDoc, VersionVista } from "./types.js";

import { leerAjustes } from "./ajustes.js";

/** Cuántas copias se guardan de cada tipo según los ajustes. */
export async function limitesDeCopias(ctx: PluginContext): Promise<{ cambios: number; publicaciones: number }> {
	const a = await leerAjustes(ctx);
	return { cambios: a.copiasCambios, publicaciones: a.copiasPublicaciones };
}

export interface NuevaVersion {
	collection: string;
	entryId: string;
	tipo: TipoVersion;
	motivo: string;
	doc: DocRevisable;
	/** Si ya se conoce; si no, se calcula. */
	hash?: string;
	userId?: string | null;
	nombre?: string | null;
}

/** Copias de un artículo y un tipo, de la más reciente a la más antigua. */
export async function versionesDe(
	ctx: PluginContext,
	collection: string,
	entryId: string,
	tipo: TipoVersion,
): Promise<Array<{ id: string; data: VersionDoc }>> {
	const rows = await allRows(collections(ctx).versiones, { where: { entryId, tipo }, orderBy: { fecha: "desc" } }, 500);
	return rows.filter((r) => r.data.collection === collection);
}

/**
 * Guarda una copia y rota las de su tipo. Devuelve el id de la copia, o null si
 * no se guardó porque es igual que la más reciente de su tipo.
 */
export async function guardarVersion(ctx: PluginContext, v: NuevaVersion): Promise<string | null> {
	const hash = v.hash ?? (await hashDoc(v.doc));
	const previas = await versionesDe(ctx, v.collection, v.entryId, v.tipo);
	const ultima = previas[0];
	if (ultima && ultima.data.hash === hash) return null;

	// Fechas estrictamente crecientes: dos copias en el mismo milisegundo deben ordenarse bien.
	let fecha = new Date();
	if (ultima) {
		const t = Date.parse(ultima.data.fecha);
		if (Number.isFinite(t) && t >= fecha.getTime()) fecha = new Date(t + 1);
	}
	const id = nuevoId();
	const doc: VersionDoc = {
		collection: v.collection,
		entryId: v.entryId,
		tipo: v.tipo,
		motivo: v.motivo,
		doc: structuredClone(v.doc),
		hash,
		userId: v.userId ?? null,
		nombre: v.nombre ?? null,
		fecha: fecha.toISOString(),
	};
	const { versiones } = collections(ctx);
	await versiones.put(id, doc);
	const limites = await limitesDeCopias(ctx);
	const maximo = v.tipo === "cambio" ? limites.cambios : limites.publicaciones;
	const sobran = previas.slice(maximo - 1).map((r) => r.id);
	if (sobran.length) await versiones.deleteMany(sobran);
	return id;
}

// ─── Comparación ───────────────────────────────────────────────────

function cuentaPalabras(segmentos: ReturnType<typeof diffPalabras>): number {
	let n = 0;
	for (const s of segmentos) {
		if (s.tipo === "igual") continue;
		n += s.texto.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
	}
	return n;
}

function textoSeguro(n: PTNode): string {
	try {
		return textoDeBloque(n);
	} catch {
		return "";
	}
}

function campoComparado(
	campo: "title" | "excerpt" | "references",
	antes: string,
	despues: string,
): BloqueComparado | null {
	if (antes === despues) return null;
	return {
		campo,
		blockKey: null,
		tipoBloque: campo === "title" ? "titulo_articulo" : campo === "excerpt" ? "extracto" : "fuentes",
		estado: "cambiado",
		segmentos: diffPalabras(antes, despues),
		soloFormato: false,
	};
}

/**
 * Compara una copia (`version`) con el texto actual. Alinea los bloques por
 * `_key`: los que solo están en la copia salen como «eliminado» y los que solo
 * están ahora como «añadido», en el orden del texto actual. Solo devuelve lo
 * que difiere.
 */
export function compararDocs(version: DocRevisable, actual: DocRevisable): BloqueComparado[] {
	const out: BloqueComparado[] = [];
	const t = campoComparado("title", version.titulo ?? "", actual.titulo ?? "");
	if (t) out.push(t);
	const e = campoComparado("excerpt", version.extracto ?? "", actual.extracto ?? "");
	if (e) out.push(e);

	const antes = version.content ?? [];
	const ahora = actual.content ?? [];
	const posAntes = new Map<string, number>();
	antes.forEach((n, i) => {
		if (!posAntes.has(n._key)) posAntes.set(n._key, i);
	});
	const clavesAhora = new Set(ahora.map((n) => n._key));
	const emitidos = new Set<number>();

	const eliminado = (i: number) => {
		const n = antes[i];
		if (!n || emitidos.has(i) || clavesAhora.has(n._key)) return;
		emitidos.add(i);
		const texto = textoSeguro(n);
		out.push({
			campo: "content",
			blockKey: n._key,
			tipoBloque: tipoDeBloque(n),
			estado: "eliminado",
			segmentos: texto ? [{ tipo: "eliminado", texto }] : [],
			soloFormato: false,
		});
	};

	let puntero = 0;
	for (const n of ahora) {
		const i = posAntes.get(n._key);
		if (i === undefined) {
			const texto = textoSeguro(n);
			out.push({
				campo: "content",
				blockKey: n._key,
				tipoBloque: tipoDeBloque(n),
				estado: "añadido",
				segmentos: texto ? [{ tipo: "añadido", texto }] : [],
				soloFormato: false,
			});
			continue;
		}
		// Bloques de la copia que ya no están, en su sitio (antes de este).
		for (; puntero < i; puntero++) eliminado(puntero);
		if (i >= puntero) puntero = i + 1;
		emitidos.add(i);
		const previo = antes[i]!;
		if (canonico(previo) === canonico(n)) continue;
		const ta = textoSeguro(previo);
		const td = textoSeguro(n);
		out.push({
			campo: "content",
			blockKey: n._key,
			tipoBloque: tipoDeBloque(n),
			estado: "cambiado",
			segmentos: ta === td ? (td ? [{ tipo: "igual", texto: td }] : []) : diffPalabras(ta, td),
			soloFormato: ta === td,
		});
	}
	for (let i = 0; i < antes.length; i++) eliminado(i);

	const r = campoComparado("references", version.referencias ?? "", actual.referencias ?? "");
	if (r) out.push(r);
	return out;
}

export function resumenDe(comparacion: BloqueComparado[]): ResumenVersion {
	return {
		bloquesDistintos: comparacion.length,
		palabrasDistintas: comparacion.reduce((n, b) => n + cuentaPalabras(b.segmentos), 0),
	};
}

export function versionVista(id: string, v: VersionDoc, actual: DocRevisable, hashActual: string): VersionVista {
	const igual = v.hash === hashActual;
	return {
		id,
		tipo: v.tipo,
		motivo: v.motivo,
		fecha: v.fecha,
		nombre: v.nombre,
		resumen: igual ? { bloquesDistintos: 0, palabrasDistintas: 0 } : resumenDe(compararDocs(v.doc, actual)),
		igualQueActual: igual,
	};
}
