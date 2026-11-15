/**
 * La guía aprende de la revisora.
 *
 * 1. Señales: cada acción de una revisora (comentario, «Cambiarlo ya», «No es
 *    esto», «Deshacer» un cambio de la IA, respuesta a una pregunta, edición en
 *    el editor nativo) se guarda en la colección `senales`.
 * 2. Síntesis: un cron diario, una tarea a los 10 minutos de cada «Aprobar» o
 *    de cada señal «para todos los artículos», o el botón «Actualizar ahora»
 *    pasan las señales pendientes por Claude (o Claude Code por MCP), que
 *    devuelve operaciones sobre los criterios aprendidos (`aprendizajes`).
 * 3. La guía `aprendido` (colección `guias`) se regenera siempre a partir de los
 *    criterios activos, con historial de sus últimas 20 versiones.
 */

import { PluginRouteError } from "emdash";
import type { PluginContext } from "emdash";

import { buscarUsuario, esAdmin, nombreDe, type Usuario } from "./acceso.js";
import { leerAjustes, leerClaveApi, sumarGasto, topeAlcanzado } from "./ajustes.js";
import { textoDeBloque } from "./bloques.js";
import { camposDe, tituloDe, type Entorno } from "./contenido.js";
import { enlaceGuias, enviarCorreo } from "./correo.js";
import { aprenderConApi, ErrorMotor } from "./motor-api.js";
import { instruccionesAprendizaje, validarSalidaAprendizaje } from "./prompt-aprendizaje.js";
import { auditar } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId } from "./store.js";
import {
	GUIA_APRENDIDA_ID,
	type Ajustes,
	type AprendizajeDoc,
	type AprendizajeVista,
	type DocRevisable,
	type EntradaAprendizaje,
	type EstadoAprendizajeVista,
	type EvidenciaAprendizaje,
	type GuiaDoc,
	type GuiaHistorialDoc,
	type GuiaHistorialVista,
	type PTNode,
	type SalidaAprendizaje,
	type SenalDoc,
	type TipoSenal,
} from "./types.js";

/** Señales que se envían como mucho en cada pasada; el resto espera a la siguiente. */
export const MAX_SENALES_POR_PASADA = 80;
/** Versiones anteriores de la guía que se guardan. */
export const MAX_HISTORIAL_GUIA = 20;
/** Minutos de espera tras «Aprobar» o una señal «para todos los artículos». */
export const MINUTOS_PRONTO = 10;

export const CRON_DIARIO = "aprendizaje";
export const CRON_PRONTO = "aprendizaje-pronto";
export const CRON_AHORA = "aprendizaje-ahora";

const KV_CRON = "aprendizaje:cron";
const KV_PRONTO = "aprendizaje:pronto";
const KV_ESTADO = "aprendizaje:estado";
const KV_LOTE = "aprendizaje:lote";
const KV_BLOQUEO = "aprendizaje:bloqueo";
/** Una síntesis que no termina en este tiempo se da por perdida. */
const CADUCIDAD_MS = 15 * 60 * 1000;

const MAX_CAMPO = 1000;
const MAX_EDICION = 1500;
const MAX_BLOQUES_EDICION = 3;

interface EstadoKV {
	ultimaActualizacion: string | null;
	ultimoResumen: string | null;
	error: string | null;
	enCursoDesde: string | null;
}

// ─── Quién es revisora ─────────────────────────────────────────────

/** Puede aprobar y no es administradora (salvo que los ajustes incluyan a los administradores). */
export function esRevisora(user: { role: number } | null | undefined, ajustes: Ajustes): boolean {
	if (!user || user.role < ajustes.rolAprueba) return false;
	return ajustes.aprenderDeAdministradores || !esAdmin(user as Usuario);
}

export interface Autor {
	id: string;
	role: number;
	nombre: string;
}

export function autorDe(user: Usuario): Autor {
	return { id: user.id, role: user.role, nombre: nombreDe(user) };
}

// ─── Señales ───────────────────────────────────────────────────────

export function recortar(texto: string | null | undefined, max = MAX_CAMPO): string | null {
	if (!texto) return null;
	const t = texto.trim();
	if (!t) return null;
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Texto plano de un `antes`/`despues` de un cambio. */
export function textoDeCambio(v: PTNode | string | null | undefined): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "string") return v;
	try {
		return textoDeBloque(v);
	} catch {
		return "";
	}
}

