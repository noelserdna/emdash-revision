/**
 * Cliente de las rutas del plugin para el panel (CONTRATO.md §7).
 */

import { apiFetch, getErrorMessage, parseApiResponse } from "emdash/plugin-utils";

import type {
	Ajustes,
	AjustesVista,
	Ancla,
	Aprobacion,
	ArticuloVista,
	CambioVista,
	ComentarioVista,
	DocRevisable,
	Esfuerzo,
	EstadoAprendizajeVista,
	GuiaHistorialVista,
	GuiaDoc,
	HistorialVista,
	InicioVista,
	ModeloId,
	Motor,
	PreguntaVista,
	RevisionDoc,
	TrabajoVista,
	Veredicto,
	VersionDetalle,
} from "../lib/types.js";
import { T } from "./textos.js";

export const API_BASE = "/_emdash/api/plugins/emdash-revision";
export const ADMIN_BASE = "/_emdash/admin/plugins/emdash-revision";

/** Error de una ruta, con el código HTTP para distinguir la sesión caducada (401) o sin permiso (403). */
export class ErrorApi extends Error {
	constructor(
		mensaje: string,
		readonly status: number,
	) {
		super(mensaje);
		this.name = "ErrorApi";
	}
}

export function esSesionCaducada(e: unknown): boolean {
	return e instanceof ErrorApi && e.status === 401;
}

export function esSinPermiso(e: unknown): boolean {
	return e instanceof ErrorApi && e.status === 403;
}

export function mensajeDe(e: unknown): string {
	if (esSesionCaducada(e)) return T.sesionCaducada;
	if (esSinPermiso(e)) return T.sinPermiso;
	if (e instanceof Error && e.message) return e.message;
	return T.errorGenerico;
}

