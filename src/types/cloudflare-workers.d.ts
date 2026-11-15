/**
 * Declaración mínima del módulo virtual de Cloudflare. Evita depender de
 * @cloudflare/workers-types (incompatible con lib DOM, que necesita el admin).
 */
declare module "cloudflare:workers" {
	export const env: Record<string, unknown>;
}