async function tituloDeEntrada(env: Entorno, collection: string, entryId: string): Promise<string> {
	try {
		const item = await env.ctx.content?.get(collection, entryId);
		return item ? tituloDe(item, camposDe(env.opciones, collection)) : entryId;
	} catch {
		return entryId;
	}
}

export interface NuevaSenal {
	tipo: TipoSenal;
	collection: string;
	entryId: string;
	titulo?: string | null;
	campo?: string | null;
	cita?: string | null;
	antes?: string | null;
	despues?: string | null;
	texto?: string | null;
	nota?: string | null;
	general?: boolean;
	ref?: string | null;
}

/**
 * Guarda una señal si quien actúa es revisora. Nunca lanza: aprender es
 * secundario y no puede romper la acción de la revisora. Con `general`,
 * programa una síntesis a los 10 minutos.
 */
export async function registrarSenal(env: Entorno, autor: Autor | null | undefined, s: NuevaSenal): Promise<string | null> {
	const { ctx } = env;
	try {
		if (!autor) return null;
		const ajustes = await leerAjustes(ctx);
		if (!esRevisora(autor, ajustes)) return null;
		const { senales } = collections(ctx);
		const doc: SenalDoc = {
			tipo: s.tipo,
			userId: autor.id,
			nombre: autor.nombre,
			collection: s.collection,
			entryId: s.entryId,
			titulo: recortar(s.titulo || (await tituloDeEntrada(env, s.collection, s.entryId)), 300) ?? s.entryId,
			campo: s.campo ?? null,
			cita: recortar(s.cita, 500),
			antes: recortar(s.antes),
			despues: recortar(s.despues),
			texto: recortar(s.texto),
			nota: recortar(s.nota),
			general: !!s.general,
			ref: s.ref ?? null,
			fecha: nowIso(),
			procesada: false,
		};
		// «Cambiarlo ya» tras crear el comentario: es la misma acción, se completa la señal.
		let id: string | null = null;
		if (s.ref && s.tipo === "cambiar_ya") {
			const previas = await allRows(senales, { where: { entryId: s.entryId } }, 500);
			const previa = previas.find((r) => r.data.ref === s.ref && !r.data.procesada && r.data.collection === s.collection);
			if (previa) {
				id = previa.id;
				doc.general = doc.general || previa.data.general;
				doc.fecha = previa.data.fecha;
			}
		}
		id ??= nuevoId();
		await senales.put(id, doc);
		if (doc.general) await programarPronto(ctx);
		return id;
	} catch (error) {
		ctx.log.warn("[aprendizaje] no se pudo registrar la señal", { error: String(error) });
		return null;
	}
}

/**
 * Resumen de una edición en el editor nativo: los bloques que cambian (como
 * mucho 3) con su texto antes y después, hasta 1.500 caracteres en total.
 * Null si solo cambia el formato.
 */
export function resumenEdicion(antes: DocRevisable, despues: DocRevisable): { antes: string; despues: string; campo: string } | null {
	const partes: Array<{ campo: string; antes: string; despues: string }> = [];
	if (antes.titulo !== despues.titulo) partes.push({ campo: "title", antes: antes.titulo, despues: despues.titulo });
	if (antes.extracto !== despues.extracto) partes.push({ campo: "excerpt", antes: antes.extracto, despues: despues.extracto });
	const previos = new Map(antes.content.map((b) => [b._key, b]));
	const vistos = new Set<string>();
	for (const b of despues.content) {
		vistos.add(b._key);
		const a = previos.get(b._key);
		const tNuevo = textoDeCambio(b);
		const tViejo = a ? textoDeCambio(a) : "";
		if (tNuevo !== tViejo) partes.push({ campo: "content", antes: tViejo, despues: tNuevo });
	}
	for (const a of antes.content) {
		if (!vistos.has(a._key)) {
			const t = textoDeCambio(a);
			if (t) partes.push({ campo: "content", antes: t, despues: "" });
		}
	}
	if (antes.referencias !== despues.referencias) partes.push({ campo: "references", antes: antes.referencias, despues: despues.referencias });
	if (partes.length === 0) return null;
	const elegidas = partes.slice(0, MAX_BLOQUES_EDICION);
	const porLado = Math.floor(MAX_EDICION / 2 / elegidas.length);
	const unir = (lado: "antes" | "despues") =>
		elegidas.map((p) => recortar(p[lado], porLado) ?? "(vacío)").join("\n¶ ");
	const campos = [...new Set(elegidas.map((p) => p.campo))];
	return {
		antes: unir("antes"),
		despues: unir("despues"),
		campo: campos.length === 1 ? campos[0]! : campos.join(","),
	};
}

