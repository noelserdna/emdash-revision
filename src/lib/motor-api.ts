/**
 * Motor A: corrección con la API de Anthropic.
 * Funciona en un Cloudflare Worker (el SDK usa el `fetch` global; se puede inyectar otro para tests).
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODELOS, costeDe } from "./costes.js";
import { ESQUEMA_SALIDA, construirSystem, construirUsuario, validarSalida } from "./prompt.js";
import {
	ESQUEMA_SALIDA_APRENDIZAJE,
	construirSystemAprendizaje,
	construirUsuarioAprendizaje,
	validarSalidaAprendizaje,
} from "./prompt-aprendizaje.js";
import type { EntradaAprendizaje, EntradaCorreccion, Esfuerzo, ModeloId, SalidaAprendizaje, SalidaCorreccion, UsoIA } from "./types.js";

export interface ResultadoMotor {
	salida: SalidaCorreccion;
	usage: UsoIA;
	coste: number;
	modelo: string;
}

export type CodigoErrorMotor = "sin_clave" | "rechazo" | "truncado" | "salida_invalida" | "api";

export class ErrorMotor extends Error {
	constructor(
		mensaje: string,
		readonly codigo: CodigoErrorMotor,
	) {
		super(mensaje);
		this.name = "ErrorMotor";
	}
}

export interface OpcionesMotor {
	apiKey: string;
	modelo: ModeloId;
	esfuerzo: Esfuerzo;
	fetch?: typeof fetch;
	/** Cliente ya construido (tests): debe exponer `beta.messages.stream(params).finalMessage()`. */
	cliente?: unknown;
}

export const MAX_TOKENS = 32000;
export const BETA_FALLBACK = "server-side-fallback-2026-07-01";

type ParamsStream = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Mensaje = Anthropic.Beta.Messages.BetaMessage;
interface ClienteMinimo {
	beta: { messages: { stream(params: ParamsStream): { finalMessage(): Promise<Mensaje> } } };
}

/** Parámetros de la petición (exportado para tests y depuración). */
export function construirParametros(entrada: EntradaCorreccion, modelo: ModeloId, esfuerzo: Esfuerzo): ParamsStream {
	return parametrosComunes(ESQUEMA_SALIDA, construirSystem(entrada), construirUsuario(entrada), modelo, esfuerzo);
}

/** Parámetros de la síntesis de la guía aprendida (mismo cliente, fallbacks y esfuerzo que la corrección). */
export function construirParametrosAprendizaje(entrada: EntradaAprendizaje, modelo: ModeloId, esfuerzo: Esfuerzo): ParamsStream {
	return parametrosComunes(
		ESQUEMA_SALIDA_APRENDIZAJE,
		construirSystemAprendizaje(entrada),
		construirUsuarioAprendizaje(entrada),
		modelo,
		esfuerzo,
	);
}

function parametrosComunes(
	schema: Record<string, unknown>,
	system: ParamsStream["system"],
	usuario: string,
	modelo: ModeloId,
	esfuerzo: Esfuerzo,
): ParamsStream {
	const params: ParamsStream = {
		model: modelo,
		max_tokens: MAX_TOKENS,
		thinking: { type: "adaptive" },
		output_config: { effort: esfuerzo, format: { type: "json_schema", schema } },
		system,
		messages: [{ role: "user", content: usuario }],
	};
	// Haiku no tiene fallback en servidor ante un rechazo.
	if (modelo !== "claude-haiku-5-5") {
		params.betas = [BETA_FALLBACK];
		params.fallbacks = "default";
	}
	return params;
}

function crearCliente(opts: OpcionesMotor): ClienteMinimo {
	if (opts.cliente) return opts.cliente as ClienteMinimo;
	return new Anthropic({
		apiKey: opts.apiKey,
		...(opts.fetch ? { fetch: opts.fetch } : {}),
		// En streaming el timeout cubre hasta recibir las cabeceras; la duración total la acota el cron.
		timeout: 120_000,
		maxRetries: 2,
	}) as unknown as ClienteMinimo;
}

function errorDeSdk(e: unknown): ErrorMotor {
	if (e instanceof ErrorMotor) return e;
	if (e instanceof Anthropic.AuthenticationError) {
		return new ErrorMotor("La clave de la API de Anthropic no es válida o ha caducado.", "sin_clave");
	}
	if (e instanceof Anthropic.PermissionDeniedError) {
		return new ErrorMotor("La clave de la API no tiene permiso para usar este modelo.", "api");
	}
	if (e instanceof Anthropic.RateLimitError) {
		return new ErrorMotor("La API de Anthropic ha limitado las peticiones. Vuelve a intentarlo en unos minutos.", "api");
	}
	if (e instanceof Anthropic.BadRequestError) {
		return new ErrorMotor(`La API de Anthropic rechazó la petición: ${e.message}`, "api");
	}
	if (e instanceof Anthropic.InternalServerError) {
		return new ErrorMotor("La API de Anthropic no está disponible ahora mismo. Vuelve a intentarlo más tarde.", "api");
	}
	if (e instanceof Anthropic.APIConnectionError) {
		return new ErrorMotor("No se pudo conectar con la API de Anthropic.", "api");
	}
	if (e instanceof Anthropic.APIError) {
		return new ErrorMotor(`Error de la API de Anthropic${e.status ? ` (${e.status})` : ""}: ${e.message}`, "api");
	}
	const msg = e instanceof Error ? e.message : String(e);
	return new ErrorMotor(`Error inesperado al llamar a la API: ${msg}`, "api");
}

