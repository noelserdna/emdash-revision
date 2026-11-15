/**
 * Re-exporta el env del Worker desde un módulo propio.
 *
 * `cloudflare:workers` es un módulo virtual del runtime. Mantener el import
 * estático aquí, y cargar este fichero con un import dinámico relativo desde
 * el resto del plugin, hace que el bundle se resuelva bien dentro de un Worker
 * de Astro y que en Node (tests) el fallo quede contenido en el import dinámico.
 * El build deja `cloudflare:workers` como externo.
 */

export { env } from "cloudflare:workers";