/** `content:afterSave` de una revisora en el editor nativo. */
export async function senalDeEdicion(
	env: Entorno,
	actor: { id: string; role: number } | null | undefined,
	collection: string,
	entryId: string,
	anterior: DocRevisable | null,
	actual: DocRevisable,
): Promise<void> {
	if (!actor || !anterior) return;
	const resumen = resumenEdicion(anterior, actual);
	if (!resumen) return;
	const u = await buscarUsuario(env.ctx, actor.id);
	await registrarSenal(
		env,
		{ id: actor.id, role: u?.role ?? actor.role, nombre: u?.nombre ?? "Revisora" },
		{
			tipo: "edicion",
			collection,
			entryId,
			titulo: actual.titulo,
			campo: resumen.campo,
			antes: resumen.antes,
			despues: resumen.despues,
			nota: "Edición directa en el editor",
		},
	);
}

// ─── Programación (cron) ───────────────────────────────────────────

function cronDiario(ajustes: Ajustes): string {
	return `0 ${ajustes.horaAprendizaje} * * *`;
}

/** Registra (o cancela) el cron diario según los ajustes. Idempotente y barato. */
export async function asegurarCronDiario(ctx: PluginContext, ajustes?: Ajustes, forzar = false): Promise<void> {
	try {
		if (!ctx.cron) return;
		const a = ajustes ?? (await leerAjustes(ctx));
		const esperado = a.aprenderAuto ? cronDiario(a) : "off";
		if (!forzar && (await ctx.kv.get<string>(KV_CRON)) === esperado) return;
		if (a.aprenderAuto) await ctx.cron.schedule(CRON_DIARIO, { schedule: esperado });
		else await ctx.cron.cancel(CRON_DIARIO);
		await ctx.kv.set(KV_CRON, esperado);
	} catch (error) {
		ctx.log.warn("[aprendizaje] no se pudo programar el cron diario", { error: String(error) });
	}
}

/**
 * Programa una síntesis dentro de 10 minutos, salvo que ya haya una
 * programada (antirrebote), el aprendizaje automático esté apagado o no haya
 * señales pendientes. Devuelve true si la programó.
 */
export async function programarPronto(ctx: PluginContext): Promise<boolean> {
	try {
		if (!ctx.cron) return false;
		const ajustes = await leerAjustes(ctx);
		if (!ajustes.aprenderAuto) return false;
		const marca = await ctx.kv.get<string>(KV_PRONTO);
		if (marca && Date.parse(marca) + CADUCIDAD_MS > Date.now()) return false;
		if ((await collections(ctx).senales.count({ procesada: false })) === 0) return false;
		const cuando = new Date(Date.now() + MINUTOS_PRONTO * 60 * 1000).toISOString();
		await ctx.cron.schedule(CRON_PRONTO, { schedule: cuando });
		await ctx.kv.set(KV_PRONTO, cuando);
		return true;
	} catch (error) {
		ctx.log.warn("[aprendizaje] no se pudo programar la síntesis", { error: String(error) });
		return false;
	}
}

/** Hook `cron`: true si el evento era del aprendizaje. */
export async function alCron(env: Entorno, nombre: string): Promise<boolean> {
	if (nombre !== CRON_DIARIO && nombre !== CRON_PRONTO && nombre !== CRON_AHORA) return false;
	const { ctx } = env;
	if (nombre === CRON_PRONTO || nombre === CRON_AHORA) await ctx.kv.delete(KV_PRONTO);
	await sintetizarConApi(env, { manual: nombre === CRON_AHORA });
	return true;
}

// ─── Estado ────────────────────────────────────────────────────────

async function leerEstado(ctx: PluginContext): Promise<EstadoKV> {
	return {
		ultimaActualizacion: null,
		ultimoResumen: null,
		error: null,
		enCursoDesde: null,
		...((await ctx.kv.get<Partial<EstadoKV>>(KV_ESTADO)) ?? {}),
	};
}

async function cambiarEstado(ctx: PluginContext, cambios: Partial<EstadoKV>): Promise<void> {
	await ctx.kv.set(KV_ESTADO, { ...(await leerEstado(ctx)), ...cambios });
}

async function tomarBloqueo(ctx: PluginContext): Promise<boolean> {
	const actual = await ctx.kv.getVersioned<string>(KV_BLOQUEO);
	if (actual?.value && Date.parse(actual.value) + CADUCIDAD_MS > Date.now()) return false;
	const r = await ctx.kv.compareAndSet(KV_BLOQUEO, actual?.revision ?? null, nowIso());
	return r.applied;
}

