/**
 * Ediciones hechas fuera del plugin, en el editor de artículos de EmDash.
 *
 * - Cada guardado deja constancia: copia en el historial al empezar una sesión
 *   de edición, un cambio por bloque (antes → después) ya dado por bueno y una
 *   sola señal de aprendizaje por sesión (no una por guardado).
 * - Lo que la edición toca cierra lo pendiente en esos bloques: cambios de la
 *   IA sin veredicto y comentarios abiertos.
 * - Publicar desde el editor siendo revisora es aprobar: se cierra lo que
 *   quede pendiente, se fija la fecha de revisión y se vuelve a publicar para
 *   que esa fecha salga en la web.
 * - `importarHistorico` aplica lo mismo a sesiones pasadas (lo usa un script).
 */

import type { ContentPolicyEvent } from "emdash";

import { buscarUsuario } from "./acceso.js";
import { leerAjustes } from "./ajustes.js";
import { borrarSenalPendiente, esRevisora, programarPronto, registrarSenal, resumenEdicion, type Autor } from "./aprendizaje.js";
import { camposDe, coleccionConfigurada, docDeDatos, escribirCampos, leerEntrada, type Entorno, type Entrada } from "./contenido.js";
import { hashDoc } from "./hash.js";
import { copiaDeEdicionExterna, esEdicionExterna, MOTIVO_EDITOR } from "./historial.js";
import { auditar, leerRevision, recalcular, sincronizar } from "./revisiones.js";
import { allRows, collections, nowIso, nuevoId, revisionId } from "./store.js";
import type { BloqueComparado, CambioDoc, CampoAncla, DocRevisable, PTNode } from "./types.js";
import { compararDocs, guardarVersion } from "./versiones.js";

/** Guardados de la misma persona separados por menos de esto son una sola sesión. */
export const SESION_MS = 2 * 60 * 60 * 1000;

const kSesion = (collection: string, id: string) => `editor:sesion:${collection}:${id}`;
const kPublicando = (collection: string, id: string) => `editor:publicando:${collection}:${id}`;
const kImportado = (collection: string, id: string) => `editor:importado:${collection}:${id}`;

export const notaEditor = (nombre: string) => `Editado por ${nombre} en el editor de artículos`;

interface SesionEditor {
	actorId: string;
	nombre: string;
	inicioDoc: DocRevisable;
	inicio: string;
	ultima: string;
	ref: string;
}

interface Publicando {
	actorId: string | null;
	role: number | null;
	plugin: boolean;
	fecha: string;
}

async function autorDeId(env: Entorno, id: string | null | undefined, role?: number | null): Promise<Autor | null> {
	if (!id) return null;
	const u = await buscarUsuario(env.ctx, id);
	if (!u) return null;
	return { id: u.id, role: u.role ?? role ?? 0, nombre: u.nombre };
}

// ─── Guardar ───────────────────────────────────────────────────────

/** `content:afterSave` de una colección en revisión. */
export async function alGuardar(
	env: Entorno,
	event: { collection: string; content: Record<string, unknown>; actor?: { id: string; role: number } },
): Promise<void> {
	if (!coleccionConfigurada(env.opciones, event.collection)) return;
	const id = typeof event.content.id === "string" ? event.content.id : null;
	if (!id) return;
	const { ctx } = env;
	const rev = await collections(ctx).revisiones.get(revisionId(event.collection, id));
	const e = await leerEntrada(env, event.collection, id);
	const hashVisto = rev?.hash ?? null;
	if (esEdicionExterna(env, event.collection, e.id, hashVisto, e.hash)) {
		await registrarEdicion(env, event.actor ?? null, e, hashVisto);
	}
	await sincronizar(env, event.collection, e.id, e.doc, e.hash);
}

