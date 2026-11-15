/**
 * Runtime del plugin: storage, rutas, herramientas MCP, hooks y admin.
 *
 * El descriptor para astro.config.mjs está en ./index.ts (revisionPlugin).
 */

import { definePlugin } from "emdash";
import type { PluginContext, PluginRoute, ResolvedPlugin, RouteContext } from "emdash";
import { z } from "astro/zod";

import type { RevisionPluginOptions } from "./index.js";
import { requireUser } from "./lib/acceso.js";
import { gastoDelMes, guardarAjustes, leerAjustes, leerClaveApi } from "./lib/ajustes.js";
import { aprobar, guardarLectura, publicar, retirar } from "./lib/aprobacion.js";
import { darVeredicto } from "./lib/cambios.js";
import {
	aplicarComentario,
	borrarComentario,
	cambiarEstadoComentario,
	crearComentario,
	editarComentario,
} from "./lib/comentarios.js";
import { coleccionConfigurada, leerEntrada, type Entorno } from "./lib/contenido.js";
import {
	copiaAntesDePublicar,
	copiaDeEdicionExterna,
	esEdicionExterna,
	listarVersiones,
	restaurarVersion,
	verVersion,
} from "./lib/historial.js";
import { MODELOS } from "./lib/costes.js";
import { importarPreguntas, responderPregunta } from "./lib/preguntas.js";
import { leerRevision, purgarEntrada, sincronizar } from "./lib/revisiones.js";
import { allRows, collections, nowIso, nuevoId, STORAGE } from "./lib/store.js";
import {
	aplicarPendiente,
	articuloDeTrabajo,
	cancelar,
	cola,
	crearTrabajo,
	ejecutarTrabajoApi,
	entregar,
	reclamar,
	terminar,
	trabajoVista,
	ultimoTrabajo,
} from "./lib/trabajos.js";
import type { AjustesVista, GuiaDoc } from "./lib/types.js";
import { articulo, inicio } from "./lib/vistas.js";
import { PLUGIN_ID, VERSION } from "./version.js";

// ─── Esquemas ────────────────────────────────────────────────────

const coleccion = z.string().min(1).max(100);
const idEntrada = z.string().min(1).max(200);
const idSimple = z.string().min(1).max(200);
const ref = z.object({ collection: coleccion, id: idEntrada });

const anclaSchema = z.object({
	campo: z.enum(["content", "title", "excerpt", "references"]),
	blockKey: z.string().max(100).optional(),
	ruta: z.string().max(200).optional(),
	inicio: z.number().int().min(0).optional(),
	fin: z.number().int().min(0).optional(),
	cita: z.string().max(5000),
	prefijo: z.string().max(200).optional(),
	sufijo: z.string().max(200).optional(),
	baseRevisionId: z.string().nullable().optional(),
});

const modeloSchema = z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"]);
const esfuerzoSchema = z.enum(["low", "medium", "high", "xhigh"]);
const motorSchema = z.enum(["api", "local"]);

const opSchema = z.union([
	z.object({ op: z.literal("reemplazar"), blockKey: z.string(), markdown: z.string(), comentarioIds: z.array(z.string()) }),
	z.object({ op: z.literal("insertar_tras"), blockKey: z.string(), markdown: z.string(), comentarioIds: z.array(z.string()) }),
	z.object({ op: z.literal("eliminar"), blockKey: z.string(), comentarioIds: z.array(z.string()) }),
	z.object({ op: z.literal("campo"), campo: z.enum(["title", "excerpt"]), texto: z.string(), comentarioIds: z.array(z.string()) }),
]);
const resolucionSchema = z.object({
	comentarioId: z.string(),
	accion: z.enum(["aplicado", "descartado"]),
	nota: z.string(),
});

