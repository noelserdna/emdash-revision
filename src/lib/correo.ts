/**
 * Avisos por correo. `ctx.email` solo existe con la capacidad `email:send` y un
 * proveedor `email:deliver` configurado en el sitio: si falta, no se envía
 * nada y no se falla.
 */

import type { PluginContext } from "emdash";

export interface Aviso {
	to: string;
	subject: string;
	text: string;
}

export async function enviarCorreo(ctx: PluginContext, aviso: Aviso): Promise<boolean> {
	const to = aviso.to.trim();
	if (!to || !to.includes("@")) return false;
	if (!ctx.email) {
		ctx.log.info(`[correo] sin transporte; no se envía «${aviso.subject}» a ${to}`);
		return false;
	}
	try {
		await ctx.email.send({ to, subject: aviso.subject, text: aviso.text });
		return true;
	} catch (error) {
		ctx.log.warn(`[correo] no se pudo enviar «${aviso.subject}»`, { error: String(error) });
		return false;
	}
}

export function enlaceArticulo(ctx: PluginContext, collection: string, id: string): string {
	return ctx.url(
		`/_emdash/admin/plugins/emdash-revision/articulo?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`,
	);
}