async function registrarEdicion(env: Entorno, actor: { id: string; role: number } | null, e: Entrada, hashVisto: string | null): Promise<void> {
	const { ctx } = env;
	const autor = await autorDeId(env, actor?.id, actor?.role);
	const ahora = new Date();
	const clave = kSesion(e.collection, e.id);
	let ses = autor ? await ctx.kv.get<SesionEditor>(clave) : null;
	const vigente = !!ses && !!autor && ses.actorId === autor.id && ahora.getTime() - Date.parse(ses.ultima) < SESION_MS;
	if (!vigente) {
		const anterior = await copiaDeEdicionExterna(env, e, hashVisto, autor?.id ?? null);
		if (!anterior) {
			// No hay texto anterior con el que comparar: solo se fija el último visto.
			await recalcular(ctx, e.collection, e.id, { extra: (r) => void (r.hash = e.hash) });
			return;
		}
		ses = {
			actorId: autor?.id ?? "",
			nombre: autor?.nombre ?? "Alguien",
			inicioDoc: anterior,
			inicio: ahora.toISOString(),
			ultima: ahora.toISOString(),
			ref: `sesion:${nuevoId()}`,
		};
	}
	const s = ses!;
	s.ultima = ahora.toISOString();
	if (autor) await ctx.kv.set(clave, s);
	await anotarEdicion(env, {
		autor,
		nombre: autor?.nombre ?? s.nombre,
		collection: e.collection,
		entryId: e.id,
		antes: s.inicioDoc,
		despues: e.doc,
		hashDespues: e.hash,
		ref: s.ref,
		fecha: ahora.toISOString(),
		fijarHash: true,
	});
}

// ─── Constancia y cierre de pendientes ─────────────────────────────

const claveCambio = (campo: CampoAncla, blockKey: string | null) => `${campo}:${blockKey ?? ""}`;

function lado(doc: DocRevisable, b: BloqueComparado): PTNode | string | null {
	if (b.campo === "title") return doc.titulo ?? "";
	if (b.campo === "excerpt") return doc.extracto ?? "";
	return doc.content.find((n) => n._key === b.blockKey) ?? null;
}

function opDe(b: BloqueComparado): CambioDoc["op"] {
	if (b.campo !== "content") return "campo";
	if (b.estado === "añadido") return "insertar";
	if (b.estado === "eliminado") return "eliminar";
	return "reemplazar";
}

/**
 * Registra una edición (de `antes` a `despues`) hecha en el editor: cambios
 * dados por buenos, cierre de lo pendiente en lo tocado, señal de aprendizaje
 * y estado. Con el mismo `ref`, actualiza lo de la sesión en vez de duplicarlo.
 */
