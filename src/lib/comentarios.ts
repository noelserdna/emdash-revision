/**
 * Comentarios anclados: crear, editar, cambiar de estado, borrar y «Cambiarlo ya».
 */

import { PluginRouteError } from "emdash";

import { esAdmin, nombreDe, type Usuario } from "./acceso.js";
import { leerAjustes, terminosSensibles } from "./ajustes.js";
import { anclaDeFragmento, resolverAncla } from "./anclas.js";
import { escribirDoc, leerParaAnclar, type Entorno } from "./contenido.js";
import { sustituirFragmento } from "./ops.js";
import { auditar, comentariosDe, leerRevision, recalcular } from "./revisiones.js";
import { collections, nowIso, nuevoId } from "./store.js";
import type { Ancla, CambioDoc, ComentarioDoc, ComentarioVista, RevisionDoc } from "./types.js";

export function comentarioVista(id: string, c: ComentarioDoc, user: Usuario | undefined): ComentarioVista {
	const editable = !!user && c.estado === "abierto" && (c.autorId === user.id || esAdmin(user));
	return { ...c, id, editable };
}

async function leerComentario(env: Entorno, id: string): Promise<ComentarioDoc> {
	const c = await collections(env.ctx).comentarios.get(id);
	if (!c) throw PluginRouteError.notFound("No se encuentra el comentario.");
	return c;
}

function exigirAutor(c: ComentarioDoc, user: Usuario): void {
	if (c.autorId !== user.id && !esAdmin(user)) {
		throw PluginRouteError.forbidden("Solo quien escribió el comentario o un administrador puede cambiarlo.");
	}
}

export interface EntradaCrear {
	collection: string;
	id: string;
	texto: string;
	textoPropuesto?: string | null;
	ancla: Ancla | null;
	fragmento?: string | null;
	parentId?: string | null;
}

export async function crearComentario(
	env: Entorno,
	user: Usuario,
	input: EntradaCrear,
): Promise<{ comentario: ComentarioVista; revision: RevisionDoc }> {
	const { ctx } = env;
	const texto = input.texto.trim();
	if (!texto) throw PluginRouteError.badRequest("Escribe qué hay que cambiar.");

	let ancla: Ancla | null = null;
	let parentId: string | null = null;
	if (input.parentId) {
		const padre = await leerComentario(env, input.parentId);
		if (padre.collection !== input.collection || padre.entryId !== input.id) {
			throw PluginRouteError.badRequest("La respuesta no corresponde a este artículo.");
		}
		parentId = input.parentId;
	} else if (input.ancla) {
		const entrada = await leerParaAnclar(env, input.collection, input.id);
		const base = entrada.draftRevisionId;
		const fragmento = input.fragmento?.trim();
		if (fragmento) {
			const unidad = { campo: input.ancla.campo, blockKey: input.ancla.blockKey, ruta: input.ancla.ruta };
			ancla = anclaDeFragmento(entrada.doc, unidad, fragmento, base);
			if (!ancla) {
				throw PluginRouteError.badRequest(
					"No encuentro ese fragmento en el párrafo, o aparece más de una vez. Cópialo tal cual o deja el campo vacío.",
				);
			}
		} else {
			const r = resolverAncla(entrada.doc, input.ancla);
			if (r.estado === "huerfana") {
				throw PluginRouteError.conflict("El texto ha cambiado y no encuentro dónde va el comentario. Recarga el artículo.");
			}
			ancla = { ...r.ancla, baseRevisionId: base };
		}
	}

	const rev = await leerRevision(ctx, input.collection, input.id);
	const doc: ComentarioDoc = {
		collection: input.collection,
		entryId: input.id,
		tipo: "comentario",
		texto,
		textoPropuesto: input.textoPropuesto?.trim() || null,
		ancla,
		huerfano: false,
		estado: "abierto",
		autorId: user.id,
		autorNombre: nombreDe(user),
		creado: nowIso(),
		parentId,
		vuelta: rev.vuelta,
		respuestaIA: null,
		reglaId: null,
		respuesta: null,
	};
	const id = nuevoId();
	await collections(ctx).comentarios.put(id, doc);
	const revision = await recalcular(ctx, input.collection, input.id, { anularAprobacion: !parentId });
	await auditar(ctx, {
		accion: "comentar",
		userId: user.id,
		collection: input.collection,
		entryId: input.id,
		hash: revision.hash,
		detalle: parentId ? `respuesta a ${parentId}` : id,
	});
	return { comentario: comentarioVista(id, doc, user), revision };
}