const ajustesSchema = z.object({
	modeloDefecto: modeloSchema.optional(),
	esfuerzo: esfuerzoSchema.optional(),
	topeMensualUsd: z.number().min(0).max(10_000).optional(),
	rolAprueba: z.number().int().min(10).max(50).optional(),
	requiereAprobacion: z.boolean().optional(),
	motorHeTerminado: motorSchema.optional(),
	adminNombre: z.string().max(120).optional(),
	avisarA: z.string().max(320).optional(),
	terminosSensibles: z.string().max(5000).optional(),
});

const schemas = {
	vacio: z.object({}).optional(),
	ref,
	lectura: ref.extend({
		bloquesVistos: z.array(z.string().max(100)).max(5000),
		posicion: z.string().max(100).nullable(),
		completada: z.boolean(),
	}),
	crearComentario: ref.extend({
		texto: z.string().min(1).max(10_000),
		textoPropuesto: z.string().max(10_000).nullable().optional(),
		ancla: anclaSchema.nullable(),
		fragmento: z.string().max(5000).nullable().optional(),
		parentId: z.string().max(200).nullable().optional(),
	}),
	editarComentario: z.object({
		id: idSimple,
		texto: z.string().min(1).max(10_000),
		textoPropuesto: z.string().max(10_000).nullable().optional(),
	}),
	estadoComentario: z.object({ id: idSimple, estado: z.enum(["abierto", "descartado"]) }),
	id: z.object({ id: idSimple }),
	responder: z.object({
		reglaId: idSimple,
		tipo: z.enum(["correcto", "quitar", "cambiar", "luego"]),
		texto: z.string().max(10_000).nullable().optional(),
	}),
	confirmable: ref.extend({ confirmar: z.boolean().optional() }),
	veredicto: z.object({
		id: idSimple,
		veredicto: z.enum(["pendiente", "bien", "deshecho", "no_es_esto"]),
		nota: z.string().max(10_000).nullable().optional(),
		confirmado: z.boolean().optional(),
	}),
	crearTrabajo: ref.extend({
		motor: motorSchema,
		modelo: modeloSchema.optional(),
		esfuerzo: esfuerzoSchema.optional(),
		completa: z.boolean().optional(),
	}),
	guia: z.object({
		id: idSimple.optional(),
		nombre: z.string().min(1).max(200),
		markdown: z.string().max(200_000),
		orden: z.number().int().optional(),
	}),
	ajustes: ajustesSchema,
	importar: z.object({
		preguntas: z
			.array(
				z.object({
					pregunta: z.string().min(1).max(5000),
					entradas: z
						.array(
							z.object({
								collection: coleccion,
								slug: z.string().max(300).optional(),
								id: z.string().max(200).optional(),
								cita: z.string().max(5000).optional(),
							}),
						)
						.max(500),
				}),
			)
			.max(500),
	}),
	reclamar: z.object({ trabajoId: idSimple.optional() }),
	trabajoId: z.object({ trabajoId: idSimple }),
	restaurar: z.object({ id: idSimple, publicar: z.boolean().optional(), confirmar: z.boolean().optional() }),
	entregar: z.object({
		trabajoId: idSimple,
		ops: z.array(opSchema).max(2000),
		resoluciones: z.array(resolucionSchema).max(2000),
	}),
};

// ─── Plugin ──────────────────────────────────────────────────────

