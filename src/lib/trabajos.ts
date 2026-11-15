/**
 * Trabajos de corrección: «He terminado», cola para Claude Code (motor B),
 * llamada a la API por cron (motor A) y entrega común con validación.
 */

import { PluginRouteError } from "emdash";
import type { PluginContext } from "emdash";

import { buscarUsuario, nombreDe, type Usuario } from "./acceso.js";
import { leerAjustes, leerClaveApi, sumarGasto, terminosSensibles, topeAlcanzado } from "./ajustes.js";
import { bloquesParaIA } from "./bloques.js";
import { enlaceArticulo, enviarCorreo } from "./correo.js";
import { camposDe, escribirDoc, leerEntrada, leerParaAnclar, tituloDe, type Entorno } from "./contenido.js";
import { corregirConApi, ErrorMotor } from "./motor-api.js";
import { aplicarOps } from "./ops.js";
import { instruccionesParaAgente, validarSalida } from "./prompt.js";
import { auditar, comentariosDe, esAbiertoPrincipal, leerRevision, recalcular } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId } from "./store.js";
import type {
	CambioDoc,
	ComentarioDoc,
	ComentarioParaIA,
	EntradaCorreccion,
	Esfuerzo,
	EstadoTrabajo,
	ModeloId,
	Motor,
	OpRechazada,
	RespuestaPregunta,
	SalidaCorreccion,
	TrabajoDoc,
	TrabajoVista,
	UsoIA,
} from "./types.js";

/** Cuánto dura una reclamación de Claude Code. */
export const RECLAMO_MS = 30 * 60 * 1000;
/** Un trabajo de API sin latido durante este tiempo se da por perdido. */
export const CADUCIDAD_API_MS = 15 * 60 * 1000;

export function trabajoVista(id: string, t: TrabajoDoc): TrabajoVista {
	return {
		id,
		motor: t.motor,
		estado: t.estado,
		modelo: t.modelo,
		creado: t.creado,
		terminado: t.terminado ?? null,
		error: t.error ?? null,
		costeEstimado: t.costeEstimado ?? null,
	};
}

export function nombreCron(trabajoId: string): string {
	return `trabajo-${trabajoId}`;
}

function activo(t: TrabajoDoc): boolean {
	return t.estado === "cola" || t.estado === "en_curso";
}

export async function trabajosDe(ctx: PluginContext, collection: string, entryId: string): Promise<Array<{ id: string; data: TrabajoDoc }>> {
	const rows = await allRows(collections(ctx).trabajos, { where: { entryId }, orderBy: { creado: "desc" } }, 500);
	return rows.filter((r) => r.data.collection === collection);
}

/** Marca como error los trabajos de API que se quedaron sin latido. */
async function caducar(ctx: PluginContext, id: string, t: TrabajoDoc): Promise<TrabajoDoc> {
	if (t.motor !== "api" || t.estado !== "en_curso") return t;
	if (Date.now() - Date.parse(t.latido) < CADUCIDAD_API_MS) return t;
	const nuevo: TrabajoDoc = { ...t, estado: "error", error: "La corrección no terminó a tiempo. Inténtalo de nuevo.", terminado: nowIso() };
	await collections(ctx).trabajos.put(id, nuevo);
	return nuevo;
}

export async function ultimoTrabajo(ctx: PluginContext, collection: string, entryId: string): Promise<{ id: string; data: TrabajoDoc } | null> {
	const [primero] = await trabajosDe(ctx, collection, entryId);
	if (!primero) return null;
	return { id: primero.id, data: await caducar(ctx, primero.id, primero.data) };
}

export async function trabajoActivo(ctx: PluginContext, collection: string, entryId: string): Promise<{ id: string; data: TrabajoDoc } | null> {
	for (const r of await trabajosDe(ctx, collection, entryId)) {
		if (!activo(r.data)) continue;
		const data = await caducar(ctx, r.id, r.data);
		if (activo(data)) return { id: r.id, data };
	}
	return null;
}

// ─── Crear ─────────────────────────────────────────────────────────

export interface OpcionesTrabajo {
	motor: Motor;
	modelo?: ModeloId | null;
	esfuerzo?: Esfuerzo | null;
	completa?: boolean;
}