async function soltarBloqueo(ctx: PluginContext): Promise<void> {
	await ctx.kv.delete(KV_BLOQUEO);
}

function ordenarAprendizajes(lista: AprendizajeVista[]): AprendizajeVista[] {
	return lista.sort(
		(a, b) =>
			(a.estado === b.estado ? 0 : a.estado === "activo" ? -1 : 1) ||
			a.tema.localeCompare(b.tema, "es") ||
			a.creado.localeCompare(b.creado),
	);
}

export async function estadoAprendizaje(env: Entorno): Promise<EstadoAprendizajeVista> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	await asegurarCronDiario(ctx, ajustes);
	const cols = collections(ctx);
	const guia = await cols.guias.get(GUIA_APRENDIDA_ID);
	const estado = await leerEstado(ctx);
	const clave = await leerClaveApi(ctx, env.opciones.claveApi ?? "ANTHROPIC_API_KEY");
	const parado: EstadoAprendizajeVista["parado"] = !ajustes.aprenderAuto
		? "desactivado"
		: !clave
			? "sin_clave"
			: (await topeAlcanzado(ctx, ajustes))
				? "tope"
				: null;
	const marca = await ctx.kv.get<string>(KV_PRONTO);
	const enCurso =
		(!!estado.enCursoDesde && Date.parse(estado.enCursoDesde) + CADUCIDAD_MS > Date.now()) ||
		(!!marca && Date.parse(marca) <= Date.now() + 10_000 && Date.parse(marca) + CADUCIDAD_MS > Date.now());
	const filas = await allRows(cols.aprendizajes, {}, 2000);
	return {
		guia: { id: GUIA_APRENDIDA_ID, nombre: guia?.nombre ?? ajustes.nombreGuiaAprendida, actualizado: guia?.actualizado ?? null },
		pendientes: await cols.senales.count({ procesada: false }),
		ultimaActualizacion: estado.ultimaActualizacion,
		ultimoResumen: estado.ultimoResumen,
		parado,
		error: estado.error,
		enCurso,
		apiDisponible: !!clave,
		aprendizajes: ordenarAprendizajes(filas.map((r) => ({ ...r.data, id: r.id }))),
	};
}

// ─── Entrada para la IA ────────────────────────────────────────────

async function senalesPendientes(ctx: PluginContext): Promise<Array<{ id: string; data: SenalDoc }>> {
	const page = await collections(ctx).senales.query({
		where: { procesada: false },
		orderBy: { fecha: "asc" },
		limit: MAX_SENALES_POR_PASADA,
	});
	return page.items;
}

function articulosDe(a: AprendizajeDoc): number {
	return new Set(a.evidencias.map((e) => `${e.collection ?? ""}:${e.entryId}`)).size;
}

export async function construirEntradaAprendizaje(
	ctx: PluginContext,
	senales: Array<{ id: string; data: SenalDoc }>,
): Promise<EntradaAprendizaje> {
	const cols = collections(ctx);
	const guias = await allRows(cols.guias, { orderBy: { orden: "asc" } }, 200);
	const aprendizajes = await allRows(cols.aprendizajes, {}, 2000);
	return {
		senales: senales.map(({ id, data }) => {
			const { procesada: _p, userId: _u, ref: _r, ...resto } = data;
			return { ...resto, id };
		}),
		guias: guias.map((g) => ({ nombre: g.data.nombre, markdown: g.data.markdown })),
		aprendizajes: aprendizajes.map((r) => ({
			id: r.id,
			texto: r.data.texto,
			tema: r.data.tema,
			estado: r.data.estado,
			retiradoPor: r.data.retiradoPor ?? null,
			articulos: articulosDe(r.data),
		})),
	};
}

// ─── Guía generada ─────────────────────────────────────────────────

function fechaCorta(iso: string, locale: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
	try {
		return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
			.format(d)
			.replace(/\./g, "");
	} catch {
		return iso.slice(0, 10);
	}
}