export function createPlugin(options: RevisionPluginOptions): ResolvedPlugin {
	if (!options?.collections || Object.keys(options.collections).length === 0) {
		throw new Error("[emdash-revision] falta `collections` (p. ej. revisionPlugin({ collections: { posts: {} } })).");
	}
	/** Escrituras propias del plugin pendientes de reconocer en `content:afterSave`. */
	const propias = new Set<string>();
	const entorno = (ctx: PluginContext): Entorno => ({
		ctx,
		opciones: options,
		propias,
		usuario: (ctx as Partial<RouteContext<unknown>>).user ?? null,
	});

	function memberRoute<T>(input: z.ZodType<T>, handler: (ctx: RouteContext<T>) => Promise<unknown>): PluginRoute<T> {
		return { permission: "plugins:read", input, handler };
	}
	function adminRoute<T>(input: z.ZodType<T>, handler: (ctx: RouteContext<T>) => Promise<unknown>): PluginRoute<T> {
		return { permission: "plugins:manage", input, handler };
	}

	async function ajustesVista(ctx: PluginContext): Promise<AjustesVista> {
		return {
			ajustes: await leerAjustes(ctx),
			apiDisponible: !!(await leerClaveApi(options.claveApi ?? "ANTHROPIC_API_KEY")),
			gastoMes: await gastoDelMes(ctx),
			mcpUrl: ctx.url("/_emdash/api/mcp"),
			modelos: MODELOS.map((m) => ({ id: m.id, nombre: m.nombre, costeOrientativo: m.costeOrientativo })),
		};
	}

	const routes: Record<string, PluginRoute<any>> = {
		// ── Revisora (plugins:read) ──
		inicio: memberRoute(schemas.vacio, async (ctx) => inicio(entorno(ctx), requireUser(ctx))),
		"articulo/get": memberRoute(schemas.ref, async (ctx) =>
			articulo(entorno(ctx), requireUser(ctx), ctx.input.collection, ctx.input.id),
		),
		"lectura/guardar": memberRoute(schemas.lectura, async (ctx) =>
			guardarLectura(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"comentarios/crear": memberRoute(schemas.crearComentario, async (ctx) =>
			crearComentario(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"comentarios/editar": memberRoute(schemas.editarComentario, async (ctx) =>
			editarComentario(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"comentarios/estado": memberRoute(schemas.estadoComentario, async (ctx) =>
			cambiarEstadoComentario(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"comentarios/borrar": memberRoute(schemas.id, async (ctx) =>
			borrarComentario(entorno(ctx), requireUser(ctx), ctx.input.id),
		),
		"comentarios/aplicar": memberRoute(schemas.id, async (ctx) => {
			const user = requireUser(ctx);
			const env = entorno(ctx);
			const r = await aplicarComentario(env, user, ctx.input.id);
			return articulo(env, user, r.collection, r.entryId);
		}),
		"preguntas/responder": memberRoute(schemas.responder, async (ctx) =>
			responderPregunta(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"revision/terminar": memberRoute(schemas.ref, async (ctx) =>
			terminar(entorno(ctx), requireUser(ctx), ctx.input.collection, ctx.input.id),
		),
		"revision/aprobar": memberRoute(schemas.confirmable, async (ctx) =>
			aprobar(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"revision/retirar": memberRoute(schemas.ref, async (ctx) => retirar(entorno(ctx), requireUser(ctx), ctx.input)),
		"revision/publicar": memberRoute(schemas.confirmable, async (ctx) =>
			publicar(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"cambios/veredicto": memberRoute(schemas.veredicto, async (ctx) =>
			darVeredicto(entorno(ctx), requireUser(ctx), ctx.input),
		),
		"trabajo/estado": memberRoute(schemas.ref, async (ctx) => {
			requireUser(ctx);
			const t = await ultimoTrabajo(ctx, ctx.input.collection, ctx.input.id);
			return {
				trabajo: t ? trabajoVista(t.id, t.data) : null,
				revision: await leerRevision(ctx, ctx.input.collection, ctx.input.id),
			};
		}),

		// ── Historial de versiones (plugins:read) ──
		"versiones/listar": memberRoute(schemas.ref, async (ctx) => {
			requireUser(ctx);
			return listarVersiones(entorno(ctx), ctx.input);
		}),
		"versiones/ver": memberRoute(schemas.id, async (ctx) => {
			requireUser(ctx);
			return verVersion(entorno(ctx), ctx.input.id);
		}),
		"versiones/restaurar": memberRoute(schemas.restaurar, async (ctx) => {
			const user = requireUser(ctx);
			const env = entorno(ctx);
			const r = await restaurarVersion(env, user, ctx.input);
			if ("requiereConfirmacion" in r) return r;
			return articulo(env, user, r.collection, r.entryId);
		}),

		// ── Administración (plugins:manage) ──
		"trabajo/crear": adminRoute(schemas.crearTrabajo, async (ctx) => {
			const { collection, id, ...opts } = ctx.input;
			const t = await crearTrabajo(entorno(ctx), ctx.user ?? null, collection, id, opts);
			return { trabajo: trabajoVista(t.id, t.data) };
		}),
		"trabajo/cancelar": adminRoute(schemas.id, async (ctx) => cancelar(entorno(ctx), ctx.input.id)),
		"trabajo/aplicar-pendiente": adminRoute(schemas.id, async (ctx) => aplicarPendiente(entorno(ctx), ctx.input.id)),
		"guias/listar": adminRoute(schemas.vacio, async (ctx) => {
			const rows = await allRows(collections(ctx).guias, { orderBy: { orden: "asc" } }, 500);
			return { guias: rows.map((r) => ({ ...r.data, id: r.id })) };
		}),
		"guias/guardar": adminRoute(schemas.guia, async (ctx) => {
			const { guias } = collections(ctx);
			const id = ctx.input.id ?? nuevoId();
			const actual = ctx.input.id ? await guias.get(ctx.input.id) : null;
			const orden = ctx.input.orden ?? actual?.orden ?? (await guias.count());
			const guia: GuiaDoc = { nombre: ctx.input.nombre.trim(), markdown: ctx.input.markdown, orden, actualizado: nowIso() };
			await guias.put(id, guia);
			return { guia: { ...guia, id } };
		}),
		"guias/borrar": adminRoute(schemas.id, async (ctx) => {
			await collections(ctx).guias.delete(ctx.input.id);
			return { ok: true };
		}),
		"ajustes/get": adminRoute(schemas.vacio, async (ctx) => ajustesVista(ctx)),
		"ajustes/guardar": adminRoute(schemas.ajustes, async (ctx) => {
			await guardarAjustes(ctx, ctx.input);
			return ajustesVista(ctx);
		}),
		"preguntas/importar": adminRoute(schemas.importar, async (ctx) =>
			importarPreguntas(entorno(ctx), ctx.user, ctx.input.preguntas),
		),

		// ── Motor B (Claude Code por MCP) ──
		"mcp/cola": adminRoute(schemas.vacio, async (ctx) => cola(entorno(ctx))),
		"mcp/reclamar": adminRoute(schemas.reclamar, async (ctx) => reclamar(entorno(ctx), ctx.input.trabajoId)),
		"mcp/articulo": adminRoute(schemas.trabajoId, async (ctx) => articuloDeTrabajo(entorno(ctx), ctx.input.trabajoId)),
		"mcp/entregar": adminRoute(schemas.entregar, async (ctx) =>
			entregar(entorno(ctx), ctx.input.trabajoId, { ops: ctx.input.ops, resoluciones: ctx.input.resoluciones }),
		),
	};

	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		capabilities: [
			"content:read",
			"content:revisions:read",
			"content:write",
			"content:publish",
			"users:read",
			"email:send",
			"network:request",
			"hooks.content-policy:register",
		],
		allowedHosts: ["api.anthropic.com"],
		storage: STORAGE,

		hooks: {
			"content:afterSave": {
				timeout: 30_000,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					if (!coleccionConfigurada(options, event.collection)) return;
					const id = typeof event.content.id === "string" ? event.content.id : null;
					if (!id) return;
					const env = entorno(ctx);
					const rev = await collections(ctx).revisiones.get(`${event.collection}:${id}`);
					if (!rev) return;
					const e = await leerEntrada(env, event.collection, id);
					// Edición en el editor nativo: copia del estado anterior antes de sincronizar.
					if (esEdicionExterna(env, event.collection, e.id, rev.hash, e.hash)) {
						await copiaDeEdicionExterna(env, e, rev.hash, event.actor?.id ?? null);
					}
					await sincronizar(env, event.collection, e.id, e.doc, e.hash);
				},
			},
			"content:beforePublish": {
				// Debe ser rápido (5 s) y no cancelar nunca: solo guarda la copia de lo publicado.
				timeout: 5_000,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					await copiaAntesDePublicar(entorno(ctx), event);
				},
			},
			"content:afterDelete": {
				timeout: 60_000,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					if (!event.permanent || !coleccionConfigurada(options, event.collection)) return;
					await purgarEntrada(ctx, event.collection, event.id);
				},
			},
			cron: {
				// La llamada a la API puede tardar varios minutos.
				timeout: 9 * 60 * 1000,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					if (!event.name.startsWith("trabajo-")) return;
					const trabajoId = typeof event.data?.trabajoId === "string" ? event.data.trabajoId : null;
					if (!trabajoId) return;
					await ejecutarTrabajoApi(entorno(ctx), trabajoId);
				},
			},
			"plugin:uninstall": {
				handler: async (event, ctx) => {
					if (!event.deleteData) return;
					await borrarTodo(ctx);
				},
			},
		},

		routes,

		mcp: {
			tools: {
				revision_cola: {
					description:
						"Lista las correcciones en cola para Claude Code: artículo (colección, id, título), nº de comentarios abiertos y estado.",
					route: "mcp/cola",
					input: z.object({}),
					destructive: false,
				},
				revision_reclamar: {
					description:
						"Reclama una corrección (la más antigua en cola, o la indicada con trabajoId) durante 30 minutos y devuelve la entrada completa: bloques del artículo con su clave, comentarios, guías de redacción y reglas, más las instrucciones para corregir. Devuelve {vacio:true} si no hay nada en cola.",
					route: "mcp/reclamar",
					input: schemas.reclamar,
					destructive: false,
				},
				revision_articulo: {
					description:
						"Vuelve a leer la entrada de una corrección ya reclamada (bloques, comentarios, guías, reglas e instrucciones) sin cambiar su estado.",
					route: "mcp/articulo",
					input: schemas.trabajoId,
					destructive: false,
				},
				revision_entregar: {
					description:
						"Entrega la corrección de un trabajo reclamado: `ops` (reemplazar, insertar_tras, eliminar o campo, cada una con los comentarioIds a los que responde) y `resoluciones` (por comentario: aplicado o descartado, con una nota). Guarda los cambios en el borrador para la segunda revisión; no aprueba ni publica. Idempotente. Si el texto cambió desde que se reclamó, devuelve estado «conflicto» sin aplicar nada.",
					route: "mcp/entregar",
					input: schemas.entregar,
					destructive: true,
				},
			},
		},

		admin: {
			entry: "emdash-revision/admin",
			pages: [
				{ path: "/", label: options.etiqueta ?? "Revisión", icon: "check-circle" },
				{ path: "/guias", label: "Guías de redacción", icon: "book-open" },
				{ path: "/ajustes", label: "Ajustes de revisión", icon: "gear" },
			],
		},
	});
}

export default createPlugin;

async function borrarTodo(ctx: PluginContext): Promise<void> {
	const cols = collections(ctx);
	for (const name of Object.keys(STORAGE) as Array<keyof typeof STORAGE>) {
		const col = cols[name] as unknown as {
			query: (o: { limit: number }) => Promise<{ items: Array<{ id: string }> }>;
			deleteMany: (ids: string[]) => Promise<number>;
		};
		for (;;) {
			const page = await col.query({ limit: 100 });
			if (!page.items.length) break;
			await col.deleteMany(page.items.map((i) => i.id));
		}
	}
	for (const { key } of await ctx.kv.list()) await ctx.kv.delete(key);
}