async function programar(ctx: PluginContext, trabajoId: string): Promise<void> {
	if (!ctx.cron) throw new Error("El sitio no tiene planificador de tareas (cron).");
	await ctx.cron.schedule(nombreCron(trabajoId), {
		schedule: new Date(Date.now() + 5000).toISOString(),
		data: { trabajoId },
	});
}

export async function crearTrabajo(
	env: Entorno,
	user: Usuario | null,
	collection: string,
	entryId: string,
	opts: OpcionesTrabajo,
): Promise<{ id: string; data: TrabajoDoc }> {
	const { ctx } = env;
	if (await trabajoActivo(ctx, collection, entryId)) {
		throw PluginRouteError.conflict("Ya hay una corrección en marcha para este artículo.");
	}
	const ajustes = await leerAjustes(ctx);
	if (opts.motor === "api") {
		if (!(await leerClaveApi(env.opciones.claveApi ?? "ANTHROPIC_API_KEY"))) {
			throw PluginRouteError.badRequest("Falta la clave de la API de Anthropic en el servidor.");
		}
		if (await topeAlcanzado(ctx, ajustes)) {
			throw PluginRouteError.badRequest("Se ha alcanzado el tope de gasto de este mes.");
		}
	}
	const entrada = await leerEntrada(env, collection, entryId);
	const rev = await leerRevision(ctx, collection, entryId);
	const ahora = nowIso();
	const data: TrabajoDoc = {
		collection,
		entryId: entrada.id,
		motor: opts.motor,
		estado: "cola",
		modelo: opts.motor === "api" ? (opts.modelo ?? ajustes.modeloDefecto) : (opts.modelo ?? null),
		esfuerzo: opts.motor === "api" ? (opts.esfuerzo ?? ajustes.esfuerzo) : (opts.esfuerzo ?? null),
		completa: !!opts.completa,
		vuelta: rev.vuelta,
		baseDraftRevisionId: entrada.draftRevisionId,
		baseHash: entrada.hash,
		creadoPor: user?.id ?? "",
		creado: ahora,
		latido: ahora,
		reclamadoHasta: null,
		terminado: null,
		error: null,
		usage: null,
		costeEstimado: null,
		salidaPendiente: null,
	};
	const id = nuevoId();
	await collections(ctx).trabajos.put(id, data);
	if (opts.motor === "api") {
		try {
			await programar(ctx, id);
		} catch (error) {
			const fallo: TrabajoDoc = { ...data, estado: "error", error: String((error as Error).message ?? error) };
			await collections(ctx).trabajos.put(id, fallo);
			return { id, data: fallo };
		}
	}
	return { id, data };
}

/** «He terminado»: deja el trabajo en cola (o lanza la API) y avisa por correo. */
export async function terminar(env: Entorno, user: Usuario, collection: string, entryId: string): Promise<{ trabajo: TrabajoVista }> {
	const { ctx } = env;
	const existente = await trabajoActivo(ctx, collection, entryId);
	if (existente) return { trabajo: trabajoVista(existente.id, existente.data) };
	const rev = await recalcular(ctx, collection, entryId);
	if (rev.abiertos === 0) throw PluginRouteError.badRequest("No hay comentarios abiertos que enviar a corregir.");
	const ajustes = await leerAjustes(ctx);
	let motor: Motor = ajustes.motorHeTerminado;
	if (motor === "api") {
		const clave = await leerClaveApi(env.opciones.claveApi ?? "ANTHROPIC_API_KEY");
		if (!clave || (await topeAlcanzado(ctx, ajustes))) motor = "local";
	}
	const t = await crearTrabajo(env, user, collection, entryId, { motor });
	const entrada = await leerEntrada(env, collection, entryId);
	const titulo = tituloDe(entrada.item, entrada.campos);
	if (ajustes.avisarA) {
		await enviarCorreo(ctx, {
			to: ajustes.avisarA,
			subject: `${nombreDe(user)} ha terminado de revisar «${titulo}»`,
			text: [
				`${nombreDe(user)} ha terminado de revisar «${titulo}» y ha dejado ${rev.abiertos} comentario(s).`,
				"",
				motor === "local"
					? "La corrección está en la cola de Claude Code: ejecuta /aplicar-revision cuando puedas."
					: "La corrección se está haciendo con la API de Anthropic.",
				"",
				enlaceArticulo(ctx, collection, entryId),
			].join("\n"),
		});
	}
	await auditar(ctx, {
		accion: "terminar",
		userId: user.id,
		collection,
		entryId,
		revisionId: entrada.draftRevisionId,
		hash: entrada.hash,
		detalle: `${t.id} (${motor})`,
	});
	return { trabajo: trabajoVista(t.id, t.data) };
}