/** Markdown de la guía a partir de los criterios activos, agrupados por tema. */
export function generarMarkdown(nombre: string, activos: AprendizajeDoc[], locale = "es-ES"): string {
	const lineas = [
		`# ${nombre}`,
		"",
		"Criterios que la IA ha sacado de las correcciones de la revisora. Esta guía se actualiza sola: no la edites a mano. Si un criterio de aquí choca con otra guía, manda el más reciente de la revisora.",
	];
	if (activos.length === 0) {
		lineas.push("", "Todavía no hay criterios aprendidos.");
		return lineas.join("\n");
	}
	const porTema = new Map<string, AprendizajeDoc[]>();
	for (const a of [...activos].sort((x, y) => x.creado.localeCompare(y.creado))) {
		const lista = porTema.get(a.tema) ?? [];
		lista.push(a);
		porTema.set(a.tema, lista);
	}
	for (const [tema, lista] of porTema) {
		lineas.push("", `## ${tema}`, "");
		for (const a of lista) {
			const titulos = [...new Set(a.evidencias.map((e) => e.titulo))];
			const visto = titulos.length
				? `; visto en: ${titulos.slice(0, 5).map((t) => `«${t}»`).join(", ")}${titulos.length > 5 ? ` y ${titulos.length - 5} más` : ""}`
				: "";
			lineas.push(`- ${a.texto.replace(/\s*\n+\s*/g, " ")} (desde el ${fechaCorta(a.creado, locale)}${visto})`);
		}
	}
	return lineas.join("\n");
}

/** Justo detrás de la primera guía: su `orden` + 0,5 (las demás guías tienen `orden` entero). */
async function ordenGuia(ctx: PluginContext): Promise<number> {
	const otras = (await allRows(collections(ctx).guias, { orderBy: { orden: "asc" } }, 500)).filter((g) => g.id !== GUIA_APRENDIDA_ID);
	const primera = otras[0];
	return primera ? primera.data.orden + 0.5 : 0.5;
}

async function escribirGuia(env: Entorno, markdown: string): Promise<GuiaDoc> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	const guia: GuiaDoc = {
		nombre: ajustes.nombreGuiaAprendida,
		markdown,
		orden: await ordenGuia(ctx),
		actualizado: nowIso(),
		automatica: true,
	};
	await collections(ctx).guias.put(GUIA_APRENDIDA_ID, guia);
	return guia;
}

export async function regenerarGuia(env: Entorno): Promise<GuiaDoc> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	const activos = await allRows(collections(ctx).aprendizajes, { where: { estado: "activo" } }, 2000);
	return escribirGuia(env, generarMarkdown(ajustes.nombreGuiaAprendida, activos.map((r) => r.data), env.opciones.locale ?? "es-ES"));
}

// ─── Historial de la guía ──────────────────────────────────────────

async function guardarHistorial(ctx: PluginContext, resumen: string): Promise<void> {
	const cols = collections(ctx);
	const guia = await cols.guias.get(GUIA_APRENDIDA_ID);
	const aprendizajes = await allRows(cols.aprendizajes, {}, 2000);
	if (!guia && aprendizajes.length === 0) return;
	const previas = await allRows(cols.guias_historial, { orderBy: { fecha: "desc" } }, 500);
	// Fechas estrictamente crecientes para ordenar bien dos copias en el mismo milisegundo.
	let fecha = new Date();
	const ultima = previas[0];
	if (ultima) {
		const t = Date.parse(ultima.data.fecha);
		if (Number.isFinite(t) && t >= fecha.getTime()) fecha = new Date(t + 1);
	}
	const doc: GuiaHistorialDoc = {
		fecha: fecha.toISOString(),
		desde: guia?.actualizado ?? null,
		resumen: recortar(resumen, 1000) ?? "",
		markdown: guia?.markdown ?? "",
		aprendizajes: aprendizajes.map((r) => ({ id: r.id, data: r.data })),
	};
	await cols.guias_historial.put(nuevoId(), doc);
	const sobran = previas.slice(MAX_HISTORIAL_GUIA - 1);
	if (sobran.length) await cols.guias_historial.deleteMany(sobran.map((r) => r.id));
}

export async function listarHistorialGuia(ctx: PluginContext): Promise<{ versiones: GuiaHistorialVista[] }> {
	const rows = await allRows(collections(ctx).guias_historial, { orderBy: { fecha: "desc" } }, MAX_HISTORIAL_GUIA * 2);
	return {
		versiones: rows.map((r) => ({
			id: r.id,
			fecha: r.data.fecha,
			desde: r.data.desde,
			resumen: r.data.resumen,
			criterios: r.data.aprendizajes.filter((a) => a.data.estado === "activo").length,
		})),
	};
}

