/**
 * Anclas de comentarios: crear, afinar por fragmento y volver a localizar (pura).
 *
 * Offsets en unidades UTF-16 sobre el texto de `textoDeUnidad`. Nunca se adivina:
 * si la cita aparece varias veces y el contexto (prefijo/sufijo) no desempata, el
 * ancla queda huérfana.
 */
import { esBloque, esImagen, esTabla, referenciasDe, textoDeBloque, textoDeSpans, textoDeUnidad } from "./bloques.js";
import type { Ancla, AnclaResuelta, CampoAncla, DocRevisable } from "./types.js";

const CONTEXTO = 32;
const MAX_CITA_UNIDAD = 200;

// ─── Normalización ───────────────────────────────────────────────────────────

const COMILLA_SIMPLE = /[‘’‚‛′‹›`´]/g;
const COMILLA_DOBLE = /[“”„‟«»″]/g;
const GUIONES = /[‐‑‒–—―−]/g;
const INVISIBLES = /^[​-‍⁠﻿­]+$/;

/**
 * NFKC, colapsa espacios (incluidos U+00A0 y U+202F), unifica comillas y guiones.
 * `mapa[i]` es el índice en el original del carácter normalizado `i`; tiene un
 * elemento más que el texto normalizado, con la longitud del original.
 */
export function normalizar(texto: string): { texto: string; mapa: number[] } {
	let out = "";
	const mapa: number[] = [];
	for (const m of texto.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
		const inicio = m.index ?? 0;
		const grupo = m[0];
		if (INVISIBLES.test(grupo)) continue;
		let n = grupo.normalize("NFKC");
		if (/^\s+$/u.test(n) || /^[    ]+$/.test(grupo)) {
			if (out.endsWith(" ")) continue;
			out += " ";
			mapa.push(inicio);
			continue;
		}
		n = n.replace(COMILLA_SIMPLE, "'").replace(COMILLA_DOBLE, '"').replace(GUIONES, "-").replace(/\s+/gu, " ");
		for (let k = 0; k < n.length; k++) {
			if (n[k] === " " && out.endsWith(" ")) continue;
			out += n[k];
			mapa.push(inicio);
		}
	}
	mapa.push(texto.length);
	return { texto: out, mapa };
}

/** Convierte un rango [a, b) del texto normalizado al original. */
function rangoOriginal(mapa: number[], a: number, b: number): { inicio: number; fin: number } {
	const n = mapa.length - 1;
	let j = b;
	while (j > 0 && j < n && mapa[j] === mapa[j - 1]) j++;
	return { inicio: mapa[a] ?? 0, fin: mapa[j] ?? mapa[n] ?? 0 };
}

function apariciones(pajar: string, aguja: string): number[] {
	const out: number[] = [];
	if (!aguja) return out;
	let i = pajar.indexOf(aguja);
	while (i >= 0) {
		out.push(i);
		i = pajar.indexOf(aguja, i + 1);
	}
	return out;
}

// ─── Unidades ────────────────────────────────────────────────────────────────

export interface Unidad {
	campo: CampoAncla;
	blockKey?: string;
	ruta?: string;
	texto: string;
}

/** Todas las unidades de texto de un campo (bloques, celdas, alt y pie; cada referencia). */
export function unidadesDeCampo(doc: DocRevisable, campo: CampoAncla): Unidad[] {
	switch (campo) {
		case "title":
			return [{ campo, texto: doc.titulo ?? "" }];
		case "excerpt":
			return [{ campo, texto: doc.extracto ?? "" }];
		case "references":
			return referenciasDe(doc.referencias ?? "").map((r) => ({ campo, ruta: r.numero, texto: r.texto }));
		case "content": {
			const out: Unidad[] = [];
			for (const n of doc.content) {
				if (esBloque(n)) out.push({ campo, blockKey: n._key, texto: textoDeSpans(n.children) });
				else if (esTabla(n)) {
					for (const r of n.rows) for (const c of r.cells) out.push({ campo, blockKey: n._key, ruta: `${r._key}/${c._key}`, texto: textoDeSpans(c.content) });
				} else if (esImagen(n)) {
					out.push({ campo, blockKey: n._key, ruta: "alt", texto: textoDeBloque(n, "alt") });
					out.push({ campo, blockKey: n._key, ruta: "caption", texto: textoDeBloque(n, "caption") });
				}
			}
			return out;
		}
		default:
			return [];
	}
}

function construir(u: Pick<Unidad, "campo" | "blockKey" | "ruta">, texto: string, inicio: number, fin: number, base: string | null | undefined): Ancla {
	const ancla: Ancla = { campo: u.campo, cita: texto.slice(inicio, fin) };
	if (u.blockKey !== undefined) ancla.blockKey = u.blockKey;
	if (u.ruta !== undefined) ancla.ruta = u.ruta;
	ancla.inicio = inicio;
	ancla.fin = fin;
	ancla.prefijo = texto.slice(Math.max(0, inicio - CONTEXTO), inicio);
	ancla.sufijo = texto.slice(fin, fin + CONTEXTO);
	if (base !== undefined) ancla.baseRevisionId = base;
	return ancla;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Crea un ancla para una unidad entera (sin inicio/fin) o para un fragmento. */
export function crearAncla(
	doc: DocRevisable,
	pos: { campo: CampoAncla; blockKey?: string; ruta?: string; inicio?: number; fin?: number },
	baseRevisionId?: string | null,
): Ancla | null {
	const texto = textoDeUnidad(doc, pos);
	if (texto === null) return null;
	const u = { campo: pos.campo, blockKey: pos.blockKey, ruta: pos.ruta };
	if (pos.inicio === undefined && pos.fin === undefined) {
		const ancla: Ancla = { campo: pos.campo, cita: texto.slice(0, MAX_CITA_UNIDAD) };
		if (pos.blockKey !== undefined) ancla.blockKey = pos.blockKey;
		if (pos.ruta !== undefined) ancla.ruta = pos.ruta;
		if (baseRevisionId !== undefined) ancla.baseRevisionId = baseRevisionId;
		return ancla;
	}
	const inicio = pos.inicio ?? 0;
	const fin = pos.fin ?? texto.length;
	if (!Number.isInteger(inicio) || !Number.isInteger(fin) || inicio < 0 || fin > texto.length || inicio >= fin) return null;
	return construir(u, texto, inicio, fin, baseRevisionId);
}

interface Candidato {
	unidad: Unidad;
	inicio: number;
	fin: number;
	puntos: number;
}

/** Puntuación de contexto: caracteres de prefijo y sufijo que coinciden (normalizados). */
function puntuar(normTexto: string, p: number, len: number, prefijo: string | undefined, sufijo: string | undefined): number {
	let puntos = 0;
	if (prefijo !== undefined) {
		const pre = normalizar(prefijo).texto;
		if (pre === "" && p === 0) puntos++;
		let k = 0;
		while (k < pre.length && p - 1 - k >= 0 && normTexto[p - 1 - k] === pre[pre.length - 1 - k]) k++;
		puntos += k;
	}
	if (sufijo !== undefined) {
		const suf = normalizar(sufijo).texto;
		const f = p + len;
		if (suf === "" && f === normTexto.length) puntos++;
		let k = 0;
		while (k < suf.length && f + k < normTexto.length && normTexto[f + k] === suf[k]) k++;
		puntos += k;
	}
	return puntos;
}

/** Busca la cita (normalizada) en una lista de unidades. */
function buscar(unidades: Unidad[], cita: string, prefijo?: string, sufijo?: string): Candidato[] {
	const aguja = normalizar(cita).texto;
	if (!aguja.trim()) return [];
	const out: Candidato[] = [];
	for (const u of unidades) {
		const n = normalizar(u.texto);
		for (const p of apariciones(n.texto, aguja)) {
			const r = rangoOriginal(n.mapa, p, p + aguja.length);
			out.push({ unidad: u, ...r, puntos: puntuar(n.texto, p, aguja.length, prefijo, sufijo) });
		}
	}
	return out;
}

/** Elige un candidato sin adivinar: único, o el único con la mejor puntuación de contexto (> 0). */
function elegir(cands: Candidato[]): Candidato | null {
	if (cands.length === 1) return cands[0] ?? null;
	if (cands.length === 0) return null;
	const max = Math.max(...cands.map((c) => c.puntos));
	if (max <= 0) return null;
	const mejores = cands.filter((c) => c.puntos === max);
	return mejores.length === 1 ? (mejores[0] ?? null) : null;
}

/**
 * Busca `fragmento` dentro de la unidad y devuelve el ancla afinada; null si no aparece
 * o aparece más de una vez. Con `campo: "content"` sin `blockKey` (o `references` sin
 * `ruta`) busca en todas las unidades del campo.
 */
export function anclaDeFragmento(
	doc: DocRevisable,
	unidad: Pick<Ancla, "campo" | "blockKey" | "ruta">,
	fragmento: string,
	baseRevisionId?: string | null,
): Ancla | null {
	let unidades: Unidad[];
	const todoElCampo = (unidad.campo === "content" && !unidad.blockKey) || (unidad.campo === "references" && !unidad.ruta);
	if (todoElCampo) unidades = unidadesDeCampo(doc, unidad.campo);
	else {
		const texto = textoDeUnidad(doc, unidad);
		if (texto === null) return null;
		unidades = [{ campo: unidad.campo, blockKey: unidad.blockKey, ruta: unidad.ruta, texto }];
	}
	const cands = buscar(unidades, fragmento.trim());
	if (cands.length !== 1) return null;
	const c = cands[0];
	if (!c) return null;
	return construir(c.unidad, c.unidad.texto, c.inicio, c.fin, baseRevisionId);
}

/**
 * Vuelve a localizar el ancla en el documento actual. Orden: offsets+cita → cita en la
 * unidad (desempate por prefijo/sufijo) → cita normalizada en todo el campo → huérfana.
 * Si la unidad entera (sin offsets) sigue existiendo, es "exacta".
 */
export function resolverAncla(doc: DocRevisable, ancla: Ancla): AnclaResuelta {
	const huerfana: AnclaResuelta = { estado: "huerfana", ancla };
	const texto = textoDeUnidad(doc, ancla);
	const sinOffsets = ancla.inicio === undefined || ancla.fin === undefined;
	if (sinOffsets) return texto !== null ? { estado: "exacta", ancla } : huerfana;
	if (!ancla.cita) return huerfana;

	// 1) offsets y cita coincidentes
	if (texto !== null && texto.slice(ancla.inicio, ancla.fin) === ancla.cita) return { estado: "exacta", ancla };

	const recolocar = (c: Candidato): AnclaResuelta => {
		const nueva = construir(c.unidad, c.unidad.texto, c.inicio, c.fin, undefined);
		if ("baseRevisionId" in ancla) nueva.baseRevisionId = ancla.baseRevisionId;
		return { estado: "recolocada", ancla: nueva };
	};

	// 2) la cita dentro de la misma unidad
	if (texto !== null) {
		const u: Unidad = { campo: ancla.campo, blockKey: ancla.blockKey, ruta: ancla.ruta, texto };
		const cands = buscar([u], ancla.cita, ancla.prefijo, ancla.sufijo);
		if (cands.length) {
			const c = elegir(cands);
			return c ? recolocar(c) : huerfana;
		}
	}

	// 3) la cita normalizada en todo el campo
	const cands = buscar(unidadesDeCampo(doc, ancla.campo), ancla.cita, ancla.prefijo, ancla.sufijo);
	const c = elegir(cands);
	return c ? recolocar(c) : huerfana;
}
