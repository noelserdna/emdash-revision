/**
 * Usuario, roles y permisos.
 *
 * Las rutas ya exigen un permiso de EmDash (`plugins:read` para la revisora,
 * `plugins:manage` para el administrador). Aquí se resuelven los permisos
 * propios del plugin: quién aprueba, quién edita un comentario, quién publica.
 */

import { PluginRouteError } from "emdash";
import type { PluginContext, RouteContext } from "emdash";

import type { Ajustes, UsuarioVista } from "./types.js";

/** Usuario autenticado tal como lo expone RouteContext (emdash no exporta UserInfo). */
export type Usuario = NonNullable<RouteContext<unknown>["user"]>;

/** Roles de EmDash (@emdash-cms/auth Role). */
export const ROL_EDITOR = 40;
export const ROL_ADMIN = 50;

export function esAdmin(user: Usuario | undefined | null): boolean {
	return !!user && user.role >= ROL_ADMIN;
}

export function puedeAprobar(user: Usuario | undefined | null, ajustes: Ajustes): boolean {
	return !!user && user.role >= ajustes.rolAprueba;
}

/** Publicar desde el plugin se ejecuta como el plugin: la ruta comprueba el rol. */
export function puedePublicar(user: Usuario | undefined | null): boolean {
	return !!user && user.role >= ROL_EDITOR;
}

export function requireUser(ctx: RouteContext<unknown>): Usuario {
	if (!ctx.user) throw PluginRouteError.unauthorized("Esta operación necesita un usuario identificado.");
	return ctx.user;
}

export function nombreDe(user: Pick<Usuario, "name" | "email"> | null | undefined): string {
	if (!user) return "Alguien";
	return user.name?.trim() || user.email.split("@")[0] || user.email;
}

export function usuarioVista(user: Usuario, ajustes: Ajustes): UsuarioVista {
	return { id: user.id, nombre: nombreDe(user), esAdmin: esAdmin(user), puedeAprobar: puedeAprobar(user, ajustes) };
}

/** Nombre y correo de un usuario por id (capacidad users:read). Tolera su ausencia. */
export async function buscarUsuario(
	ctx: PluginContext,
	id: string | null | undefined,
): Promise<{ id: string; nombre: string; email: string; role: number } | null> {
	if (!id || !ctx.users) return null;
	try {
		const u = await ctx.users.get(id);
		return u ? { id: u.id, nombre: nombreDe(u), email: u.email, role: u.role } : null;
	} catch {
		return null;
	}
}