/** Repone el markdown y el conjunto de criterios de una versión anterior (guardando antes la actual). */
export async function restaurarHistorialGuia(env: Entorno, user: Usuario, id: string): Promise<EstadoAprendizajeVista> {
	const { ctx } = env;
	const cols = collections(ctx);
	const version = await cols.guias_historial.get(id);
	if (!version) throw PluginRouteError.notFound("No se encuentra esa versión de la guía.");
	await guardarHistorial(ctx, `Antes de restaurar la versión del ${fechaCorta(version.desde ?? version.fecha, env.opciones.locale ?? "es-ES")}`);
	const actuales = await allRows(cols.aprendizajes, {}, 5000);
	if (actuales.length) await cols.aprendizajes.deleteMany(actuales.map((r) => r.id));
	for (const a of version.aprendizajes) await cols.aprendizajes.put(a.id, a.data);
	if (version.markdown) await escribirGuia(env, version.markdown);
	else await regenerarGuia(env);
	await auditar(ctx, {
		accion: "aprender",
		userId: user.id,
		collection: "",
		entryId: GUIA_APRENDIDA_ID,
		detalle: `restaurar ${id}`,
	});
	return estadoAprendizaje(env);
}

// ─── Retirar a mano ────────────────────────────────────────────────

export async function retirarAprendizaje(env: Entorno, user: Usuario, id: string): Promise<EstadoAprendizajeVista> {
	const { ctx } = env;
	const { aprendizajes } = collections(ctx);
	const a = await aprendizajes.get(id);
	if (!a) throw PluginRouteError.notFound("No se encuentra ese criterio.");
	if (a.estado !== "retirado") {
		await guardarHistorial(ctx, `Antes de retirar a mano: «${recortar(a.texto, 120)}»`);
		await aprendizajes.put(id, { ...a, estado: "retirado", retiradoPor: nombreDe(user), actualizado: nowIso() });
		await regenerarGuia(env);
		await auditar(ctx, {
			accion: "aprender",
			userId: user.id,
			collection: "",
			entryId: GUIA_APRENDIDA_ID,
			detalle: `retirar ${id}`,
		});
	}
	return estadoAprendizaje(env);
}

// ─── Aplicar la salida (común a la API y a Claude Code) ────────────

export interface ResultadoAprendizajeAplicado {
	añadidos: number;
	modificados: number;
	retirados: number;
	procesadas: number;
	resumen: string;
}

function evidenciaDe(id: string, s: SenalDoc): EvidenciaAprendizaje {
	return {
		senalId: id,
		collection: s.collection,
		entryId: s.entryId,
		titulo: s.titulo,
		cita: recortar(s.cita ?? s.antes, 200),
		fecha: s.fecha,
	};
}

