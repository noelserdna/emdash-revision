/**
 * Guardar y comprobar la clave de la API de Anthropic desde el panel.
 *
 * La clave se guarda con `ctx.settings` en un ajuste declarado `secret` en el
 * `settingsSchema` del plugin, así que EmDash la cifra (AES-GCM con
 * `EMDASH_ENCRYPTION_KEY`). Nunca se devuelve al navegador: solo su origen y
 * sus últimos 4 caracteres.
 */

import Anthropic from "@anthropic-ai/sdk";
import { PluginRouteError } from "emdash";
import type { PluginContext } from "emdash";

import { AJUSTE_CLAVE, formatoClaveValido } from "./ajustes.js";

export type ResultadoComprobacion = "valida" | "invalida" | "sin_comprobar";

/**
 * Comprueba la clave con una llamada barata (lista de modelos, sin coste).
 * Solo una clave rechazada por la API cuenta como inválida; un fallo de red o de
 * la API deja la clave «sin comprobar».
 */
export async function comprobarClave(apiKey: string, opts: { fetch?: typeof fetch } = {}): Promise<ResultadoComprobacion> {
	try {
		const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
		await client.models.list({ limit: 1 });
		return "valida";
	} catch (e) {
		if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "invalida";
		return "sin_comprobar";
	}
}

/** Guarda la clave cifrada. Lanza errores en español si el formato es malo, si la API la rechaza o si no se puede cifrar. */
export async function guardarClave(
	ctx: PluginContext,
	valor: string,
	opts: { fetch?: typeof fetch } = {},
): Promise<{ comprobacion: ResultadoComprobacion }> {
	const clave = valor.trim();
	if (!formatoClaveValido(clave)) {
		throw PluginRouteError.badRequest("Eso no parece una clave de la API de Anthropic: debe empezar por «sk-ant-».");
	}
	const comprobacion = await comprobarClave(clave, opts);
	if (comprobacion === "invalida") {
		throw PluginRouteError.badRequest("Anthropic ha rechazado esta clave. Revisa que la copiaste entera y que sigue activa en la consola.");
	}
	try {
		await ctx.settings.set(AJUSTE_CLAVE, clave);
	} catch (error) {
		const msg = String((error as { code?: string; message?: string })?.code ?? error);
		if (/ENCRYPTION_KEY_MISSING/.test(msg) || /EMDASH_ENCRYPTION_KEY/.test(String(error))) {
			throw PluginRouteError.internal(
				"El servidor no tiene EMDASH_ENCRYPTION_KEY, así que no se puede guardar la clave cifrada. Usa el secreto ANTHROPIC_API_KEY del Worker o configura esa clave de cifrado.",
			);
		}
		throw PluginRouteError.internal("No se ha podido guardar la clave.");
	}
	return { comprobacion };
}

export async function borrarClave(ctx: PluginContext): Promise<void> {
	await ctx.settings.delete(AJUSTE_CLAVE);
}