export async function anotarEdicion(
	env: Entorno,
	p: {
		autor: Autor | null;
		nombre: string;
		collection: string;
		entryId: string;
		antes: DocRevisable;
		despues: DocRevisable;
		hashDespues: string;
		ref: string;
		fecha: string;
		/** Fija el último texto visto (no en importaciones de sesiones pasadas). */
		fijarHash: boolean;
	},
): Promise<{ cambios: number; cerrados: number }> {
	const { ctx } = env;
	const { cambios, comentarios } = collections(ctx);
	const rev = await leerRevision(ctx, p.collection, p.entryId);
	const comparacion = compararDocs(p.antes, p.despues).filter((b) => !b.soloFormato);

	// 1. Constancia: un cambio por bloque, ya dado por bueno.
	const todos = await allRows(cambios, { where: { entryId: p.entryId } }, 5000);
	const delEntry = todos.filter((r) => r.data.collection === p.collection);
	const deSesion = new Map(delEntry.filter((r) => r.data.sesion === p.ref).map((r) => [claveCambio(r.data.campo, r.data.blockKey), r]));
	const orden = Date.parse(p.fecha) || Date.now();
	const vistas = new Set<string>();
	for (const b of comparacion) {
		const k = claveCambio(b.campo, b.blockKey);
		vistas.add(k);
		const previo = deSesion.get(k);
		const doc: CambioDoc = {
			collection: p.collection,
			entryId: p.entryId,
			vuelta: previo?.data.vuelta ?? rev.vuelta,
			trabajoId: null,
			orden: previo?.data.orden ?? orden,
			op: opDe(b),
			campo: b.campo,
			blockKey: b.campo === "content" ? b.blockKey : null,
			trasKey: null,
			antes: b.estado === "añadido" ? null : lado(p.antes, b),
			despues: b.estado === "eliminado" ? null : lado(p.despues, b),
			comentarioIds: [],
			avisos: [],
			veredicto: "bien",
			nota: notaEditor(p.nombre),
			veredictoPor: p.autor?.id ?? null,
			creado: previo?.data.creado ?? p.fecha,
			origen: "editor",
			sesion: p.ref,
		};
		await cambios.put(previo?.id ?? nuevoId(), doc);
	}
	// Si en la misma sesión volvió a dejar un bloque como estaba, ya no hay cambio.
	const sobran = [...deSesion.entries()].filter(([k]) => !vistas.has(k)).map(([, r]) => r.id);
	if (sobran.length) await cambios.deleteMany(sobran);

	// 2. Lo que toca la edición cierra lo pendiente en esos bloques.
	const bloques = new Set(comparacion.filter((b) => b.campo === "content" && b.blockKey).map((b) => b.blockKey!));
	const campos = new Set(comparacion.filter((b) => b.campo !== "content").map((b) => b.campo));
	const toca = (campo: CampoAncla | undefined, blockKey: string | null | undefined) =>
		campo === "content" ? !!blockKey && bloques.has(blockKey) : !!campo && campos.has(campo);
	let cerrados = 0;
	for (const r of delEntry) {
		const c = r.data;
		if (c.veredicto !== "pendiente" || c.origen === "editor" || c.creado > p.fecha) continue;
		if (!toca(c.campo, c.blockKey)) continue;
		await cambios.put(r.id, {
			...c,
			veredicto: "bien",
			nota: `Sustituido por la edición de ${p.nombre} en el editor de artículos`,
			veredictoPor: p.autor?.id ?? null,
			cerradoPor: "editor",
		});
		cerrados++;
	}
	const coms = (await allRows(comentarios, { where: { entryId: p.entryId } }, 5000)).filter((r) => r.data.collection === p.collection);
	for (const r of coms) {
		const c = r.data;
		if (c.estado !== "abierto" || c.parentId || c.tipo !== "comentario" || !c.ancla || c.creado > p.fecha) continue;
		if (!toca(c.ancla.campo, c.ancla.blockKey)) continue;
		await comentarios.put(r.id, { ...c, estado: "aplicado", respuestaIA: `Resuelto por ${p.nombre} al editar el artículo en el editor.` });
		cerrados++;
	}

	// 3. Aprendizaje: una señal por sesión, con el antes y el después completos.
	const resumen = resumenEdicion(p.antes, p.despues);
	if (resumen && p.autor) {
		await registrarSenal(env, p.autor, {
			tipo: "edicion",
			collection: p.collection,
			entryId: p.entryId,
			titulo: p.despues.titulo,
			campo: resumen.campo,
			antes: resumen.antes,
			despues: resumen.despues,
			nota: "Edición directa en el editor de artículos",
			ref: p.ref,
			fecha: p.fecha,
		});
	} else if (!resumen) {
		await borrarSenalPendiente(env, p.ref);
	}

	// 4. Estado.
	await recalcular(ctx, p.collection, p.entryId, {
		extra: (r) => {
			if (!p.fijarHash) return;
			r.hash = p.hashDespues;
			if (r.aprobacion && r.aprobacion.hash !== p.hashDespues) r.aprobacion.cambiadoDespues = true;
		},
	});
	if (comparacion.length || cerrados) {
		await auditar(ctx, {
			accion: "editar_fuera",
			userId: p.autor?.id ?? null,
			collection: p.collection,
			entryId: p.entryId,
			hash: p.hashDespues,
			detalle: `${comparacion.length} bloque(s) cambiados, ${cerrados} pendiente(s) cerrados`,
		});
	}
	return { cambios: comparacion.length, cerrados };
}

// ─── Publicar desde el editor = aprobar ────────────────────────────

/** `content:beforePublish`: apunta quién publica (el evento posterior no lo trae). Rápido y sin fallar. */
export async function anotarQuienPublica(env: Entorno, event: ContentPolicyEvent): Promise<void> {
	try {
		if (!coleccionConfigurada(env.opciones, event.collection)) return;
		const id = typeof event.content.id === "string" ? event.content.id : null;
		if (!id) return;
		const p: Publicando = {
			actorId: event.actor?.id ?? null,
			role: event.actor?.role ?? null,
			plugin: event.origin?.source === "plugin",
			fecha: nowIso(),
		};
		await env.ctx.kv.set(kPublicando(event.collection, id), p);
	} catch (error) {
		env.ctx.log.warn("[editor] no se pudo anotar quién publica", { error: String(error) });
	}
}

