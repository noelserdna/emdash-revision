import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { BETA_FALLBACK, ErrorMotor, corregirConApi } from "../src/lib/motor-api.js";
import type { EntradaCorreccion, ModeloId } from "../src/lib/types.js";

const ENTRADA: EntradaCorreccion = {
	trabajoId: "t1",
	collection: "posts",
	entryId: "e1",
	titulo: "Título",
	extracto: "Extracto",
	referencias: "1. Ref.",
	bloques: [{ key: "b1", tipo: "parrafo", editable: true, markdown: "Texto [1]." }],
	comentarios: [{ id: "c1", campo: "content", blockKey: "b1", texto: "Cambia esto." }],
	guias: [{ nombre: "Guía", markdown: "Reglas." }],
	reglas: [],
	completa: false,
};

const SALIDA_OK = {
	ops: [{ op: "reemplazar", blockKey: "b1", markdown: "Texto nuevo [1].", campo: null, texto: null, comentarioIds: ["c1"] }],
	resoluciones: [{ comentarioId: "c1", accion: "aplicado", nota: "Hecho." }],
};

interface Captura {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

function sse(eventos: Array<Record<string, unknown>>): string {
	return eventos.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** fetch falso que responde con un stream SSE mínimo. */
function fetchFalso(opts: { texto?: string; stop?: string; modelo?: string; stopDetails?: unknown }, capturas: Captura[]): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		capturas.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
		const eventos: Array<Record<string, unknown>> = [
			{
				type: "message_start",
				message: {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: opts.modelo ?? "claude-opus-5-5",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
				},
			},
		];
		if (opts.texto !== undefined) {
			eventos.push(
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: opts.texto } },
				{ type: "content_block_stop", index: 0 },
			);
		}
		eventos.push(
			{
				type: "message_delta",
				delta: { stop_reason: opts.stop ?? "end_turn", stop_sequence: null, stop_details: opts.stopDetails ?? null },
				usage: { output_tokens: 200 },
			},
			{ type: "message_stop" },
		);
		return new Response(sse(eventos), { status: 200, headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch;
}

function fetchError(status: number): typeof fetch {
	return (async () =>
		new Response(JSON.stringify({ type: "error", error: { type: "x", message: "fallo" } }), {
			status,
			headers: { "content-type": "application/json" },
		})) as typeof fetch;
}

async function codigoDe(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (e) {
		expect(e).toBeInstanceOf(ErrorMotor);
		return (e as ErrorMotor).codigo;
	}
	throw new Error("no lanzó");
}

const base = (modelo: ModeloId = "claude-opus-5-5") => ({ apiKey: "sk-test", modelo, esfuerzo: "high" as const });

describe("corregirConApi", () => {
	it("éxito: devuelve la salida validada, el uso y el coste", async () => {
		const capturas: Captura[] = [];
		const r = await corregirConApi(ENTRADA, { ...base(), fetch: fetchFalso({ texto: JSON.stringify(SALIDA_OK) }, capturas) });
		expect(r.salida.ops[0]).toEqual({ op: "reemplazar", blockKey: "b1", markdown: "Texto nuevo [1].", comentarioIds: ["c1"] });
		expect(r.usage).toEqual({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 });
		expect(r.coste).toBeCloseTo((1000 * 4 + 5000 * 0.4 + 200 * 20) / 1e6, 9);
		expect(r.modelo).toBe("claude-opus-5-5");

		expect(capturas).toHaveLength(1);
		const { body, headers } = capturas[0]!;
		expect(body.model).toBe("claude-opus-5-5");
		expect(body.max_tokens).toBe(32000);
		expect(body.stream).toBe(true);
		expect(body.thinking).toEqual({ type: "adaptive" });
		expect(body.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
		expect(body.fallbacks).toBe("default");
		expect(headers.get("anthropic-beta")).toContain(BETA_FALLBACK);
		expect(body).not.toHaveProperty("temperature");
		expect(body).not.toHaveProperty("tools");
		expect(JSON.stringify(body)).not.toContain("budget_tokens");
		const system = body.system as Array<{ cache_control?: unknown }>;
		expect(system.some((b) => b.cache_control)).toBe(true);
	});

	it("no envía fallbacks con Haiku", async () => {
		const capturas: Captura[] = [];
		await corregirConApi(ENTRADA, { ...base("claude-haiku-5-5"), fetch: fetchFalso({ texto: JSON.stringify(SALIDA_OK), modelo: "claude-haiku-5-5" }, capturas) });
		expect(capturas[0]!.body).not.toHaveProperty("fallbacks");
		expect(capturas[0]!.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
	});

	it("rechazo → codigo rechazo", async () => {
		const f = fetchFalso({ stop: "refusal", stopDetails: { type: "refusal", category: "bio", explanation: null } }, []);
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: f }))).toBe("rechazo");
	});

	it("max_tokens → codigo truncado", async () => {
		const f = fetchFalso({ texto: '{"ops": [', stop: "max_tokens" }, []);
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: f }))).toBe("truncado");
	});

	it("JSON inválido o fuera de esquema → salida_invalida", async () => {
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: fetchFalso({ texto: "no es json" }, []) }))).toBe("salida_invalida");
		const malo = JSON.stringify({ ops: [{ op: "mover" }], resoluciones: [] });
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: fetchFalso({ texto: malo }, []) }))).toBe("salida_invalida");
	});

	it("sin clave → sin_clave sin llamar a la API", async () => {
		const capturas: Captura[] = [];
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), apiKey: "", fetch: fetchFalso({}, capturas) }))).toBe("sin_clave");
		expect(capturas).toHaveLength(0);
	});

	it("mapea errores HTTP del SDK por clase", async () => {
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: fetchError(401) }))).toBe("sin_clave");
		expect(await codigoDe(corregirConApi(ENTRADA, { ...base(), fetch: fetchError(400) }))).toBe("api");
	});

	it("acepta un cliente inyectado", async () => {
		let recibido: Record<string, unknown> | null = null;
		const cliente = {
			beta: {
				messages: {
					stream(p: Record<string, unknown>) {
						recibido = p;
						return {
							finalMessage: async () => ({
								model: "claude-sonnet-5-5",
								stop_reason: "end_turn",
								content: [{ type: "text", text: JSON.stringify(SALIDA_OK) }],
								usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null },
							}),
						};
					},
				},
			},
		};
		const r = await corregirConApi(ENTRADA, { ...base("claude-sonnet-5-5"), apiKey: "", cliente });
		expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 10 });
		expect(recibido!.betas).toEqual([BETA_FALLBACK]);
		expect(recibido).not.toHaveProperty("temperature");
	});

	it("ErrorMotor no depende del texto del error del SDK", () => {
		expect(new Anthropic.AuthenticationError(401, undefined, "x", new Headers())).toBeInstanceOf(Anthropic.APIError);
	});
});