export async function editarComentario(
	env: Entorno,
	user: Usuario,
	input: { id: string; texto: string; textoPropuesto?: string | null },
): Promise<{ comentario: ComentarioVista }> {
	const c = await leerComentario(env, input.id);
	exigirAutor(c, user);
	if (c.estado !== "abierto") throw PluginRouteError.conflict("Este comentario ya está resuelto.");
	const texto = input.texto.trim();
	if (!texto) throw PluginRouteError.badRequest("El comentario no puede quedar vacío.");
	const nuevo: ComentarioDoc = {
		...c,
		texto,
		textoPropuesto: input.textoPropuesto === undefined ? c.textoPropuesto : input.textoPropuesto?.trim() || null,
	};
	await collections(env.ctx).comentarios.put(input.id, nuevo);
	return { comentario: comentarioVista(input.id, nuevo, user) };
}

export async function cambiarEstadoComentario(
	env: Entorno,
	user: Usuario,
	input: { id: string; estado: "abierto" | "descartado" },
): Promise<{ comentario: ComentarioVista; revision: RevisionDoc }> {
	const c = await leerComentario(env, input.id);
	const nuevo: ComentarioDoc = { ...c, estado: input.estado };
	await collections(env.ctx).comentarios.put(input.id, nuevo);
	const revision = await recalcular(env.ctx, c.collection, c.entryId, {
		anularAprobacion: input.estado === "abierto",
	});
	return { comentario: comentarioVista(input.id, nuevo, user), revision };
}

export async function borrarComentario(env: Entorno, user: Usuario, id: string): Promise<{ ok: true; revision: RevisionDoc }> {
	const c = await leerComentario(env, id);
	exigirAutor(c, user);
	if (c.estado !== "abierto") throw PluginRouteError.conflict("Un comentario resuelto no se puede borrar.");
	const { comentarios } = collections(env.ctx);
	const hijos = (await comentariosDe(env.ctx, c.collection, c.entryId)).filter((h) => h.data.parentId === id);
	await comentarios.deleteMany([id, ...hijos.map((h) => h.id)]);
	const revision = await recalcular(env.ctx, c.collection, c.entryId);
	return { ok: true, revision };
}

/**
 * «Cambiarlo ya»: sustituye el fragmento del ancla por el texto propuesto, sin
 * IA. Crea un cambio ya aceptado (se puede deshacer) y no cambia de vuelta.
 */
export async function aplicarComentario(env: Entorno, user: Usuario, id: string): Promise<{ collection: string; entryId: string }> {
	const { ctx } = env;
	const c = await leerComentario(env, id);
	if (c.estado !== "abierto") throw PluginRouteError.conflict("Este comentario ya está resuelto.");
	if (!c.textoPropuesto || !c.ancla) {
		throw PluginRouteError.badRequest("Para cambiarlo ya, el comentario necesita un fragmento y el texto que propones.");
	}
	const entrada = await leerParaAnclar(env, c.collection, c.entryId);
	const ajustes = await leerAjustes(ctx);
	const res = sustituirFragmento(entrada.doc, c.ancla, c.textoPropuesto, { terminosSensibles: terminosSensibles(ajustes) });
	if (!res || res.cambios.length === 0) {
		throw PluginRouteError.conflict("No encuentro el texto que quieres cambiar. Puede que haya cambiado: revisa el comentario.");
	}
	const guardada = await escribirDoc(env, entrada, res.doc, "Antes de «Cambiarlo ya»");
	const rev = await leerRevision(ctx, c.collection, c.entryId);
	const { cambios, comentarios } = collections(ctx);
	const creado = nowIso();
	let orden = Date.now();
	for (const cambio of res.cambios) {
		const doc: CambioDoc = {
			...cambio,
			collection: c.collection,
			entryId: c.entryId,
			vuelta: rev.vuelta,
			trabajoId: null,
			orden: orden++,
			comentarioIds: cambio.comentarioIds.length ? cambio.comentarioIds : [id],
			veredicto: "bien",
			veredictoPor: user.id,
			creado,
		};
		await cambios.put(nuevoId(), doc);
	}
	await comentarios.put(id, { ...c, estado: "aplicado", respuestaIA: `Cambiado por ${nombreDe(user)}.` });
	await recalcular(ctx, c.collection, c.entryId, {
		extra: (r) => {
			r.hash = guardada.hash;
			if (r.aprobacion && r.aprobacion.hash !== guardada.hash) r.aprobacion.cambiadoDespues = true;
		},
	});
	await auditar(ctx, {
		accion: "cambiar_ya",
		userId: user.id,
		collection: c.collection,
		entryId: c.entryId,
		revisionId: guardada.draftRevisionId,
		hash: guardada.hash,
		detalle: id,
	});
	return { collection: c.collection, entryId: c.entryId };
}