// ─── Entrada para la IA ────────────────────────────────────────────

function comentariosParaIA(coms: Array<{ id: string; data: ComentarioDoc }>): ComentarioParaIA[] {
	const hijos = new Map<string, string[]>();
	for (const { data } of coms) {
		if (!data.parentId) continue;
		const lista = hijos.get(data.parentId) ?? [];
		lista.push(`${data.autorNombre}: ${data.texto}`);
		hijos.set(data.parentId, lista);
	}
	return coms
		.filter((c) => esAbiertoPrincipal(c.data))
		.map(({ id, data }) => {
			const respuestas = hijos.get(id);
			const texto = respuestas?.length ? `${data.texto}\n\nRespuestas:\n${respuestas.map((r) => `- ${r}`).join("\n")}` : data.texto;
			const a = data.ancla;
			const base: ComentarioParaIA = {
				id,
				campo: a && !data.huerfano ? a.campo : "general",
				texto,
				textoPropuesto: data.textoPropuesto ?? null,
			};
			if (a) {
				if (!data.huerfano && a.blockKey) base.blockKey = a.blockKey;
				if (!data.huerfano && a.ruta) base.ruta = a.ruta;
				if (a.cita) base.cita = a.cita;
			}
			return base;
		});
}

function textoRespuesta(r: RespuestaPregunta): string {
	switch (r.tipo) {
		case "correcto":
			return r.texto ? `Es correcto. ${r.texto}` : "Es correcto: no hay que cambiarlo.";
		case "quitar":
			return r.texto ? `Quitarlo. ${r.texto}` : "Quitarlo.";
		case "cambiar":
			return `Cambiarlo por: ${r.texto ?? ""}`;
		default:
			return r.texto ?? "";
	}
}

export async function construirEntrada(
	env: Entorno,
	trabajoId: string,
	t: TrabajoDoc,
): Promise<{ entrada: EntradaCorreccion; hash: string; draftRevisionId: string | null }> {
	const { ctx } = env;
	const e = await leerParaAnclar(env, t.collection, t.entryId);
	const coms = await comentariosDe(ctx, t.collection, t.entryId);
	const guias = await allRows(collections(ctx).guias, { orderBy: { orden: "asc" } }, 200);
	const reglas = await allRows(collections(ctx).reglas, {}, 2000);
	return {
		entrada: {
			trabajoId,
			collection: t.collection,
			entryId: t.entryId,
			titulo: e.doc.titulo,
			extracto: e.doc.extracto,
			referencias: e.doc.referencias,
			bloques: bloquesParaIA(e.doc.content),
			comentarios: comentariosParaIA(coms),
			guias: guias.map((g) => ({ nombre: g.data.nombre, markdown: g.data.markdown })),
			reglas: reglas
				.filter((r) => r.data.respuesta && r.data.respuesta.tipo !== "luego")
				.map((r) => ({ pregunta: r.data.pregunta, respuesta: textoRespuesta(r.data.respuesta!) })),
			completa: t.completa,
		},
		hash: e.hash,
		draftRevisionId: e.draftRevisionId,
	};
}

// ─── Motor B: cola, reclamar, artículo ─────────────────────────────

