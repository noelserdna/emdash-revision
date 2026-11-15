/**
 * Precios y coste estimado de la corrección por API.
 * Librería PURA.
 */

import type { ModeloId, UsoIA } from "./types.js";

/** Precios en USD por millón de tokens (entrada / salida). Coste orientativo por artículo con reescritura completa. */
export const MODELOS: Array<{ id: ModeloId; nombre: string; entrada: number; salida: number; costeOrientativo: string }> = [
	{ id: "claude-opus-5-5", nombre: "Claude Opus 5.5", entrada: 4, salida: 20, costeOrientativo: "~0,36 $ por artículo" },
	{ id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5", entrada: 2, salida: 10, costeOrientativo: "~0,18 $ por artículo" },
	{ id: "claude-haiku-5-5", nombre: "Claude Haiku 5.5", entrada: 0.1, salida: 0.5, costeOrientativo: "~0,01 $ por artículo" },
	{ id: "claude-fable-5-2", nombre: "Claude Fable 5.2", entrada: 8, salida: 40, costeOrientativo: "~0,72 $ por artículo" },
];

/** La lectura de caché cuesta el 10 % del precio de entrada; la escritura, el 125 %. */
const FACTOR_LECTURA_CACHE = 0.1;
const FACTOR_ESCRITURA_CACHE = 1.25;

/** Coste en USD de una llamada. Modelo desconocido → 0. */
export function costeDe(modelo: ModeloId, uso: UsoIA): number {
	const m = MODELOS.find((x) => x.id === modelo);
	if (!m) return 0;
	const entrada =
		uso.input_tokens +
		(uso.cache_read_input_tokens ?? 0) * FACTOR_LECTURA_CACHE +
		(uso.cache_creation_input_tokens ?? 0) * FACTOR_ESCRITURA_CACHE;
	return (entrada * m.entrada + uso.output_tokens * m.salida) / 1_000_000;
}