export async function llamar<T>(ruta: string, cuerpo: unknown = {}, opciones: { keepalive?: boolean } = {}): Promise<T> {
	let res: Response;
	try {
		res = await apiFetch(`${API_BASE}/${ruta}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(cuerpo),
			keepalive: opciones.keepalive,
		});
	} catch {
		throw new ErrorApi("No hay conexión. Comprueba tu red e inténtalo de nuevo.", 0);
	}
	if (!res.ok) throw new ErrorApi(await getErrorMessage(res, T.errorGenerico), res.status);
	return parseApiResponse<T>(res, T.errorGenerico);
}

// ─── Respuestas con confirmación ─────────────────────────────────────────────

export type RespuestaAprobar =
	| { revision: RevisionDoc; requiereConfirmacion?: undefined }
	| { requiereConfirmacion: true; leido: number; cambiosPendientes: number };

export type RespuestaPublicar =
	| { ok: true; urlPublica: string | null; requiereConfirmacion?: undefined }
	| { requiereConfirmacion: true; motivo: string; aprobacion: Aprobacion | null };

export type RespuestaRestaurar =
	| (ArticuloVista & { requiereConfirmacion?: undefined })
	| { requiereConfirmacion: true; motivo: string; aprobacion: Aprobacion | null };

export interface Clave {
	collection: string;
	id: string;
}

// ─── Rutas ───────────────────────────────────────────────────────────────────

export const api = {
	inicio: () => llamar<InicioVista>("inicio"),
	articulo: (c: Clave) => llamar<ArticuloVista>("articulo/get", c),
	guardarLectura: (
		c: Clave & { bloquesVistos: string[]; posicion: string | null; completada: boolean },
		keepalive = false,
	) => llamar<{ ok: true }>("lectura/guardar", c, { keepalive }),
	crearComentario: (
		c: Clave & { texto: string; textoPropuesto?: string; ancla: Ancla | null; fragmento?: string; parentId?: string; general?: boolean },
	) => llamar<{ comentario: ComentarioVista; revision: RevisionDoc }>("comentarios/crear", c),
	editarComentario: (b: { id: string; texto: string; textoPropuesto?: string | null }) =>
		llamar<{ comentario: ComentarioVista }>("comentarios/editar", b),
	estadoComentario: (b: { id: string; estado: "abierto" | "descartado" }) =>
		llamar<{ comentario: ComentarioVista; revision: RevisionDoc }>("comentarios/estado", b),
	borrarComentario: (id: string) => llamar<{ ok: true; revision: RevisionDoc }>("comentarios/borrar", { id }),
	corregirComentario: (id: string) => llamar<ArticuloVista>("comentarios/corregir", { id }),
	editarBloque: (b: Clave & { campo: "content" | "title" | "excerpt"; blockKey?: string; texto: string }) =>
		llamar<ArticuloVista>("bloque/editar", b),
	aplicarComentario: (id: string) => llamar<ArticuloVista>("comentarios/aplicar", { id }),
	responderPregunta: (b: { reglaId: string; tipo: "correcto" | "quitar" | "cambiar" | "luego"; texto?: string }) =>
		llamar<{ pregunta: PreguntaVista }>("preguntas/responder", b),
	terminar: (c: Clave) => llamar<{ trabajo: TrabajoVista }>("revision/terminar", c),
	aprobar: (c: Clave & { confirmar?: boolean }) => llamar<RespuestaAprobar>("revision/aprobar", c),
	retirar: (c: Clave) => llamar<{ revision: RevisionDoc }>("revision/retirar", c),
	publicar: (c: Clave & { confirmar?: boolean }) => llamar<RespuestaPublicar>("revision/publicar", c),
	editarCambio: (b: { id: string; texto: string }) =>
		llamar<{ cambio: CambioVista; revision: RevisionDoc; doc: DocRevisable }>("cambios/editar", b),
	veredicto: (b: { id: string; veredicto: Veredicto; nota?: string; confirmado?: boolean }) =>
		llamar<{ cambio: CambioVista; revision: RevisionDoc; doc?: DocRevisable }>("cambios/veredicto", b),
	versiones: (c: Clave) => llamar<HistorialVista>("versiones/listar", c),
	verVersion: (id: string) => llamar<VersionDetalle>("versiones/ver", { id }),
	restaurarVersion: (b: { id: string; publicar?: boolean; confirmar?: boolean }) =>
		llamar<RespuestaRestaurar>("versiones/restaurar", b),
	estadoTrabajo: (c: Clave) => llamar<{ trabajo: TrabajoVista | null; revision: RevisionDoc }>("trabajo/estado", c),
	crearTrabajo: (b: Clave & { motor: Motor; modelo?: ModeloId; esfuerzo?: Esfuerzo; completa?: boolean }) =>
		llamar<{ trabajo: TrabajoVista }>("trabajo/crear", b),
	cancelarTrabajo: (id: string) => llamar<{ ok: true }>("trabajo/cancelar", { id }),
	aplicarPendiente: (id: string) => llamar<{ trabajo: TrabajoVista }>("trabajo/aplicar-pendiente", { id }),
	listarGuias: () => llamar<{ guias: Array<GuiaDoc & { id: string }> }>("guias/listar"),
	guardarGuia: (b: { id?: string; nombre: string; markdown: string; orden?: number }) =>
		llamar<{ guia: GuiaDoc & { id: string } }>("guias/guardar", b),
	borrarGuia: (id: string) => llamar<{ ok: true }>("guias/borrar", { id }),
	ajustes: () => llamar<AjustesVista>("ajustes/get"),
	guardarAjustes: (a: Partial<Ajustes>) => llamar<AjustesVista>("ajustes/guardar", a),
	guardarClave: (clave: string) =>
		llamar<AjustesVista & { comprobacion: "valida" | "sin_comprobar" }>("ajustes/clave", { clave }),
	borrarClave: () => llamar<AjustesVista>("ajustes/clave-borrar"),
	estadoAprendizaje: () => llamar<EstadoAprendizajeVista>("aprendizaje/estado"),
	actualizarAprendizaje: () =>
		llamar<{ programado: boolean; motivo: "sin_clave" | "tope" | "sin_senales" | null; estado: EstadoAprendizajeVista }>(
			"aprendizaje/actualizar",
		),
	retirarAprendizaje: (id: string) => llamar<EstadoAprendizajeVista>("aprendizaje/retirar", { id }),
	historialGuia: () => llamar<{ versiones: GuiaHistorialVista[] }>("aprendizaje/historial"),
	restaurarGuia: (id: string) => llamar<EstadoAprendizajeVista>("aprendizaje/restaurar", { id }),
};

// ─── URLs del panel ──────────────────────────────────────────────────────────

export function urlInicio(): string {
	return `${ADMIN_BASE}/`;
}

export function urlArticulo(c: Clave): string {
	const q = new URLSearchParams({ collection: c.collection, id: c.id });
	return `${ADMIN_BASE}/articulo?${q.toString()}`;
}

export function urlGuias(guia?: string): string {
	return `${ADMIN_BASE}/guias${guia ? `?guia=${encodeURIComponent(guia)}` : ""}`;
}

export function urlAjustes(): string {
	return `${ADMIN_BASE}/ajustes`;
}
