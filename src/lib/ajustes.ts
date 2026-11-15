/**
 * Ajustes del plugin (ctx.kv "ajustes"), gasto mensual de la API y clave de
 * Anthropic leída del env del Worker.
 */

import type { PluginContext } from "emdash";

import { AJUSTES_DEFECTO, type Ajustes } from "./types.js";

const CLAVE_AJUSTES = "ajustes";

export async function leerAjustes(ctx: PluginContext): Promise<Ajustes> {
	const guardados = await ctx.kv.get<Partial<Ajustes>>(CLAVE_AJUSTES);
	return { ...AJUSTES_DEFECTO, ...(guardados ?? {}) };
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

/** Clave de Anthropic: secreto del Worker y, de reserva, process.env (Node). */
export async function leerClaveApi(nombre: string): Promise<string | null> {
	const env = await loadWorkerEnv();
	const delWorker = env?.[nombre];
	if (typeof delWorker === "string" && delWorker.trim()) return delWorker.trim();
	const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const deNode = proc?.env?.[nombre];
	return typeof deNode === "string" && deNode.trim() ? deNode.trim() : null;
}