/** `content:afterPublish`: si publicó una revisora desde el editor, cuenta como aprobación. */
export async function alPublicar(env: Entorno, event: { collection: string; content: Record<string, unknown> }): Promise<void> {
	if (!coleccionConfigurada(env.opciones, event.collection)) return;
	const id = typeof event.content.id === "string" ? event.content.id : null;
	if (!id) return;
	const { ctx } = env;
	const clave = kPublicando(event.collection, id);
	const p = await ctx.kv.get<Publicando>(clave);
	await ctx.kv.delete(clave);
	if (!p || p.plugin || !p.actorId || Date.now() - Date.parse(p.fecha) > 10 * 60 * 1000) return;
	const autor = await autorDeId(env, p.actorId, p.role);
	if (!esRevisora(autor, await leerAjustes(ctx))) return;
	await darPorBueno(env, autor!, event.collection, id, { fecha: nowIso(), motivo: "al publicar desde el editor de artículos" });
}

/**
 * Aprobación en nombre de `autor` del texto publicado: cierra lo pendiente,
 * fija la fecha de revisión y vuelve a publicar para que salga en la web.
 * No hace nada si hay cambios sin publicar (lo aprobado tiene que ser lo publicado).
 */
export async function darPorBueno(
	env: Entorno,
	autor: Autor,
	collection: string,
	id: string,
	opts: { fecha: string; motivo: string },
): Promise<{ aprobado: boolean; motivo?: string }> {
	const { ctx } = env;
	const content = ctx.content;
	if (!content) return { aprobado: false, motivo: "sin acceso al contenido" };
	const e = await leerEntrada(env, collection, id);
	const vivo = await content.get(collection, e.id);
	if (!vivo || vivo.status !== "published") return { aprobado: false, motivo: "no está publicado" };
	if ((await hashDoc(docDeDatos(vivo.data, camposDe(env.opciones, collection)))) !== e.hash) {
		return { aprobado: false, motivo: "hay cambios sin publicar" };
	}

	const { cambios, comentarios } = collections(ctx);
	for (const r of (await allRows(cambios, { where: { entryId: e.id } }, 5000)).filter((x) => x.data.collection === collection)) {
		if (r.data.veredicto !== "pendiente") continue;
		await cambios.put(r.id, {
			...r.data,
			veredicto: "bien",
			nota: `Dado por bueno por ${autor.nombre} al publicar`,
			veredictoPor: autor.id,
			cerradoPor: "publicar",
		});
	}
	for (const r of (await allRows(comentarios, { where: { entryId: e.id } }, 5000)).filter((x) => x.data.collection === collection)) {
		const c = r.data;
		if (c.estado !== "abierto" || c.parentId || c.tipo !== "comentario") continue;
		await comentarios.put(r.id, { ...c, estado: "aplicado", respuestaIA: `Cerrado por ${autor.nombre} al publicar el artículo.` });
	}

	let draftRevisionId = e.draftRevisionId;
	if (e.campos.campoRevisado) {
		await escribirCampos(env, collection, e.id, { [e.campos.campoRevisado]: opts.fecha }, e.hash);
		draftRevisionId = (await leerEntrada(env, collection, e.id)).draftRevisionId;
	}
	await recalcular(ctx, collection, e.id, {
		extra: (r) => {
			r.estado = "aprobado";
			r.aprobacion = { draftRevisionId, hash: e.hash, userId: autor.id, nombre: autor.nombre, fecha: opts.fecha, cambiadoDespues: false };
			r.hash = e.hash;
		},
	});
	// La fecha de revisión es un campo más: hay que publicarla para que la web la muestre.
	if (e.campos.campoRevisado && content.getVersioned && content.publish) {
		try {
			const v = await content.getVersioned(collection, e.id);
			if (v?.item.draftRevisionId) await content.publish(collection, e.id, { _rev: v._rev });
		} catch (error) {
			ctx.log.warn("[editor] no se pudo publicar la fecha de revisión", { error: String(error) });
		}
	}
	await auditar(ctx, {
		accion: "aprobar",
		userId: autor.id,
		collection,
		entryId: e.id,
		revisionId: draftRevisionId,
		hash: e.hash,
		detalle: opts.motivo,
	});
	await programarPronto(ctx);
	return { aprobado: true };
}