export async function cola(env: Entorno): Promise<{
	trabajos: Array<TrabajoVista & { collection: string; entryId: string; titulo: string; comentarios: number }>;
}> {
	const { ctx } = env;
	const rows = await allRows(collections(ctx).trabajos, { where: { estado: { in: ["cola", "en_curso"] } }, orderBy: { creado: "asc" } }, 500);
	const out: Array<TrabajoVista & { collection: string; entryId: string; titulo: string; comentarios: number }> = [];
	for (const { id, data } of rows) {
		if (data.motor !== "local") continue;
		let titulo = data.entryId;
		try {
			const item = await ctx.content?.get(data.collection, data.entryId);
			if (item) titulo = tituloDe(item, camposDe(env.opciones, data.collection));
		} catch {
			/* el título es decorativo */
		}
		const rev = await leerRevision(ctx, data.collection, data.entryId);
		out.push({ ...trabajoVista(id, data), collection: data.collection, entryId: data.entryId, titulo, comentarios: rev.abiertos });
	}
	return { trabajos: out };
}

function reclamable(t: TrabajoDoc, porId: boolean): boolean {
	if (t.estado === "cola") return porId || t.motor === "local";
	if (t.estado === "en_curso" && t.motor === "local") {
		return porId || !t.reclamadoHasta || Date.parse(t.reclamadoHasta) < Date.now();
	}
	if (t.estado === "error") return porId;
	return false;
}

export async function reclamar(
	env: Entorno,
	trabajoId?: string,
): Promise<{ entrada: EntradaCorreccion; instrucciones: string } | { vacio: true }> {
	const { ctx } = env;
	const { trabajos } = collections(ctx);
	let elegido: { id: string; data: TrabajoDoc } | null = null;
	if (trabajoId) {
		const t = await trabajos.get(trabajoId);
		if (!t) throw PluginRouteError.notFound("No existe ese trabajo.");
		if (!reclamable(t, true)) throw PluginRouteError.conflict(`Ese trabajo no se puede reclamar (estado: ${t.estado}).`);
		elegido = { id: trabajoId, data: t };
	} else {
		const rows = await allRows(trabajos, { where: { estado: { in: ["cola", "en_curso"] } }, orderBy: { creado: "asc" } }, 500);
		elegido = rows.find((r) => reclamable(r.data, false)) ?? null;
	}
	if (!elegido) return { vacio: true };
	const { entrada, hash, draftRevisionId } = await construirEntrada(env, elegido.id, elegido.data);
	const ahora = nowIso();
	await trabajos.put(elegido.id, {
		...elegido.data,
		estado: "en_curso",
		error: null,
		baseHash: hash,
		baseDraftRevisionId: draftRevisionId,
		latido: ahora,
		reclamadoHasta: new Date(Date.now() + RECLAMO_MS).toISOString(),
	});
	return { entrada, instrucciones: instruccionesParaAgente() };
}

export async function articuloDeTrabajo(env: Entorno, trabajoId: string): Promise<{ entrada: EntradaCorreccion; instrucciones: string }> {
	const t = await collections(env.ctx).trabajos.get(trabajoId);
	if (!t) throw PluginRouteError.notFound("No existe ese trabajo.");
	const { entrada } = await construirEntrada(env, trabajoId, t);
	return { entrada, instrucciones: instruccionesParaAgente() };
}

// ─── Entrega (común a los dos motores) ─────────────────────────────

export interface ResultadoEntrega {
	estado: EstadoTrabajo;
	cambios: number;
	rechazadas: OpRechazada[];
}

function claveEntrega(trabajoId: string): string {
	return `entrega:${trabajoId}`;
}