function usoDe(m: Mensaje): UsoIA {
	const u = m.usage;
	const uso: UsoIA = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
	if (u.cache_read_input_tokens != null) uso.cache_read_input_tokens = u.cache_read_input_tokens;
	if (u.cache_creation_input_tokens != null) uso.cache_creation_input_tokens = u.cache_creation_input_tokens;
	return uso;
}

/** Texto de la respuesta: los bloques `text` posteriores al último cambio de modelo por fallback. */
function textoDe(m: Mensaje): string {
	const bloques = m.content as Array<{ type: string; text?: string }>;
	let desde = 0;
	bloques.forEach((b, i) => {
		if (b.type === "fallback") desde = i + 1;
	});
	return bloques
		.slice(desde)
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text)
		.join("");
}

export async function corregirConApi(entrada: EntradaCorreccion, opts: OpcionesMotor): Promise<ResultadoMotor> {
	return llamarEstructurado(construirParametros(entrada, opts.modelo, opts.esfuerzo), validarSalida, opts, {
		rechazo: (cat) =>
			`El modelo ha declinado hacer esta corrección${cat ? ` (categoría: ${cat})` : ""}. Prueba con otro modelo o corrige a mano.`,
		truncado: "La respuesta se cortó antes de terminar (límite de tokens). Prueba con menos comentarios o sin reescritura completa.",
	});
}

export interface ResultadoAprendizaje {
	salida: SalidaAprendizaje;
	usage: UsoIA;
	coste: number;
	modelo: string;
}

/** Síntesis de la guía aprendida con la API (mismo patrón que la corrección). */
export async function aprenderConApi(entrada: EntradaAprendizaje, opts: OpcionesMotor): Promise<ResultadoAprendizaje> {
	return llamarEstructurado(construirParametrosAprendizaje(entrada, opts.modelo, opts.esfuerzo), validarSalidaAprendizaje, opts, {
		rechazo: (cat) =>
			`El modelo ha declinado actualizar la guía${cat ? ` (categoría: ${cat})` : ""}. Prueba con otro modelo o con Claude Code.`,
		truncado: "La respuesta se cortó antes de terminar (límite de tokens). Las correcciones quedan pendientes para la próxima vez.",
	});
}

async function llamarEstructurado<S>(
	params: ParamsStream,
	validar: (valor: unknown) => S,
	opts: OpcionesMotor,
	textos: { rechazo: (categoria: string | null | undefined) => string; truncado: string },
): Promise<{ salida: S; usage: UsoIA; coste: number; modelo: string }> {
	if (!opts.cliente && !opts.apiKey?.trim()) {
		throw new ErrorMotor("No hay clave de la API de Anthropic configurada.", "sin_clave");
	}
	const cliente = crearCliente(opts);

	let mensaje: Mensaje;
	try {
		mensaje = await cliente.beta.messages.stream(params).finalMessage();
	} catch (e) {
		throw errorDeSdk(e);
	}

	const usage = usoDe(mensaje);
	const modeloServido = (MODELOS.some((m) => m.id === mensaje.model) ? mensaje.model : opts.modelo) as ModeloId;
	const coste = costeDe(modeloServido, usage);

	switch (mensaje.stop_reason) {
		case "refusal": {
			const categoria = (mensaje as { stop_details?: { category?: string | null } | null }).stop_details?.category;
			throw new ErrorMotor(textos.rechazo(categoria), "rechazo");
		}
		case "max_tokens":
		case "model_context_window_exceeded":
			throw new ErrorMotor(textos.truncado, "truncado");
		case "end_turn":
		case "stop_sequence":
			break;
		default:
			throw new ErrorMotor(`La API terminó de forma inesperada (${mensaje.stop_reason ?? "sin motivo"}).`, "api");
	}

	const texto = textoDe(mensaje);
	let json: unknown;
	try {
		json = JSON.parse(texto);
	} catch {
		throw new ErrorMotor("La respuesta del modelo no es JSON válido.", "salida_invalida");
	}
	let salida: S;
	try {
		salida = validar(json);
	} catch (e) {
		throw new ErrorMotor(e instanceof Error ? e.message : String(e), "salida_invalida");
	}
	return { salida, usage, coste, modelo: mensaje.model };
}
