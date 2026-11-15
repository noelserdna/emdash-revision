/**
 * Segunda revisión: veredicto sobre cada cambio («Está bien», «Deshacer»,
 * «No es esto»).
 */

import { PluginRouteError } from "emdash";

import { nombreDe, type Usuario } from "./acceso.js";
import { autorDe, registrarSenal, textoDeCambio } from "./aprendizaje.js";
import { crearAncla } from "./anclas.js";
import { escribirDoc, leerParaAnclar, type Entorno } from "./contenido.js";
import { esBloque, nuevaClave, textoDeBloque } from "./bloques.js";
import { igualesSinClaves } from "./hash.js";
import { deshacerCambio, reescribirSpans } from "./ops.js";
import { auditar, leerRevision, recalcular } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId } from "./store.js";
import type { CambioDoc, CambioVista, ComentarioDoc, DocRevisable, PTBlock, RevisionDoc, Veredicto } from "./types.js";

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

/**
 * La revisora reescribe ella misma el texto de un cambio. Su texto sustituye al
 * de la IA conservando el formato de lo que no toca, el cambio queda dado por
 * bueno y la diferencia se guarda como señal para la guía aprendida.
 */
export async function editarCambio(
	env: Entorno,
	user: Usuario,
	input: { id: string; texto: string },
): Promise<{ cambio: CambioVista; revision: RevisionDoc; doc: DocRevisable }> {
	const { ctx } = env;
	const { cambios } = collections(ctx);
	const cambio = await cambios.get(input.id);
	if (!cambio) throw PluginRouteError.notFound("No se encuentra el cambio.");
	if (cambio.veredicto === "deshecho" || cambio.op === "eliminar") {
		throw PluginRouteError.conflict("Este cambio ya no se puede editar. Deja un comentario en el párrafo.");
	}
	const texto = input.texto.replace(/\s*\n+\s*/g, " ").trim();
	if (!texto) throw PluginRouteError.badRequest("Escribe el texto como quieres que quede.");
	const cambiado = PluginRouteError.conflict("El texto ha cambiado después de esta corrección. Recarga el artículo.");

	const entrada = await leerParaAnclar(env, cambio.collection, cambio.entryId);
	let nuevoDoc: DocRevisable;
	let despues: CambioDoc["despues"];
	const antesTexto = textoDeCambio(cambio.despues);
	if (cambio.campo === "title" || cambio.campo === "excerpt") {
		const prop = cambio.campo === "title" ? "titulo" : "extracto";
		if (entrada.doc[prop] !== cambio.despues) throw cambiado;
		nuevoDoc = { ...entrada.doc, [prop]: texto };
		despues = texto;
	} else {
		const i = entrada.doc.content.findIndex((n) => n._key === cambio.blockKey);
		const actual = entrada.doc.content[i];
		if (i < 0 || !actual || !igualesSinClaves(actual, cambio.despues)) throw cambiado;
		if (!esBloque(actual)) {
			throw PluginRouteError.badRequest("Las tablas y las imágenes no se editan aquí. Usa «No es esto» y cuenta qué falla.");
		}
		const children = reescribirSpans(actual.children ?? [], texto, nuevaClave);
		const usadas = new Set(children.flatMap((s) => s.marks ?? []));
		const bloque: PTBlock = { ...actual, children, markDefs: (actual.markDefs ?? []).filter((d) => usadas.has(d._key)) };
		if (textoDeBloque(bloque) !== texto) throw PluginRouteError.badRequest("No se ha podido guardar ese texto. Prueba de nuevo.");
		const content = [...entrada.doc.content];
		content[i] = bloque;
		nuevoDoc = { ...entrada.doc, content };
		despues = bloque;
	}
	if (antesTexto === texto) {
		const revision = await leerRevision(ctx, cambio.collection, cambio.entryId);
		return { cambio: { ...cambio, id: input.id }, revision, doc: entrada.doc };
	}

	const guardada = await escribirDoc(env, entrada, nuevoDoc, "Antes de editar un cambio");
	// La redacción es suya: los avisos de la corrección de la IA ya no aplican.
	const nuevo: CambioDoc = { ...cambio, despues, avisos: [], veredicto: "bien", nota: "Redacción de la revisora", veredictoPor: user.id };
	await cambios.put(input.id, nuevo);
	const revision = await recalcular(ctx, cambio.collection, cambio.entryId, {
		anularAprobacion: true,
		extra: (r) => {
			r.hash = guardada.hash;
			if (r.aprobacion && r.aprobacion.hash !== guardada.hash) r.aprobacion.cambiadoDespues = true;
		},
	});
	await auditar(ctx, {
		accion: "veredicto",
		userId: user.id,
		collection: cambio.collection,
		entryId: cambio.entryId,
		hash: revision.hash,
		detalle: `${input.id}: editado por la revisora`,
	});
	if (cambio.trabajoId) {
		await registrarSenal(env, autorDe(user), {
			tipo: "edicion",
			collection: cambio.collection,
			entryId: cambio.entryId,
			titulo: guardada.doc.titulo,
			campo: cambio.campo,
			antes: antesTexto,
			despues: texto,
			nota: "No le gustó la corrección de la IA y la reescribió ella",
			ref: input.id,
		});
	}
	return { cambio: { ...nuevo, id: input.id }, revision, doc: guardada.doc };
}

