/**
 * Hash y serialización canónica del documento revisable (pura).
 *
 * La forma canónica quita todas las `_key`, ordena las claves de los objetos y
 * sustituye las marcas que apuntan a `markDefs` por su posición (`#0`, `#1`…), de
 * modo que regenerar claves no cambia el hash y cambiar el texto sí.
 */
import type { DocRevisable } from "./types.js";

function canonizar(valor: unknown, defs: Map<string, string> | null): unknown {
	if (Array.isArray(valor)) return valor.map((v) => canonizar(v, defs));
	if (!valor || typeof valor !== "object") return valor;
	const obj = valor as Record<string, unknown>;
	// Un contenedor con markDefs define el mapa de marcas para sus spans.
	let mapa = defs;
	if (Array.isArray(obj.markDefs)) {
		mapa = new Map();
		obj.markDefs.forEach((d, i) => {
			const k = (d as { _key?: unknown })?._key;
			if (typeof k === "string") mapa?.set(k, `#${i}`);
		});
	}
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(obj).sort()) {
		if (k === "_key") continue;
		const v = obj[k];
		if (v === undefined) continue;
		if (k === "marks" && Array.isArray(v) && obj._type === "span") {
			out[k] = v.map((m) => (typeof m === "string" && mapa?.has(m) ? mapa.get(m) : m));
			continue;
		}
		out[k] = canonizar(v, mapa);
	}
	return out;
}

/** Serialización canónica (sin `_key`, claves ordenadas) de cualquier valor. */
export function canonico(valor: unknown): string {
	return JSON.stringify(canonizar(valor, null)) ?? "null";
}

/** true si dos valores son iguales salvo por sus `_key`. */
export function igualesSinClaves(a: unknown, b: unknown): boolean {
	return canonico(a) === canonico(b);
}

/** SHA-256 hex de la serialización canónica de { titulo, extracto, referencias, content sin _key }. */
export async function hashDoc(doc: DocRevisable): Promise<string> {
	const texto = canonico({
		titulo: doc.titulo ?? "",
		extracto: doc.extracto ?? "",
		referencias: doc.referencias ?? "",
		content: doc.content ?? [],
	});
	const datos = new TextEncoder().encode(texto);
	const resumen = await crypto.subtle.digest("SHA-256", datos);
	return Array.from(new Uint8Array(resumen), (b) => b.toString(16).padStart(2, "0")).join("");
}
