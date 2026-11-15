/**
 * Preguntas y reglas: decisiones que afectan a uno o varios artículos. Se
 * importan como comentarios de tipo «pregunta» y se responden desde el inicio.
 */

import { PluginRouteError } from "emdash";
import type { PluginContentItem } from "emdash";

import { autorDe, registrarSenal } from "./aprendizaje.js";
import { nombreDe, type Usuario } from "./acceso.js";
import { anclaDeFragmento } from "./anclas.js";
import { camposDe, leerParaAnclar, tituloDe, type Entorno } from "./contenido.js";
import { recalcular } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId } from "./store.js";
import type { Ancla, ComentarioDoc, DocRevisable, PreguntaVista, ReglaDoc, RespuestaPregunta } from "./types.js";

export interface PreguntaImportada {
	pregunta: string;
	entradas: Array<{ collection: string; slug?: string; id?: string; cita?: string }>;
}

/** Ancla de una cita buscada en todo el documento: debe aparecer en una sola unidad. */
export function anclaDeCita(doc: DocRevisable, cita: string, base: string | null): Ancla | null {
	const encontradas: Ancla[] = [];
	for (const campo of ["title", "excerpt"] as const) {
		const a = anclaDeFragmento(doc, { campo }, cita, base);
		if (a) encontradas.push(a);
	}
	for (const node of doc.content) {
		if (!node._key) continue;
		const a = anclaDeFragmento(doc, { campo: "content", blockKey: node._key }, cita, base);
		if (a) encontradas.push(a);
		if (encontradas.length > 1) return null;
	}
	return encontradas.length === 1 ? (encontradas[0] ?? null) : null;
}

async function buscarPorSlug(env: Entorno, collection: string, slug: string, cache: Map<string, Map<string, string>>): Promise<string | null> {
	let mapa = cache.get(collection);
	if (!mapa) {
		mapa = new Map();
		let cursor: string | undefined;
		for (let i = 0; i < 20; i++) {
			const page = await env.ctx.content!.list(collection, { limit: 100, cursor });
			for (const it of page.items) if (it.slug) mapa.set(it.slug, it.id);
			if (!page.hasMore || !page.cursor || page.cursor === cursor) break;
			cursor = page.cursor;
		}
		cache.set(collection, mapa);
	}
	return mapa.get(slug) ?? null;
}

export async function importarPreguntas(
	env: Entorno,
	user: Usuario | undefined,
	preguntas: PreguntaImportada[],
): Promise<{ creadas: number; sinColocar: number }> {
	const { ctx } = env;
	const { reglas, comentarios } = collections(ctx);
	const existentes = new Set((await allRows(reglas, {}, 5000)).map((r) => r.data.pregunta.trim()));
	const cacheSlugs = new Map<string, Map<string, string>>();
	const tocadas = new Map<string, { collection: string; entryId: string }>();
	let creadas = 0;
	let sinColocar = 0;

	for (const p of preguntas) {
		const texto = p.pregunta.trim();
		if (!texto || existentes.has(texto)) continue;
		existentes.add(texto);
		const reglaId = nuevoId();
		const regla: ReglaDoc = { pregunta: texto, entradas: [], respuesta: null, creado: nowIso() };
		const nuevos: Array<{ id: string; data: ComentarioDoc }> = [];
		for (const e of p.entradas) {
			camposDe(env.opciones, e.collection);
			const entryId = e.id ?? (e.slug ? await buscarPorSlug(env, e.collection, e.slug, cacheSlugs) : null);
			if (!entryId) {
				sinColocar++;
				continue;
			}
			let ancla: Ancla | null = null;
			let entrada;
			try {
				entrada = await leerParaAnclar(env, e.collection, entryId);
			} catch {
				sinColocar++;
				continue;
			}
			if (e.cita?.trim()) ancla = anclaDeCita(entrada.doc, e.cita.trim(), entrada.draftRevisionId);
			if (!ancla) sinColocar++;
			regla.entradas.push({ collection: e.collection, entryId: entrada.id });
			nuevos.push({
				id: nuevoId(),
				data: {
					collection: e.collection,
					entryId: entrada.id,
					tipo: "pregunta",
					texto,
					textoPropuesto: null,
					ancla,
					huerfano: false,
					estado: "abierto",
					autorId: user?.id ?? "",
					autorNombre: user ? nombreDe(user) : "Importación",
					creado: nowIso(),
					parentId: null,
					vuelta: 0,
					respuestaIA: null,
					reglaId,
					respuesta: null,
				},
			});
			tocadas.set(`${e.collection}:${entrada.id}`, { collection: e.collection, entryId: entrada.id });
		}
		if (regla.entradas.length === 0) continue;
		await reglas.put(reglaId, regla);
		for (const c of nuevos) await comentarios.put(c.id, c.data);
		creadas++;
	}
	for (const t of tocadas.values()) await recalcular(ctx, t.collection, t.entryId);
	return { creadas, sinColocar };
}

