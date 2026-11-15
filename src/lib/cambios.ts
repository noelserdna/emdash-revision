/**
 * Segunda revisión: veredicto sobre cada cambio («Está bien», «Deshacer»,
 * «No es esto»).
 */

import { PluginRouteError } from "emdash";

import { nombreDe, type Usuario } from "./acceso.js";
import { autorDe, registrarSenal, textoDeCambio } from "./aprendizaje.js";
import { crearAncla } from "./anclas.js";
import { escribirDoc, leerParaAnclar, type Entorno } from "./contenido.js";
import { deshacerCambio } from "./ops.js";
import { auditar, leerRevision, recalcular } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId } from "./store.js";
import type { CambioDoc, CambioVista, ComentarioDoc, DocRevisable, RevisionDoc, Veredicto } from "./types.js";

export async function cambiosDeVuelta(
	env: Entorno,
	collection: string,
	entryId: string,
	vuelta: number,
): Promise<CambioVista[]> {
	const rows = await allRows(collections(env.ctx).cambios, { where: { entryId, vuelta }, orderBy: { orden: "asc" } }, 2000);
	return rows.filter((r) => r.data.collection === collection).map((r) => ({ ...r.data, id: r.id }));
}

async function reabrir(env: Entorno, user: Usuario, cambio: CambioDoc, nota: string | null): Promise<void> {
	const { comentarios } = collections(env.ctx);
	const rev = await leerRevision(env.ctx, cambio.collection, cambio.entryId);
	for (const id of cambio.comentarioIds) {
		const c = await comentarios.get(id);
		if (!c) continue;
		await comentarios.put(id, { ...c, estado: "abierto" });
		if (nota) {
			const hija: ComentarioDoc = {
				collection: c.collection,
				entryId: c.entryId,
				tipo: "comentario",
				texto: nota,
				textoPropuesto: null,
				ancla: null,
				estado: "abierto",
				autorId: user.id,
				autorNombre: nombreDe(user),
				creado: nowIso(),
				parentId: id,
				vuelta: rev.vuelta,
				respuestaIA: null,
				reglaId: null,
				respuesta: null,
			};
			await comentarios.put(nuevoId(), hija);
		}
	}
}

/** «No es esto» sobre un cambio que nadie pidió: abre un comentario nuevo sobre ese bloque. */
async function comentarioSobreCambio(env: Entorno, user: Usuario, cambio: CambioDoc, nota: string): Promise<void> {
	const entrada = await leerParaAnclar(env, cambio.collection, cambio.entryId);
	const ancla =
		cambio.campo === "content" && cambio.blockKey
			? crearAncla(entrada.doc, { campo: "content", blockKey: cambio.blockKey }, entrada.draftRevisionId)
			: cambio.campo === "title" || cambio.campo === "excerpt"
				? crearAncla(entrada.doc, { campo: cambio.campo }, entrada.draftRevisionId)
				: null;
	const rev = await leerRevision(env.ctx, cambio.collection, cambio.entryId);
	await collections(env.ctx).comentarios.put(nuevoId(), {
		collection: cambio.collection,
		entryId: cambio.entryId,
		tipo: "comentario",
		texto: nota,
		textoPropuesto: null,
		ancla,
		huerfano: false,
		estado: "abierto",
		autorId: user.id,
		autorNombre: nombreDe(user),
		creado: nowIso(),
		parentId: null,
		vuelta: rev.vuelta,
		respuestaIA: null,
		reglaId: null,
		respuesta: null,
	});
}

export async function darVeredicto(
	env: Entorno,
	user: Usuario,
	input: { id: string; veredicto: Veredicto; nota?: string | null; confirmado?: boolean },
): Promise<{ cambio: CambioVista; revision: RevisionDoc; doc?: DocRevisable }> {
	const { ctx } = env;
	const { cambios } = collections(ctx);
	const cambio = await cambios.get(input.id);
	if (!cambio) throw PluginRouteError.notFound("No se encuentra el cambio.");
	if (cambio.veredicto === input.veredicto) {
		const revision = await leerRevision(ctx, cambio.collection, cambio.entryId);
		return { cambio: { ...cambio, id: input.id }, revision };
	}
	if (cambio.veredicto === "deshecho") {
		throw PluginRouteError.conflict("Este cambio ya se deshizo. Si hace falta, deja un comentario nuevo.");
	}
	const nota = input.nota?.trim() || null;
	let doc: DocRevisable | undefined;
	let hashNuevo: string | null = null;
	let titulo: string | null = null;

	switch (input.veredicto) {
		case "pendiente":
			break;
		case "bien":
			if (cambio.avisos.length > 0 && !input.confirmado) {
				throw PluginRouteError.badRequest("Este cambio tiene avisos: compruébalo y confírmalo antes de darlo por bueno.");
			}
			break;
		case "no_es_esto":
			if (!nota) throw PluginRouteError.badRequest("Cuéntanos qué no está bien para poder corregirlo.");
			if (cambio.comentarioIds.length) await reabrir(env, user, cambio, nota);
			else await comentarioSobreCambio(env, user, cambio, nota);
			break;
		case "deshecho": {
			const entrada = await leerParaAnclar(env, cambio.collection, cambio.entryId);
			const deshecho = deshacerCambio(entrada.doc, cambio);
			if (!deshecho) {
				throw PluginRouteError.conflict("Ya no se puede deshacer: el texto ha cambiado después. Deja un comentario.");
			}
			const guardada = await escribirDoc(env, entrada, deshecho, "Antes de deshacer un cambio");
			titulo = guardada.doc.titulo;
			doc = guardada.doc;
			hashNuevo = guardada.hash;
			await reabrir(env, user, cambio, nota);
			break;
		}
	}

	const nuevo: CambioDoc = { ...cambio, veredicto: input.veredicto, nota, veredictoPor: user.id };
	await cambios.put(input.id, nuevo);
	const revision = await recalcular(ctx, cambio.collection, cambio.entryId, {
		anularAprobacion: input.veredicto !== "bien" && input.veredicto !== "pendiente",
		extra: (r) => {
			if (hashNuevo) {
				r.hash = hashNuevo;
				if (r.aprobacion && r.aprobacion.hash !== hashNuevo) r.aprobacion.cambiadoDespues = true;
			}
		},
	});
	await auditar(ctx, {
		accion: "veredicto",
		userId: user.id,
		collection: cambio.collection,
		entryId: cambio.entryId,
		hash: revision.hash,
		detalle: `${input.id}: ${input.veredicto}${nota ? ` — ${nota}` : ""}`,
	});
	// Lo que la revisora rechaza o deshace de la IA enseña criterio.
	if (cambio.trabajoId && (input.veredicto === "no_es_esto" || input.veredicto === "deshecho")) {
		await registrarSenal(env, autorDe(user), {
			tipo: input.veredicto === "no_es_esto" ? "no_es_esto" : "deshacer",
			collection: cambio.collection,
			entryId: cambio.entryId,
			titulo,
			campo: cambio.campo,
			antes: textoDeCambio(cambio.antes),
			despues: textoDeCambio(cambio.despues),
			nota,
			ref: input.id,
		});
	}
	const out: { cambio: CambioVista; revision: RevisionDoc; doc?: DocRevisable } = { cambio: { ...nuevo, id: input.id }, revision };
	if (doc) out.doc = doc;
	return out;
}
