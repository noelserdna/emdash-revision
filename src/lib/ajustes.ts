/**
 * Ajustes del plugin (ctx.kv "ajustes"), gasto mensual de la API y clave de
 * Anthropic leída del env del Worker.
 */

import type { PluginContext } from "emdash";

import { AJUSTES_DEFECTO, COPIAS_MAX, COPIAS_MIN, type Ajustes, type OrigenClave } from "./types.js";

const CLAVE_AJUSTES = "ajustes";

/** Valores por defecto: los del plugin, con lo que se pase en `revisionPlugin({ versiones })`. */
let defectos: Ajustes = { ...AJUSTES_DEFECTO };

/** Fija los valores por defecto de las copias a partir de las opciones del plugin. */
export function fijarDefectos(opciones: { versiones?: { cambios?: number; publicaciones?: number } } | undefined): void {
	defectos = {
		...AJUSTES_DEFECTO,
		copiasCambios: limiteCopias(opciones?.versiones?.cambios, AJUSTES_DEFECTO.copiasCambios),
		copiasPublicaciones: limiteCopias(opciones?.versiones?.publicaciones, AJUSTES_DEFECTO.copiasPublicaciones),
	};
}

/** Número de copias válido (entero entre COPIAS_MIN y COPIAS_MAX), o el valor de reserva. */
export function limiteCopias(valor: unknown, reserva: number): number {
	const n = typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor) : reserva;
	return Math.min(COPIAS_MAX, Math.max(COPIAS_MIN, n));
}

/** Hora UTC entera entre 0 y 23, o la de reserva. */
export function horaValida(valor: unknown, reserva: number): number {
	const n = typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor) : reserva;
	return Math.min(23, Math.max(0, n));
}

export async function leerAjustes(ctx: PluginContext): Promise<Ajustes> {
	const guardados = await ctx.kv.get<Partial<Ajustes>>(CLAVE_AJUSTES);
	const a = { ...defectos, ...(guardados ?? {}) };
	a.copiasCambios = limiteCopias(a.copiasCambios, defectos.copiasCambios);
	a.copiasPublicaciones = limiteCopias(a.copiasPublicaciones, defectos.copiasPublicaciones);
	a.horaAprendizaje = horaValida(a.horaAprendizaje, defectos.horaAprendizaje);
	if (typeof a.nombreGuiaAprendida !== "string" || !a.nombreGuiaAprendida.trim()) a.nombreGuiaAprendida = defectos.nombreGuiaAprendida;
	return a;
}

export async function guardarAjustes(ctx: PluginContext, cambios: Partial<Ajustes>): Promise<Ajustes> {
	const actuales = await leerAjustes(ctx);
	const limpios = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined)) as Partial<Ajustes>;
	const nuevos: Ajustes = { ...actuales, ...limpios };
	await ctx.kv.set(CLAVE_AJUSTES, nuevos);
	return nuevos;
}

/** Términos sensibles extra (fármacos…) de los ajustes. */
export function terminosSensibles(ajustes: Ajustes): string[] {
	return ajustes.terminosSensibles
		.split(/[,\n]/)
		.map((t) => t.trim())
		.filter(Boolean);
}

// ─── Gasto ─────────────────────────────────────────────────────────

export function claveGasto(fecha = new Date()): string {
	return `gasto:${fecha.toISOString().slice(0, 7)}`;
}

export async function gastoDelMes(ctx: PluginContext): Promise<number> {
	return (await ctx.kv.get<number>(claveGasto())) ?? 0;
}

export async function sumarGasto(ctx: PluginContext, usd: number): Promise<number> {
	if (!(usd > 0)) return gastoDelMes(ctx);
	const clave = claveGasto();
	for (let intento = 0; intento < 5; intento++) {
		const actual = await ctx.kv.getVersioned<number>(clave);
		const nuevo = (actual?.value ?? 0) + usd;
		const r = await ctx.kv.compareAndSet(clave, actual?.revision ?? null, nuevo);
		if (r.applied) return nuevo;
	}
	const nuevo = (await gastoDelMes(ctx)) + usd;
	await ctx.kv.set(clave, nuevo);
	return nuevo;
}

export async function topeAlcanzado(ctx: PluginContext, ajustes: Ajustes): Promise<boolean> {
	if (!(ajustes.topeMensualUsd > 0)) return false;
	return (await gastoDelMes(ctx)) >= ajustes.topeMensualUsd;
}

// ─── Clave de la API ───────────────────────────────────────────────

/**
 * Env del Worker. `../env.js` importa `cloudflare:workers`, que solo existe en
 * el runtime de Cloudflare: en Node (tests, dev sin wrangler) el import falla
 * y se devuelve null.
 */
export async function loadWorkerEnv(): Promise<Record<string, unknown> | null> {
	try {
		const mod = await import("../env.js");
		return (mod.env ?? null) as Record<string, unknown> | null;
	} catch {
		return null;
	}
}

/** Nombre del ajuste cifrado (secret) donde se guarda la clave pegada en el panel. */
export const AJUSTE_CLAVE = "anthropicApiKey";

/** Clave de Anthropic guardada desde el panel (cifrada por EmDash). Null si no hay o no se puede descifrar. */
export async function claveDelPanel(ctx: PluginContext): Promise<string | null> {
	try {
		const v = await ctx.settings.get<string>(AJUSTE_CLAVE);
		return typeof v === "string" && v.trim() ? v.trim() : null;
	} catch (error) {
		ctx.log.warn("[revisión] no se pudo leer la clave guardada en el panel", { error: String(error) });
		return null;
	}
}

/** Clave del servidor: secreto del Worker y, de reserva, process.env (Node). */
export async function claveDelServidor(nombre: string): Promise<string | null> {
	const env = await loadWorkerEnv();
	const delWorker = env?.[nombre];
	if (typeof delWorker === "string" && delWorker.trim()) return delWorker.trim();
	const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const deNode = proc?.env?.[nombre];
	return typeof deNode === "string" && deNode.trim() ? deNode.trim() : null;
}

/** Clave en uso y su origen. Manda la del panel; si no hay, la del servidor. */
export async function resolverClaveApi(
	ctx: PluginContext,
	nombre: string,
): Promise<{ clave: string | null; origen: OrigenClave }> {
	const panel = await claveDelPanel(ctx);
	if (panel) return { clave: panel, origen: "panel" };
	const servidor = await claveDelServidor(nombre);
	return servidor ? { clave: servidor, origen: "servidor" } : { clave: null, origen: null };
}

/** Clave de Anthropic en uso (panel o servidor), o null. */
export async function leerClaveApi(ctx: PluginContext, nombre: string): Promise<string | null> {
	return (await resolverClaveApi(ctx, nombre)).clave;
}

/** Comprobación rápida de formato: las claves de la API de Anthropic empiezan por «sk-ant-». */
export function formatoClaveValido(clave: string): boolean {
	return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(clave.trim());
}