// ─── Importar sesiones pasadas ─────────────────────────────────────

export interface SesionPasada {
	/** Revisión de EmDash anterior a la sesión (el texto de partida). */
	antesRevisionId: string;
	/** Última revisión de la sesión (el texto final). */
	despuesRevisionId: string;
	autorId: string;
	/** Fecha de la última revisión de la sesión. */
	fecha: string;
}

/**
 * Lleva al plugin ediciones ya hechas en el editor (copia en el historial,
 * constancia, cierre de pendientes y aprendizaje) y, con `aprobar`, da por
 * bueno lo publicado. Idempotente por sesión.
 */
export async function importarHistorico(
	env: Entorno,
	input: { collection: string; id: string; sesiones: SesionPasada[]; aprobar?: { autorId: string; fecha: string } | null },
): Promise<{ sesiones: Array<{ despuesRevisionId: string; resultado: string }>; aprobacion: string | null }> {
	const { ctx } = env;
	const content = ctx.content;
	if (!content?.getRevision) throw new Error("El host no permite leer revisiones (content:revisions:read).");
	const e = await leerEntrada(env, input.collection, input.id);
	const hechas = new Set((await ctx.kv.get<string[]>(kImportado(input.collection, e.id))) ?? []);
	const salida: Array<{ despuesRevisionId: string; resultado: string }> = [];
	const ordenadas = [...input.sesiones].sort((a, b) => a.fecha.localeCompare(b.fecha));
	for (const s of ordenadas) {
		if (hechas.has(s.despuesRevisionId)) {
			salida.push({ despuesRevisionId: s.despuesRevisionId, resultado: "ya importada" });
			continue;
		}
		const [a, d] = await Promise.all([
			content.getRevision(input.collection, e.id, s.antesRevisionId),
			content.getRevision(input.collection, e.id, s.despuesRevisionId),
		]);
		if (!a || !d) {
			salida.push({ despuesRevisionId: s.despuesRevisionId, resultado: "revisión no encontrada" });
			continue;
		}
		const antes = docDeDatos(a.data, e.campos);
		const despues = docDeDatos(d.data, e.campos);
		const hashAntes = await hashDoc(antes);
		const hashDespues = await hashDoc(despues);
		const autor = await autorDeId(env, s.autorId);
		const nombre = autor?.nombre ?? "Alguien";
		if (hashAntes !== hashDespues) {
			await guardarVersion(ctx, {
				collection: input.collection,
				entryId: e.id,
				tipo: "cambio",
				motivo: MOTIVO_EDITOR,
				doc: antes,
				hash: hashAntes,
				userId: autor?.id ?? s.autorId,
				nombre,
				fecha: s.fecha,
			});
		}
		const r = await anotarEdicion(env, {
			autor,
			nombre,
			collection: input.collection,
			entryId: e.id,
			antes,
			despues,
			hashDespues,
			ref: `importada:${s.despuesRevisionId}`,
			fecha: s.fecha,
			fijarHash: false,
		});
		hechas.add(s.despuesRevisionId);
		await ctx.kv.set(kImportado(input.collection, e.id), [...hechas]);
		salida.push({ despuesRevisionId: s.despuesRevisionId, resultado: `${r.cambios} cambio(s), ${r.cerrados} pendiente(s) cerrados` });
	}
	// A partir de aquí, el último texto visto es el actual.
	await recalcular(ctx, input.collection, e.id, { extra: (r) => void (r.hash ??= e.hash) });
	await sincronizar(env, input.collection, e.id, e.doc, e.hash);

	let aprobacion: string | null = null;
	if (input.aprobar) {
		const autor = await autorDeId(env, input.aprobar.autorId);
		if (!autor) aprobacion = "no se encuentra a la autora";
		else {
			const r = await darPorBueno(env, autor, input.collection, e.id, { fecha: input.aprobar.fecha, motivo: "publicado por ella desde el editor de artículos" });
			aprobacion = r.aprobado ? `aprobado por ${autor.nombre}` : `sin aprobar: ${r.motivo}`;
		}
	}
	return { sesiones: salida, aprobacion };
}