export async function entregar(
	env: Entorno,
	trabajoId: string,
	salidaBruta: unknown,
	extra: { usage?: UsoIA | null; coste?: number | null; modelo?: string | null; forzarBase?: boolean } = {},
): Promise<ResultadoEntrega> {
	const { ctx } = env;
	const { trabajos, cambios, comentarios } = collections(ctx);
	const t = await trabajos.get(trabajoId);
	if (!t) throw PluginRouteError.notFound("No existe ese trabajo.");

	// Idempotencia: una entrega repetida devuelve el resultado guardado.
	if (t.estado === "hecho") {
		const guardado = await ctx.kv.get<ResultadoEntrega>(claveEntrega(trabajoId));
		return guardado ?? { estado: "hecho", cambios: 0, rechazadas: [] };
	}
	if (t.estado === "cancelado") throw PluginRouteError.conflict("Este trabajo se canceló.");
	if (t.estado === "conflicto" && !extra.forzarBase) return { estado: "conflicto", cambios: 0, rechazadas: [] };

	let salida: SalidaCorreccion;
	try {
		salida = validarSalida(salidaBruta);
	} catch (error) {
		throw PluginRouteError.badRequest((error as Error).message);
	}

	const entrada = await leerParaAnclar(env, t.collection, t.entryId);
	if (!extra.forzarBase && t.baseHash && t.baseHash !== entrada.hash) {
		await trabajos.put(trabajoId, {
			...t,
			estado: "conflicto",
			salidaPendiente: salida,
			terminado: nowIso(),
			latido: nowIso(),
			usage: extra.usage ?? t.usage ?? null,
			costeEstimado: extra.coste ?? t.costeEstimado ?? null,
			error: "Alguien cambió el texto mientras se corregía.",
		});
		return { estado: "conflicto", cambios: 0, rechazadas: [] };
	}

	const ajustes = await leerAjustes(ctx);
	const coms = await comentariosDe(ctx, t.collection, t.entryId);
	const abiertos = coms.filter((c) => esAbiertoPrincipal(c.data));
	const res = aplicarOps(entrada.doc, salida.ops, {
		comentarios: abiertos.map((c) => ({ id: c.id, ancla: c.data.ancla })),
		completa: t.completa,
		terminosSensibles: terminosSensibles(ajustes),
	});
	const rev = await leerRevision(ctx, t.collection, t.entryId);
	const vuelta = rev.vuelta + 1;
	const guardada = res.cambios.length
		? await escribirDoc(env, entrada, res.doc, `Antes de la corrección de la IA (vuelta ${vuelta})`)
		: entrada;
	const creado = nowIso();
	const aplicados = new Set<string>();
	for (const [i, cambio] of res.cambios.entries()) {
		const doc: CambioDoc = {
			...cambio,
			collection: t.collection,
			entryId: t.entryId,
			vuelta,
			trabajoId,
			orden: i,
			veredicto: "pendiente",
			nota: null,
			veredictoPor: null,
			creado,
		};
		await cambios.put(`${trabajoId}-${String(i).padStart(4, "0")}`, doc);
		for (const id of cambio.comentarioIds) aplicados.add(id);
	}

	const porId = new Map(abiertos.map((c) => [c.id, c.data]));
	const resueltos = new Set<string>();
	for (const r of salida.resoluciones) {
		const c = porId.get(r.comentarioId);
		if (!c || resueltos.has(r.comentarioId)) continue;
		resueltos.add(r.comentarioId);
		await comentarios.put(r.comentarioId, { ...c, estado: r.accion, respuestaIA: r.nota || null });
	}
	for (const id of aplicados) {
		const c = porId.get(id);
		if (!c || resueltos.has(id)) continue;
		await comentarios.put(id, { ...c, estado: "aplicado", respuestaIA: c.respuestaIA ?? null });
	}

	await recalcular(ctx, t.collection, t.entryId, {
		extra: (r) => {
			r.vuelta = vuelta;
			r.estado = "cambios_por_ver";
			r.hash = guardada.hash;
			r.aprobacion = null;
		},
	});

	const resultado: ResultadoEntrega = { estado: "hecho", cambios: res.cambios.length, rechazadas: res.rechazadas };
	await trabajos.put(trabajoId, {
		...t,
		estado: "hecho",
		terminado: nowIso(),
		latido: nowIso(),
		reclamadoHasta: null,
		error: null,
		salidaPendiente: null,
		usage: extra.usage ?? t.usage ?? null,
		costeEstimado: extra.coste ?? t.costeEstimado ?? null,
		modelo: (extra.modelo as ModeloId | undefined) ?? t.modelo,
	});
	await ctx.kv.set(claveEntrega(trabajoId), resultado);

	await auditar(ctx, {
		accion: "entregar",
		userId: null,
		collection: t.collection,
		entryId: t.entryId,
		revisionId: guardada.draftRevisionId,
		hash: guardada.hash,
		detalle: `${trabajoId}: ${res.cambios.length} cambio(s), ${res.rechazadas.length} rechazada(s)`,
	});

	const quien = await buscarUsuario(ctx, t.creadoPor);
	if (quien && quien.role < 50) {
		const titulo = guardada.doc.titulo || t.entryId;
		await enviarCorreo(ctx, {
			to: quien.email,
			subject: `Ya está corregido «${titulo}»`,
			text: [
				`Hola, ${quien.nombre}:`,
				"",
				`«${titulo}» ya tiene la corrección con tus comentarios: ${res.cambios.length} cambio(s) para que los veas.`,
				"",
				enlaceArticulo(ctx, t.collection, t.entryId),
			].join("\n"),
		});
	}
	return resultado;
}

