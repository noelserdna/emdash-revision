/**
 * Lógica pura del panel (sin DOM ni React), probada en test/admin-logica.test.ts.
 */

import type { Ancla, Aprobacion, ArticuloFila, CampoAncla, EstadoRevision, TrabajoVista } from "../lib/types.js";
import { T } from "./textos.js";

// ─── Unidades comentables ────────────────────────────────────────────────────

export interface RefUnidad {
	campo: CampoAncla;
	blockKey?: string;
	ruta?: string;
}

/** Identificador estable de una unidad comentable: `campo|blockKey|ruta`. */
export function idUnidad(u: RefUnidad | Pick<Ancla, "campo" | "blockKey" | "ruta">): string {
	return `${u.campo}|${u.blockKey ?? ""}|${u.ruta ?? ""}`;
}

export function refDeId(id: string): RefUnidad | null {
	const [campo, blockKey, ruta] = id.split("|");
	if (campo !== "content" && campo !== "title" && campo !== "excerpt" && campo !== "references") return null;
	const ref: RefUnidad = { campo };
	if (blockKey) ref.blockKey = blockKey;
	if (ruta) ref.ruta = ruta;
	return ref;
}

// ─── Enlaces, imágenes y fuentes seguras ─────────────────────────────────────

/** Solo http, https, mailto y relativos. Nada de javascript:, data:, vbscript: ni «//host». */
export function hrefSeguro(href: unknown, permitirMailto = true): string | null {
	if (typeof href !== "string") return null;
	// Los navegadores ignoran controles y espacios dentro del esquema («java\tscript:»).
	const limpio = href.replace(/[\u0000- \u007f]/g, "");
	if (!limpio) return null;
	const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(limpio);
	if (esquema) {
		const s = (esquema[1] ?? "").toLowerCase();
		if (s === "http" || s === "https" || (permitirMailto && s === "mailto")) return href.trim();
		return null;
	}
	if (limpio.startsWith("//") || limpio.startsWith("\\")) return null;
	return href.trim();
}