/**
 * La revisora edita ella misma un párrafo, el título o el extracto, sin pasar
 * por un comentario. Queda como un cambio suyo ya dado por bueno.
 */
export async function editarBloque(
	env: Entorno,
	user: Usuario,
	input: { collection: string; id: string; campo: "content" | "title" | "excerpt"; blockKey?: string; texto: string },
): Promise<void> {
	const { ctx } = env;
	const { cambios } = collections(ctx);
	const rev = await leerRevision(ctx, input.collection, input.id);
	// Si ese párrafo ya tiene un cambio en esta vuelta, se edita ese cambio.
	const deVuelta = await cambiosDeVuelta(env, input.collection, input.id, rev.vuelta);
	const previo = deVuelta.find(
		(c) => c.campo === input.campo && (input.campo !== "content" || c.blockKey === input.blockKey) && c.veredicto !== "deshecho" && c.op !== "eliminar",
	);
	if (previo) {
		await editarCambio(env, user, { id: previo.id, texto: input.texto });
		return;
	}
	const texto = input.texto.replace(/\s*\n+\s*/g, " ").trim();
	if (!texto) throw PluginRouteError.badRequest("Escribe el texto como quieres que quede.");
	const entrada = await leerParaAnclar(env, input.collection, input.id);
	let nuevoDoc: DocRevisable;
	let antes: CambioDoc["antes"];
	let despues: CambioDoc["despues"];
	if (input.campo === "title" || input.campo === "excerpt") {
		const prop = input.campo === "title" ? "titulo" : "extracto";
		antes = entrada.doc[prop] ?? "";
		despues = texto;
		nuevoDoc = { ...entrada.doc, [prop]: texto };
	} else {
		const i = entrada.doc.content.findIndex((n) => n._key === input.blockKey);
		const actual = entrada.doc.content[i];
		if (i < 0 || !actual) throw PluginRouteError.conflict("El texto ha cambiado. Recarga el artículo.");
		if (!esBloque(actual)) throw PluginRouteError.badRequest("Las tablas y las imágenes no se editan aquí. Deja un comentario.");
		const children = reescribirSpans(actual.children ?? [], texto, nuevaClave);
		const usadas = new Set(children.flatMap((s) => s.marks ?? []));
		const bloque: PTBlock = { ...actual, children, markDefs: (actual.markDefs ?? []).filter((d) => usadas.has(d._key)) };
		if (textoDeBloque(bloque) !== texto) throw PluginRouteError.badRequest("No se ha podido guardar ese texto. Prueba de nuevo.");
		const content = [...entrada.doc.content];
		content[i] = bloque;
		antes = actual;
		despues = bloque;
		nuevoDoc = { ...entrada.doc, content };
	}
	const antesTexto = textoDeCambio(antes);
	if (antesTexto === texto) return;
	const guardada = await escribirDoc(env, entrada, nuevoDoc, "Antes de una edición de la revisora");
	const doc: CambioDoc = {
		collection: input.collection,
		entryId: entrada.id,
		vuelta: rev.vuelta,
		trabajoId: null,
		orden: Date.now(),
		op: input.campo === "content" ? "reemplazar" : "campo",
		campo: input.campo,
		blockKey: input.campo === "content" ? (input.blockKey ?? null) : null,
		trasKey: null,
		antes,
		despues,
		comentarioIds: [],
		avisos: [],
		veredicto: "bien",
		nota: "Redacción de la revisora",
		veredictoPor: user.id,
		creado: nowIso(),
	};
	await cambios.put(nuevoId(), doc);
	await recalcular(ctx, input.collection, entrada.id, {
		anularAprobacion: true,
		extra: (r) => {
			r.hash = guardada.hash;
			if (r.aprobacion && r.aprobacion.hash !== guardada.hash) r.aprobacion.cambiadoDespues = true;
		},
	});
	await auditar(ctx, {
		accion: "veredicto",
		userId: user.id,
		collection: input.collection,
		entryId: entrada.id,
		hash: guardada.hash,
		detalle: `edición directa de ${input.campo}${input.blockKey ? ` ${input.blockKey}` : ""}`,
	});
	await registrarSenal(env, autorDe(user), {
		tipo: "edicion",
		collection: input.collection,
		entryId: entrada.id,
		titulo: guardada.doc.titulo,
		campo: input.campo,
		antes: antesTexto,
		despues: texto,
		nota: "Lo reescribió ella en el panel de revisión",
	});
}
