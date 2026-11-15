/**
 * emdash-revision — revisión editorial para EmDash CMS.
 *
 * Este módulo se carga en astro.config.mjs (build-time): no debe tener efectos.
 *
 *   import { revisionPlugin } from "emdash-revision";
 *   emdash({ plugins: [revisionPlugin({ collections: { posts: { campoRevisado: "reviewed_at" } } })] })
 */

import type { PluginDescriptor } from "emdash";

import { STORAGE_FLAT } from "./lib/store.js";
import { PLUGIN_ID, VERSION } from "./version.js";

export interface OpcionesColeccion {
	/** Campo de título. Por defecto "title". */
	titulo?: string;
	/** Campo de extracto (texto). Por defecto "excerpt"; null si no hay. */
	extracto?: string | null;
	/** Campo Portable Text con el cuerpo. Por defecto "content". */
	contenido?: string;
	/** Campo de texto con las referencias, una por línea. Por defecto "references"; null si no hay. */
	referencias?: string | null;
	/** Campo de imagen de portada. Por defecto "featured_image"; null si no hay. */
	portada?: string | null;
	/** Campo de fecha que se rellena al aprobar. null para no escribir nada. */
	campoRevisado?: string | null;
	/** Prefijo de la URL pública, p. ej. "/articulos/". Si falta, se usa getPublicUrl. */
	urlPublica?: string | null;
}

export interface RevisionPluginOptions {
	/** Colecciones que se revisan y sus campos. Obligatorio. */
	collections: Record<string, OpcionesColeccion>;
	/** Nombre en el menú del panel. Por defecto "Revisión". */
	etiqueta?: string;
	/** Tipografía de la columna de lectura (familias CSS ya cargadas por `css`). */
	lectura?: {
		cuerpo?: string;
		titulos?: string;
		/** URL de una hoja de estilos con las fuentes (p. ej. Google Fonts). */
		css?: string;
	};
	/** Nombre del secreto del Worker con la clave de Anthropic. Por defecto "ANTHROPIC_API_KEY". */
	claveApi?: string;
	/** Locale de fechas. Por defecto "es-ES". */
	locale?: string;
}

export type * from "./lib/types.js";

export function revisionPlugin(options: RevisionPluginOptions): PluginDescriptor<RevisionPluginOptions> {
	if (!options?.collections || Object.keys(options.collections).length === 0) {
		throw new Error('[emdash-revision] revisionPlugin() necesita { collections: { posts: {} } }.');
	}
	const etiqueta = options.etiqueta ?? "Revisión";
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: "emdash-revision/plugin",
		adminEntry: "emdash-revision/admin",
		options,
		capabilities: [
			"content:read",
			"content:revisions:read",
			"content:write",
			"content:publish",
			"users:read",
			"email:send",
			"network:request",
		],
		allowedHosts: ["api.anthropic.com"],
		adminPages: [
			{ path: "/", label: etiqueta, icon: "check-circle" },
			{ path: "/guias", label: "Guías de redacción", icon: "book-open" },
			{ path: "/ajustes", label: "Ajustes de revisión", icon: "gear" },
		],
		// El descriptor solo admite índices planos; los compuestos van en definePlugin.
		storage: STORAGE_FLAT,
	};
}

export { PLUGIN_ID, VERSION };
