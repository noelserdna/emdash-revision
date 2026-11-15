/**
 * Lectura, aprobación y publicación.
 */

import { PluginRouteError } from "emdash";

import { esAdmin, nombreDe, puedeAprobar, puedePublicar, type Usuario } from "./acceso.js";
import { leerAjustes } from "./ajustes.js";
import { escribirCampos, leerEntrada, urlPublicaDe, type Entorno } from "./contenido.js";
import { auditar, contar, leerRevision, recalcular, sincronizar } from "./revisiones.js";
import { collections, lecturaId, nowIso, upsertVersioned } from "./store.js";
import type { Aprobacion, LecturaDoc, RevisionDoc } from "./types.js";
import { porcentajeLeido } from "./vistas.js";

export async function guardarLectura(
	env: Entorno,
	user: Usuario,
	input: { collection: string; id: string; bloquesVistos: string[]; posicion: string | null; completada: boolean },
): Promise<{ ok: true }> {
	const rev = await leerRevision(env.ctx, input.collection, input.id);
	await upsertVersioned(collections(env.ctx).lecturas, lecturaId(user.id, input.collection, input.id), (actual) => {
		const mismoTexto = !!actual && actual.hash === rev.hash;
		const vistos = new Set([...(mismoTexto ? actual!.bloquesVistos : []), ...input.bloquesVistos]);
		const nueva: LecturaDoc = {
			userId: user.id,
			collection: input.collection,
			entryId: input.id,
			hash: rev.hash,
			bloquesVistos: [...vistos].slice(0, 5000),
			posicion: input.posicion,
			completada: input.completada || (mismoTexto && !!actual?.completada),
			fecha: nowIso(),
		};
		return nueva;
	});
	return { ok: true };
}

export async function aprobar(
	env: Entorno,
	user: Usuario,
	input: { collection: string; id: string; confirmar?: boolean },
): Promise<{ revision: RevisionDoc } | { requiereConfirmacion: true; leido: number; cambiosPendientes: number }> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	if (!puedeAprobar(user, ajustes)) throw PluginRouteError.forbidden("No tienes permiso para aprobar artículos.");
	const entrada = await leerEntrada(env, input.collection, input.id);
	await sincronizar(env, input.collection, entrada.id, entrada.doc, entrada.hash);
	const rev = await leerRevision(ctx, input.collection, entrada.id);
	const n = await contar(ctx, rev);
	const lectura = await collections(ctx).lecturas.get(lecturaId(user.id, input.collection, entrada.id));
	const completa = !!lectura?.completada;
	if (!input.confirmar && (!completa || n.cambiosPendientes > 0)) {
		return {
			requiereConfirmacion: true,
			leido: porcentajeLeido(lectura, entrada.doc.content.map((b) => b._key)),
			cambiosPendientes: n.cambiosPendientes,
		};
	}

	let draftRevisionId = entrada.draftRevisionId;
	if (entrada.campos.campoRevisado) {
		// El hash no incluye este campo: escribirlo no invalida la aprobación.
		await escribirCampos(env, input.collection, entrada.id, { [entrada.campos.campoRevisado]: nowIso() }, entrada.hash);
		const releida = await leerEntrada(env, input.collection, entrada.id);
		draftRevisionId = releida.draftRevisionId;
	}
	const aprobacion: Aprobacion = {
		draftRevisionId,
		hash: entrada.hash,
		userId: user.id,
		nombre: nombreDe(user),
		fecha: nowIso(),
		cambiadoDespues: false,
	};
	const revision = await recalcular(ctx, input.collection, entrada.id, {
		extra: (r) => {
			r.estado = "aprobado";
			r.aprobacion = aprobacion;
			r.hash = entrada.hash;
		},
	});
	await auditar(ctx, {
		accion: "aprobar",
		userId: user.id,
		collection: input.collection,
		entryId: entrada.id,
		revisionId: draftRevisionId,
		hash: entrada.hash,
		detalle: !completa || n.cambiosPendientes > 0 ? "aprobado con confirmación" : null,
	});
	return { revision };
}

export async function retirar(env: Entorno, user: Usuario, input: { collection: string; id: string }): Promise<{ revision: RevisionDoc }> {
	const { ctx } = env;
	const ajustes = await leerAjustes(ctx);
	if (!puedeAprobar(user, ajustes)) throw PluginRouteError.forbidden("No tienes permiso para retirar aprobaciones.");
	const revision = await recalcular(ctx, input.collection, input.id, {
		extra: (r) => {
			r.aprobacion = null;
			if (r.estado === "aprobado") r.estado = "por_revisar";
		},
	});
	await auditar(ctx, {
		accion: "retirar_aprobacion",
		userId: user.id,
		collection: input.collection,
		entryId: input.id,
		hash: revision.hash,
	});
	return { revision };
}

export function aprobacionVigente(rev: RevisionDoc, hash: string): boolean {
	return rev.estado === "aprobado" && !!rev.aprobacion && rev.aprobacion.hash === hash && !rev.aprobacion.cambiadoDespues;
}

export async function publicar(
	env: Entorno,
	user: Usuario,
	input: { collection: string; id: string; confirmar?: boolean },
): Promise<{ ok: true; urlPublica: string | null } | { requiereConfirmacion: true; motivo: string; aprobacion: Aprobacion | null }> {
	const { ctx } = env;
	if (!puedePublicar(user)) throw PluginRouteError.forbidden("No tienes permiso para publicar.");
	const content = ctx.content;
	if (!content?.getVersioned || !content.publish) {
		throw PluginRouteError.internal("El plugin no puede publicar (falta la capacidad content:publish).");
	}
	const ajustes = await leerAjustes(ctx);
	const entrada = await leerEntrada(env, input.collection, input.id);
	await sincronizar(env, input.collection, entrada.id, entrada.doc, entrada.hash);
	const rev = await leerRevision(ctx, input.collection, entrada.id);
	const vigente = aprobacionVigente(rev, entrada.hash);
	if (!vigente) {
		const motivo = !rev.aprobacion
			? "Este artículo no está aprobado."
			: `El texto ha cambiado después de que ${rev.aprobacion.nombre} lo aprobara.`;
		if (!input.confirmar) return { requiereConfirmacion: true, motivo, aprobacion: rev.aprobacion };
		if (ajustes.requiereAprobacion && !esAdmin(user)) {
			throw PluginRouteError.forbidden("Solo un administrador puede publicar un artículo sin aprobar.");
		}
	}
	const v = await content.getVersioned(input.collection, entrada.id);
	if (!v) throw PluginRouteError.notFound("No se encuentra el artículo.");
	const publicado = await content.publish(input.collection, entrada.id, { _rev: v._rev });
	await auditar(ctx, {
		accion: vigente ? "publicar" : "publicar_sin_aprobar",
		userId: user.id,
		collection: input.collection,
		entryId: entrada.id,
		revisionId: publicado.item.liveRevisionId ?? entrada.draftRevisionId,
		hash: entrada.hash,
	});
	return { ok: true, urlPublica: await urlPublicaDe(env, { ...entrada, item: publicado.item }) };
}