/** Lista de familias para `font-family` a partir de un nombre configurado. null si no es seguro. */
export function familiaFuente(nombre: string | null | undefined, reserva: string): string | null {
	if (!nombre) return null;
	const n = nombre.trim();
	if (!n || !/^[\p{L}\p{N} ,'"_-]+$/u.test(n)) return null;
	if (n.includes(",")) return n;
	return `"${n.replace(/"/g, "")}", ${reserva}`;
}

// ─── Texto y offsets ─────────────────────────────────────────────────────────

/** Offset absoluto (UTF-16) dentro de la concatenación de varios textos. */
export function offsetAbsoluto(longitudes: number[], indice: number, offset: number): number {
	let total = 0;
	for (let i = 0; i < indice && i < longitudes.length; i++) total += longitudes[i] ?? 0;
	return total + Math.max(0, Math.min(offset, longitudes[indice] ?? 0));
}

/**
 * Ajusta una selección: ordena los extremos y recorta los espacios de los bordes.
 * Devuelve null si queda vacía.
 */
export function recortarRango(texto: string, a: number, b: number): { inicio: number; fin: number } | null {
	let inicio = Math.max(0, Math.min(a, b));
	let fin = Math.min(texto.length, Math.max(a, b));
	while (inicio < fin && /\s/.test(texto[inicio] ?? "")) inicio++;
	while (fin > inicio && /\s/.test(texto[fin - 1] ?? "")) fin--;
	return fin > inicio ? { inicio, fin } : null;
}

/**
 * Convierte una selección expresada en (nodo de texto, offset) a offsets sobre
 * la concatenación de los textos. `textos` son los nodos que cuentan, en orden.
 */
export function seleccionAOffsets(
	textos: string[],
	ini: { indice: number; offset: number },
	fin: { indice: number; offset: number },
): { inicio: number; fin: number; cita: string } | null {
	const longitudes = textos.map((t) => t.length);
	const completo = textos.join("");
	const r = recortarRango(
		completo,
		offsetAbsoluto(longitudes, ini.indice, ini.offset),
		offsetAbsoluto(longitudes, fin.indice, fin.offset),
	);
	return r ? { ...r, cita: completo.slice(r.inicio, r.fin) } : null;
}

export interface RangoMarca {
	inicio: number;
	fin: number;
	/** frag = fragmento comentado; activo = comentario activo */
	clase: "frag" | "activo";
}

export interface Trozo {
	/** Índice del span de origen. */
	span: number;
	texto: string;
	inicio: number;
	frag: boolean;
	activo: boolean;
}

/**
 * Parte los spans en trozos según las marcas de comentarios, sin alterar el
 * texto: la concatenación de los trozos es exactamente la de los spans.
 */
export function trocearSpans(textos: string[], rangos: RangoMarca[]): Trozo[] {
	const trozos: Trozo[] = [];
	let base = 0;
	textos.forEach((texto, span) => {
		const fin = base + texto.length;
		const cortes = new Set<number>([base, fin]);
		for (const r of rangos) {
			if (r.inicio > base && r.inicio < fin) cortes.add(r.inicio);
			if (r.fin > base && r.fin < fin) cortes.add(r.fin);
		}
		const orden = [...cortes].sort((x, y) => x - y);
		for (let i = 0; i < orden.length - 1; i++) {
			const a = orden[i] ?? 0;
			const b = orden[i + 1] ?? 0;
			if (b <= a) continue;
			const cubre = (c: RangoMarca["clase"]) => rangos.some((r) => r.clase === c && r.inicio <= a && r.fin >= b);
			trozos.push({ span, texto: texto.slice(a - base, b - base), inicio: a, frag: cubre("frag"), activo: cubre("activo") });
		}
		if (texto.length === 0) trozos.push({ span, texto: "", inicio: base, frag: false, activo: false });
		base = fin;
	});
	return trozos;
}

// ─── Etiquetas de revisión ───────────────────────────────────────────────────

export type Icono = "circulo" | "comentario" | "cambios" | "check" | "alerta" | "reloj";

export function trabajoActivo(t: TrabajoVista | null | undefined): boolean {
	return !!t && (t.estado === "cola" || t.estado === "en_curso");
}

export function etiquetaRevision(f: {
	estado: EstadoRevision;
	aprobacion: Aprobacion | null;
	trabajo: TrabajoVista | null;
}): { texto: string; icono: Icono; tono: "neutro" | "info" | "aviso" | "ok" } {
	if (trabajoActivo(f.trabajo)) return { texto: T.estadoEsperando, icono: "reloj", tono: "neutro" };
	switch (f.estado) {
		case "con_comentarios":
			return { texto: T.estadoConComentarios, icono: "comentario", tono: "info" };
		case "cambios_por_ver":
			return { texto: T.estadoCambios, icono: "cambios", tono: "aviso" };
		case "aprobado":
			return f.aprobacion?.cambiadoDespues
				? { texto: T.estadoCambiadoDespues, icono: "alerta", tono: "aviso" }
				: { texto: T.estadoAprobadoPor(f.aprobacion?.nombre ?? "—"), icono: "check", tono: "ok" };
		default:
			return { texto: T.estadoPorRevisar, icono: "circulo", tono: "neutro" };
	}
}

// ─── Grupos del inicio ───────────────────────────────────────────────────────

export interface GruposInicio {
	cambios: ArticuloFila[];
	porRevisar: ArticuloFila[];
	esperando: ArticuloFila[];
	aprobados: ArticuloFila[];
}

const publicado = (f: ArticuloFila) => (f.publicacion === "publicado" || f.publicacion === "publicado_con_cambios" ? 0 : 1);

/** Agrupa por «qué me toca». Dentro de cada grupo, primero los publicados (orden estable). */
export function agruparInicio(filas: ArticuloFila[], soloNecesitan = false): GruposInicio {
	const g: GruposInicio = { cambios: [], porRevisar: [], esperando: [], aprobados: [] };
	for (const f of filas) {
		if (soloNecesitan && !(f.abiertos > 0 && !trabajoActivo(f.trabajo))) continue;
		if (trabajoActivo(f.trabajo)) g.esperando.push(f);
		else if (f.estado === "aprobado") g.aprobados.push(f);
		else if (f.estado === "cambios_por_ver") g.cambios.push(f);
		else g.porRevisar.push(f);
	}
	const ordenar = (l: ArticuloFila[]) =>
		l
			.map((f, i) => ({ f, i }))
			.sort((a, b) => publicado(a.f) - publicado(b.f) || a.i - b.i)
			.map((x) => x.f);
	return { cambios: ordenar(g.cambios), porRevisar: ordenar(g.porRevisar), esperando: ordenar(g.esperando), aprobados: ordenar(g.aprobados) };
}

// ─── Barra de acciones ───────────────────────────────────────────────────────

export type Accion =
	| "seguir_leyendo"
	| "aprobar"
	| "aprobar_igualmente"
	| "he_terminado"
	| "cambio_siguiente"
	| "enviar_otra_vez"
	| "siguiente"
	| "inicio"
	| "publicar"
	| "retirar"
	| "abrir_editor"
	| "dejar_luego"
	| "corregir_ia"
	| "claude_code";

export interface EntradaBarra {
	estado: EstadoRevision;
	abiertos: number;
	completada: boolean;
	cambiosPendientes: number;
	hayNoEsEsto: boolean;
	trabajoActivo: boolean;
	puedeAprobar: boolean;
	esAdmin: boolean;
	haySiguiente: boolean;
}

/** Una sola acción principal por situación (tabla «Barra de acciones» del plan). */
export function accionesBarra(e: EntradaBarra): { principal: Accion; menu: Accion[] } {
	const sigue: Accion = e.haySiguiente ? "siguiente" : "inicio";
	let principal: Accion;
	let menu: Accion[];
	if (e.trabajoActivo) {
		principal = sigue;
		menu = ["abrir_editor"];
	} else if (e.estado === "aprobado") {
		principal = sigue;
		menu = ["publicar", ...(e.puedeAprobar ? (["retirar"] as Accion[]) : []), "abrir_editor"];
	} else if (e.estado === "cambios_por_ver" && e.cambiosPendientes > 0) {
		principal = "cambio_siguiente";
		menu = ["dejar_luego", ...(e.puedeAprobar ? (["aprobar_igualmente"] as Accion[]) : []), "abrir_editor"];
	} else if (e.estado === "cambios_por_ver" && (e.hayNoEsEsto || e.abiertos > 0)) {
		principal = "enviar_otra_vez";
		menu = [...(e.puedeAprobar ? (["aprobar_igualmente"] as Accion[]) : []), "abrir_editor"];
	} else if (e.abiertos > 0) {
		principal = "he_terminado";
		menu = [...(e.puedeAprobar ? (["aprobar_igualmente"] as Accion[]) : []), "abrir_editor"];
	} else if (!e.completada && e.estado !== "cambios_por_ver") {
		principal = "seguir_leyendo";
		menu = [...(e.puedeAprobar ? (["aprobar"] as Accion[]) : []), "abrir_editor"];
	} else {
		principal = e.puedeAprobar ? "aprobar" : sigue;
		menu = ["abrir_editor"];
	}
	if (e.esAdmin) {
		if (!e.trabajoActivo) menu.push("corregir_ia", "claude_code");
		if (!menu.includes("publicar")) menu.push("publicar");
	}
	return { principal, menu: menu.filter((a) => a !== principal) };
}

/** Porcentaje leído, 0-100, a partir de los bloques vistos. */
export function porcentajeLeido(vistos: number, total: number, completada: boolean): number {
	if (completada || total === 0) return 100;
	return Math.min(99, Math.floor((vistos / total) * 100));
}

/** Intervalo de sondeo del trabajo en curso: 5 s, y 15 s pasados 2 minutos. */
export function intervaloSondeo(msDesdeInicio: number): number {
	return msDesdeInicio > 120_000 ? 15_000 : 5_000;
}
