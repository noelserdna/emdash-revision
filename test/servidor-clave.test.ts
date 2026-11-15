import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AJUSTE_CLAVE, resolverClaveApi } from "../src/lib/ajustes.js";
import { comprobarClave, guardarClave } from "../src/lib/clave.js";
import type { AjustesVista } from "../src/lib/types.js";
import { ADMIN, EDITORA, asPluginCtx, makeCtx, makeMundo, makePlugin, type Mundo } from "./helpers.js";

const { plugin, llamar } = makePlugin();
const CLAVE = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-WXYZ";

function respuesta(status: number, cuerpo: unknown = {}): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}
const modelos = { data: [{ id: "claude-haiku-5-5", type: "model", display_name: "Haiku", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: null, last_id: null };

describe("clave de la API desde el panel", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
	});
	afterEach(() => {
		delete process.env.ANTHROPIC_API_KEY;
	});

	it("declara el ajuste como «secret» para que EmDash lo cifre", () => {
		const schema = (plugin as unknown as { admin: { settingsSchema: Record<string, { type: string }> } }).admin.settingsSchema;
		expect(schema[AJUSTE_CLAVE]?.type).toBe("secret");
	});

	it("comprueba la clave con Anthropic: 401 es inválida; un fallo de red no la invalida", async () => {
		expect(await comprobarClave(CLAVE, { fetch: respuesta(200, modelos) })).toBe("valida");
		expect(await comprobarClave(CLAVE, { fetch: respuesta(401, { type: "error", error: { type: "authentication_error", message: "x" } }) })).toBe("invalida");
		const caida = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		expect(await comprobarClave(CLAVE, { fetch: caida })).toBe("sin_comprobar");
	});

	it("guarda la clave válida y la de panel manda sobre la del servidor", async () => {
		const ctx = asPluginCtx(makeCtx(mundo, ADMIN));
		process.env.ANTHROPIC_API_KEY = "sk-ant-servidor-0000000000000000000000-SRVR";
		expect(await resolverClaveApi(ctx, "ANTHROPIC_API_KEY")).toEqual({ clave: process.env.ANTHROPIC_API_KEY, origen: "servidor" });
		const r = await guardarClave(ctx, `  ${CLAVE}  `, { fetch: respuesta(200, modelos) });
		expect(r.comprobacion).toBe("valida");
		expect(await mundo.settings.get(AJUSTE_CLAVE)).toBe(CLAVE);
		expect(await resolverClaveApi(ctx, "ANTHROPIC_API_KEY")).toEqual({ clave: CLAVE, origen: "panel" });
	});

	it("rechaza formatos raros y claves que Anthropic no acepta, sin guardar nada", async () => {
		const ctx = asPluginCtx(makeCtx(mundo, ADMIN));
		await expect(guardarClave(ctx, "hola", { fetch: respuesta(200, modelos) })).rejects.toThrow(/sk-ant-/);
		await expect(
			guardarClave(ctx, CLAVE, { fetch: respuesta(401, { type: "error", error: { type: "authentication_error", message: "x" } }) }),
		).rejects.toThrow(/rechazado/);
		expect(await mundo.settings.get(AJUSTE_CLAVE)).toBeNull();
	});

	it("la vista de ajustes nunca devuelve la clave: solo el origen y los 4 últimos caracteres; borrar la quita", async () => {
		await mundo.settings.set(AJUSTE_CLAVE, CLAVE);
		const v = await llamar<AjustesVista>(mundo, ADMIN, "ajustes/get");
		expect(v.apiDisponible).toBe(true);
		expect(v.claveOrigen).toBe("panel");
		expect(v.claveFinal).toBe("WXYZ");
		expect(JSON.stringify(v)).not.toContain(CLAVE);
		const b = await llamar<AjustesVista>(mundo, ADMIN, "ajustes/clave-borrar");
		expect(b.apiDisponible).toBe(false);
		expect(b.claveOrigen).toBeNull();
	});

	it("solo un administrador puede guardar o borrar la clave", () => {
		const rutas = (plugin as unknown as { routes: Record<string, { permission?: string }> }).routes;
		expect(rutas["ajustes/clave"]?.permission).toBe("plugins:manage");
		expect(rutas["ajustes/clave-borrar"]?.permission).toBe("plugins:manage");
		void EDITORA;
	});
});