function plural(n: number, uno: string, varios: string): string {
	return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Valida la salida (forma, ids existentes, señales existentes, criterios
 * retirados a mano) y la aplica: guarda la versión anterior de la guía,
 * cambia los criterios, regenera la guía, marca como procesadas las señales
 * del lote (se usen o no) y avisa por correo.
 */
export async function aplicarAprendizaje(
	env: Entorno,
	salidaBruta: unknown,
	lote: string[],
	meta: { userId?: string | null; origen: "api" | "claude_code" },
): Promise<ResultadoAprendizajeAplicado> {
	const { ctx } = env;
	const cols = collections(ctx);
	let salida: SalidaAprendizaje;
	try {
		salida = validarSalidaAprendizaje(salidaBruta);
	} catch (error) {
		throw PluginRouteError.badRequest((error as Error).message);
	}

	const existentes = new Map((await allRows(cols.aprendizajes, {}, 5000)).map((r) => [r.id, r.data]));
	const idsSenales = [...new Set(salida.operaciones.flatMap((o) => o.senales))];
	const senales = await cols.senales.getMany(idsSenales);
	const errores: string[] = [];
	salida.operaciones.forEach((o, i) => {
		const donde = `operaciones[${i}]`;
		for (const s of o.senales) if (!senales.has(s)) errores.push(`${donde}: la señal «${s}» no existe.`);
		if (o.op === "añadir") return;
		const a = existentes.get(o.id!);
		if (!a) {
			errores.push(`${donde} (${o.op}): no existe ningún criterio aprendido con id «${o.id}».`);
			return;
		}
		if (o.op === "modificar" && a.estado === "retirado" && a.retiradoPor !== "ia") {
			const conGeneral = o.senales.some((s) => senales.get(s)?.general);
			if (!conGeneral) {
				errores.push(
					`${donde}: el criterio «${o.id}» lo retiró una persona; solo se recupera con una señal marcada «para todos los artículos».`,
				);
			}
		}
	});
	if (errores.length) {
		const max = 12;
		const lineas = errores.slice(0, max).map((e) => `- ${e}`);
		if (errores.length > max) lineas.push(`- … y ${errores.length - max} errores más.`);
		throw PluginRouteError.badRequest(`La salida del aprendizaje no es válida:\n${lineas.join("\n")}`);
	}

	const ahora = nowIso();
	const añadidos: string[] = [];
	const modificados: string[] = [];
	const retirados: string[] = [];
	const cambios = new Map<string, AprendizajeDoc>();
	for (const o of salida.operaciones) {
		const evidencias = o.senales.map((s) => evidenciaDe(s, senales.get(s)!));
		if (o.op === "añadir") {
			const doc: AprendizajeDoc = {
				texto: o.texto!,
				tema: o.tema!,
				evidencias,
				estado: "activo",
				retiradoPor: null,
				creado: ahora,
				actualizado: ahora,
			};
			cambios.set(nuevoId(), doc);
			añadidos.push(doc.texto);
			continue;
		}
		const previo = cambios.get(o.id!) ?? existentes.get(o.id!)!;
		if (o.op === "retirar") {
			if (previo.estado === "retirado") continue;
			cambios.set(o.id!, { ...previo, estado: "retirado", retiradoPor: "ia", actualizado: ahora });
			retirados.push(previo.texto);
			continue;
		}
		const conocidas = new Set(previo.evidencias.map((e) => e.senalId));
		const nuevo: AprendizajeDoc = {
			...previo,
			texto: o.texto ?? previo.texto,
			tema: o.tema ?? previo.tema,
			evidencias: [...previo.evidencias, ...evidencias.filter((e) => !conocidas.has(e.senalId))],
			estado: "activo",
			retiradoPor: null,
			actualizado: ahora,
		};
		cambios.set(o.id!, nuevo);
		modificados.push(nuevo.texto);
	}

	const partes = [
		añadidos.length ? plural(añadidos.length, "criterio nuevo", "criterios nuevos") : "",
		modificados.length ? plural(modificados.length, "modificado", "modificados") : "",
		retirados.length ? plural(retirados.length, "retirado", "retirados") : "",
	].filter(Boolean);
	const resumen = partes.length ? `${partes.join(", ")}. ${salida.resumen}`.trim() : salida.resumen || "Sin criterios nuevos.";

	if (cambios.size > 0) {
		await guardarHistorial(ctx, resumen);
		for (const [id, doc] of cambios) await cols.aprendizajes.put(id, doc);
		await regenerarGuia(env);
	}

	// Todas las señales del lote quedan procesadas, se usen o no.
	const procesar = [...new Set([...lote, ...idsSenales])];
	const delLote = await cols.senales.getMany(procesar);
	for (const [id, s] of delLote) if (!s.procesada) await cols.senales.put(id, { ...s, procesada: true });

	await cambiarEstado(ctx, { ultimaActualizacion: ahora, ultimoResumen: resumen, error: null });
	await auditar(ctx, {
		accion: "aprender",
		userId: meta.userId ?? null,
		collection: "",
		entryId: GUIA_APRENDIDA_ID,
		detalle: `${meta.origen}: ${resumen}`.slice(0, 1000),
	});

	if (cambios.size > 0) {
		const ajustes = await leerAjustes(ctx);
		if (ajustes.avisarA) {
			const bloque = (titulo: string, lista: string[]) => (lista.length ? ["", titulo, ...lista.map((t) => `- ${t}`)] : []);
			await enviarCorreo(ctx, {
				to: ajustes.avisarA,
				subject: `La guía «${ajustes.nombreGuiaAprendida}» ha aprendido de las correcciones`,
				text: [
					salida.resumen || resumen,
					...bloque("Criterios nuevos:", añadidos),
					...bloque("Criterios modificados:", modificados),
					...bloque("Criterios retirados:", retirados),
					"",
					"Puedes revisarlos, retirar los que no valgan o volver a una versión anterior en la página de guías:",
					enlaceGuias(ctx, GUIA_APRENDIDA_ID),
				].join("\n"),
			});
		}
	}

	return {
		añadidos: añadidos.length,
		modificados: modificados.length,
		retirados: retirados.length,
		procesadas: delLote.size,
		resumen,
	};
}

// ─── Síntesis con la API ───────────────────────────────────────────

export type ResultadoSintesis =
	| ({ estado: "hecho" } & ResultadoAprendizajeAplicado)
	| { estado: "sin_senales" | "sin_clave" | "tope" | "desactivado" | "ocupado" }
	| { estado: "error"; error: string };

export async function sintetizarConApi(env: Entorno, opts: { manual?: boolean } = {}): Promise<ResultadoSintesis> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	if (!opts.manual && !ajustes.aprenderAuto) return { estado: "desactivado" };
	const apiKey = await leerClaveApi(ctx, env.opciones.claveApi ?? "ANTHROPIC_API_KEY");
	// Sin clave o con el tope alcanzado no se hace nada: las señales se acumulan.
	if (!apiKey) return { estado: "sin_clave" };
	if (await topeAlcanzado(ctx, ajustes)) return { estado: "tope" };
	if (!(await tomarBloqueo(ctx))) return { estado: "ocupado" };
	try {
		const lote = await senalesPendientes(ctx);
		if (lote.length === 0) return { estado: "sin_senales" };
		await cambiarEstado(ctx, { enCursoDesde: nowIso() });
		const entrada = await construirEntradaAprendizaje(ctx, lote);
		const r = await aprenderConApi(entrada, { apiKey, modelo: ajustes.modeloDefecto, esfuerzo: ajustes.esfuerzo });
		await sumarGasto(ctx, r.coste);
		const res = await aplicarAprendizaje(
			env,
			r.salida,
			lote.map((s) => s.id),
			{ origen: "api" },
		);
		return { estado: "hecho", ...res };
	} catch (error) {
		const mensaje =
			error instanceof ErrorMotor || error instanceof PluginRouteError
				? error.message
				: `No se ha podido actualizar la guía: ${error instanceof Error ? error.message : String(error)}`;
		ctx.log.error("[aprendizaje] la síntesis falló", { error: String(error) });
		await cambiarEstado(ctx, { error: mensaje });
		return { estado: "error", error: mensaje };
	} finally {
		await cambiarEstado(ctx, { enCursoDesde: null });
		await soltarBloqueo(ctx);
	}
}