export async function preguntaVista(
	env: Entorno,
	reglaId: string,
	regla: ReglaDoc,
	titulos?: Map<string, string>,
): Promise<PreguntaVista> {
	const coms = await allRows(collections(env.ctx).comentarios, { where: { reglaId } }, 1000);
	const entradas: PreguntaVista["entradas"] = [];
	for (const { id, data } of coms) {
		let titulo = titulos?.get(`${data.collection}:${data.entryId}`);
		if (titulo === undefined) {
			try {
				const item: PluginContentItem | null | undefined = await env.ctx.content?.get(data.collection, data.entryId);
				titulo = item ? tituloDe(item, camposDe(env.opciones, data.collection)) : data.entryId;
			} catch {
				titulo = data.entryId;
			}
		}
		entradas.push({ collection: data.collection, id: data.entryId, titulo, cita: data.ancla?.cita ?? null, comentarioId: id });
	}
	return { reglaId, pregunta: regla.pregunta, entradas, respuesta: regla.respuesta };
}

/** Preguntas sin responder (o «lo miro luego»). */
export async function preguntasPendientes(env: Entorno, titulos?: Map<string, string>): Promise<PreguntaVista[]> {
	const rows = await allRows(collections(env.ctx).reglas, { orderBy: { creado: "asc" } }, 2000);
	const out: PreguntaVista[] = [];
	for (const r of rows) {
		if (r.data.respuesta && r.data.respuesta.tipo !== "luego") continue;
		out.push(await preguntaVista(env, r.id, r.data, titulos));
	}
	return out;
}

const TEXTO_DEFECTO: Record<"quitar" | "cambiar", string> = {
	quitar: "Quítalo.",
	cambiar: "Cámbialo.",
};

export async function responderPregunta(
	env: Entorno,
	user: Usuario,
	input: { reglaId: string; tipo: RespuestaPregunta["tipo"]; texto?: string | null },
): Promise<{ pregunta: PreguntaVista }> {
	const { ctx } = env;
	const { reglas, comentarios } = collections(ctx);
	const regla = await reglas.get(input.reglaId);
	if (!regla) throw PluginRouteError.notFound("No se encuentra la pregunta.");
	if (regla.respuesta && regla.respuesta.tipo !== "luego") {
		throw PluginRouteError.conflict("Esta pregunta ya está respondida.");
	}
	const texto = input.texto?.trim() || null;
	if (input.tipo === "cambiar" && !texto) throw PluginRouteError.badRequest("Escribe por qué hay que cambiarlo.");
	const respuesta: RespuestaPregunta = { tipo: input.tipo, texto, userId: user.id, fecha: nowIso() };
	const nueva: ReglaDoc = { ...regla, respuesta };
	await reglas.put(input.reglaId, nueva);

	if (input.tipo !== "luego") {
		const coms = await allRows(comentarios, { where: { reglaId: input.reglaId } }, 1000);
		const tocadas = new Map<string, { collection: string; entryId: string }>();
		for (const { id, data } of coms) {
			if (data.tipo !== "pregunta" || data.estado !== "abierto") continue;
			let nuevo: ComentarioDoc;
			if (input.tipo === "correcto") {
				nuevo = { ...data, estado: "descartado", respuesta, respuestaIA: texto ? `Es correcto. ${texto}` : "Es correcto" };
			} else {
				nuevo = {
					...data,
					tipo: "comentario",
					estado: "abierto",
					texto: texto ?? TEXTO_DEFECTO[input.tipo],
					textoPropuesto: input.tipo === "cambiar" ? texto : null,
					autorId: user.id,
					autorNombre: nombreDe(user),
					respuesta,
				};
			}
			await comentarios.put(id, nuevo);
			tocadas.set(`${data.collection}:${data.entryId}`, { collection: data.collection, entryId: data.entryId });
		}
		for (const t of tocadas.values()) {
			await recalcular(ctx, t.collection, t.entryId, { anularAprobacion: input.tipo !== "correcto" });
		}
	} else {
		const coms = await allRows(comentarios, { where: { reglaId: input.reglaId } }, 1000);
		for (const { id, data } of coms) {
			if (data.tipo === "pregunta" && data.estado === "abierto") await comentarios.put(id, { ...data, respuesta });
		}
	}
	const vista = await preguntaVista(env, input.reglaId, nueva);
	const primera = vista.entradas[0] ?? (nueva.entradas[0] ? { collection: nueva.entradas[0].collection, id: nueva.entradas[0].entryId, titulo: "", cita: null } : null);
	if (input.tipo !== "luego" && primera) {
		const titulos = [...new Set(vista.entradas.map((e) => e.titulo))];
		const n = nueva.entradas.length;
		await registrarSenal(env, autorDe(user), {
			tipo: "respuesta",
			collection: primera.collection,
			entryId: primera.id,
			titulo: titulos.length ? titulos.join(" · ") : null,
			cita: primera.cita,
			texto: nueva.pregunta,
			despues: texto,
			nota: `Respuesta: ${RESPUESTA_LEGIBLE[input.tipo]}${texto ? ` — ${texto}` : ""}. Afecta a ${n} ${n === 1 ? "artículo" : "artículos"}.`,
			ref: input.reglaId,
		});
	}
	return { pregunta: vista };
}

const RESPUESTA_LEGIBLE: Record<RespuestaPregunta["tipo"], string> = {
	correcto: "es correcto",
	quitar: "quitarlo",
	cambiar: "cambiarlo",
	luego: "lo mira luego",
};