/** Reintenta aplicar la salida guardada de un conflicto sobre el texto actual. */
export async function aplicarPendiente(env: Entorno, trabajoId: string): Promise<{ trabajo: TrabajoVista }> {
	const { trabajos } = collections(env.ctx);
	const t = await trabajos.get(trabajoId);
	if (!t) throw PluginRouteError.notFound("No existe ese trabajo.");
	if (t.estado !== "conflicto" || !t.salidaPendiente) {
		throw PluginRouteError.conflict("Este trabajo no tiene una corrección pendiente de aplicar.");
	}
	await entregar(env, trabajoId, t.salidaPendiente, { forzarBase: true });
	const final = (await trabajos.get(trabajoId))!;
	return { trabajo: trabajoVista(trabajoId, final) };
}

export async function cancelar(env: Entorno, trabajoId: string): Promise<{ ok: true }> {
	const { ctx } = env;
	const { trabajos } = collections(ctx);
	const t = await trabajos.get(trabajoId);
	if (!t) throw PluginRouteError.notFound("No existe ese trabajo.");
	if (activo(t) || t.estado === "error" || t.estado === "conflicto") {
		await trabajos.put(trabajoId, { ...t, estado: "cancelado", terminado: nowIso() });
	}
	try {
		await ctx.cron?.cancel(nombreCron(trabajoId));
	} catch {
		/* ya no estaba programado */
	}
	return { ok: true };
}

// ─── Motor A: ejecución desde el hook cron ─────────────────────────

export async function ejecutarTrabajoApi(env: Entorno, trabajoId: string): Promise<void> {
	const { ctx } = env;
	const { trabajos } = collections(ctx);
	const t = await trabajos.get(trabajoId);
	if (!t || t.estado !== "cola" || t.motor !== "api") return;
	const fallar = async (mensaje: string) => {
		const actual = (await trabajos.get(trabajoId)) ?? t;
		await trabajos.put(trabajoId, { ...actual, estado: "error", error: mensaje, terminado: nowIso(), latido: nowIso() });
	};
	try {
		const ajustes = await leerAjustes(ctx);
		const apiKey = await leerClaveApi(env.opciones.claveApi ?? "ANTHROPIC_API_KEY");
		if (!apiKey) return await fallar("Falta la clave de la API de Anthropic en el servidor.");
		if (await topeAlcanzado(ctx, ajustes)) return await fallar("Se ha alcanzado el tope de gasto de este mes.");
		const { entrada, hash, draftRevisionId } = await construirEntrada(env, trabajoId, t);
		await trabajos.put(trabajoId, {
			...t,
			estado: "en_curso",
			baseHash: hash,
			baseDraftRevisionId: draftRevisionId,
			latido: nowIso(),
		});
		const r = await corregirConApi(entrada, {
			apiKey,
			modelo: t.modelo ?? ajustes.modeloDefecto,
			esfuerzo: t.esfuerzo ?? ajustes.esfuerzo,
		});
		await sumarGasto(ctx, r.coste);
		const actual = await trabajos.get(trabajoId);
		if (actual?.estado === "cancelado") return;
		await trabajos.put(trabajoId, { ...(actual ?? t), usage: r.usage, costeEstimado: r.coste, latido: nowIso() });
		await entregar(env, trabajoId, r.salida, { usage: r.usage, coste: r.coste, modelo: r.modelo });
	} catch (error) {
		const mensaje =
			error instanceof ErrorMotor
				? error.message
				: `No se ha podido corregir: ${error instanceof Error ? error.message : String(error)}`;
		ctx.log.error(`[revisión] trabajo ${trabajoId} falló`, { error: String(error) });
		await fallar(mensaje);
	}
}