/** «Actualizar ahora»: programa la síntesis por API para dentro de unos segundos. */
export async function actualizarAhora(env: Entorno): Promise<{ programado: boolean; motivo: "sin_clave" | "tope" | "sin_senales" | null; estado: EstadoAprendizajeVista }> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	const clave = await leerClaveApi(ctx, env.opciones.claveApi ?? "ANTHROPIC_API_KEY");
	let motivo: "sin_clave" | "tope" | "sin_senales" | null = null;
	if (!clave) motivo = "sin_clave";
	else if (await topeAlcanzado(ctx, ajustes)) motivo = "tope";
	else if ((await collections(ctx).senales.count({ procesada: false })) === 0) motivo = "sin_senales";
	if (motivo) return { programado: false, motivo, estado: await estadoAprendizaje(env) };
	if (!ctx.cron) throw PluginRouteError.internal("El sitio no tiene planificador de tareas (cron).");
	const cuando = new Date(Date.now() + 2000).toISOString();
	await ctx.cron.schedule(CRON_AHORA, { schedule: cuando });
	await ctx.kv.set(KV_PRONTO, cuando);
	await cambiarEstado(ctx, { error: null });
	return { programado: true, motivo: null, estado: await estadoAprendizaje(env) };
}

// ─── Motor B (Claude Code por MCP) ─────────────────────────────────

export async function pendienteParaAgente(
	env: Entorno,
): Promise<{ vacio: true; pendientes: 0 } | { entrada: EntradaAprendizaje; lote: string[]; pendientes: number; instrucciones: string }> {
	const { ctx } = env;
	const lote = await senalesPendientes(ctx);
	if (lote.length === 0) return { vacio: true, pendientes: 0 };
	const ids = lote.map((s) => s.id);
	await ctx.kv.set(KV_LOTE, ids);
	return {
		entrada: await construirEntradaAprendizaje(ctx, lote),
		lote: ids,
		pendientes: await collections(ctx).senales.count({ procesada: false }),
		instrucciones: instruccionesAprendizaje(),
	};
}

export async function aplicarDeAgente(
	env: Entorno,
	input: { operaciones: unknown; resumen: unknown; lote?: string[] },
	userId: string | null,
): Promise<ResultadoAprendizajeAplicado> {
	const { ctx } = env;
	const lote = input.lote ?? (await ctx.kv.get<string[]>(KV_LOTE)) ?? [];
	const res = await aplicarAprendizaje(env, { operaciones: input.operaciones, resumen: input.resumen }, lote, {
		origen: "claude_code",
		userId,
	});
	await ctx.kv.delete(KV_LOTE);
	return res;
}
