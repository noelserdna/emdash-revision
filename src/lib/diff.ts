/**
 * Diff por palabras (pura). Los espacios y la puntuación son tokens propios, así que
 * concatenar `igual` + `eliminado` reproduce `antes` y `igual` + `añadido`, `despues`.
 */
import type { SegmentoDiff } from "./types.js";

/** Límite de celdas de la tabla LCS; por encima se compara solo prefijo y sufijo comunes. */
const MAX_CELDAS = 4_000_000;

/** Palabras, espacios y signos de puntuación sueltos. */
export function tokenizarPalabras(texto: string): string[] {
	return texto.match(/\s+|[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu) ?? [];
}

type Paso = { tipo: SegmentoDiff["tipo"]; texto: string };

function lcs(a: string[], b: string[]): Paso[] {
	const n = a.length;
	const m = b.length;
	if (n === 0) return b.map((t) => ({ tipo: "añadido", texto: t }));
	if (m === 0) return a.map((t) => ({ tipo: "eliminado", texto: t }));
	if (n * m > MAX_CELDAS) return [...a.map((t) => ({ tipo: "eliminado" as const, texto: t })), ...b.map((t) => ({ tipo: "añadido" as const, texto: t }))];
	// dp[i][j] = LCS de a[i..] y b[j..], en un único array plano.
	const ancho = m + 1;
	const dp = new Uint32Array((n + 1) * ancho);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i * ancho + j] = a[i] === b[j] ? (dp[(i + 1) * ancho + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * ancho + j] ?? 0, dp[i * ancho + j + 1] ?? 0);
		}
	}
	const pasos: Paso[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pasos.push({ tipo: "igual", texto: a[i] ?? "" });
			i++;
			j++;
		} else if ((dp[(i + 1) * ancho + j] ?? 0) >= (dp[i * ancho + j + 1] ?? 0)) pasos.push({ tipo: "eliminado", texto: a[i++] ?? "" });
		else pasos.push({ tipo: "añadido", texto: b[j++] ?? "" });
	}
	while (i < n) pasos.push({ tipo: "eliminado", texto: a[i++] ?? "" });
	while (j < m) pasos.push({ tipo: "añadido", texto: b[j++] ?? "" });
	return pasos;
}

/** Diff por palabras (conserva espacios y puntuación como parte de los segmentos). LCS sobre tokens. */
export function diffPalabras(antes: string, despues: string): SegmentoDiff[] {
	const a = tokenizarPalabras(antes);
	const b = tokenizarPalabras(despues);
	// Prefijo y sufijo comunes fuera de la tabla.
	let ini = 0;
	while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
	let fa = a.length;
	let fb = b.length;
	while (fa > ini && fb > ini && a[fa - 1] === b[fb - 1]) {
		fa--;
		fb--;
	}
	const pasos: Paso[] = [
		...a.slice(0, ini).map((t) => ({ tipo: "igual" as const, texto: t })),
		...lcs(a.slice(ini, fa), b.slice(ini, fb)),
		...a.slice(fa).map((t) => ({ tipo: "igual" as const, texto: t })),
	];

	// Un espacio igual entre dos cambios se funde con ellos para no partir frases.
	for (let k = 1; k < pasos.length - 1; k++) {
		const p = pasos[k];
		if (p?.tipo === "igual" && /^\s+$/.test(p.texto) && pasos[k - 1]?.tipo !== "igual" && pasos[k + 1]?.tipo !== "igual") {
			pasos.splice(k, 1, { tipo: "eliminado", texto: p.texto }, { tipo: "añadido", texto: p.texto });
			k++;
		}
	}

	// Agrupar: en cada tramo de cambios, primero lo eliminado y luego lo añadido.
	const out: SegmentoDiff[] = [];
	let elim = "";
	let anad = "";
	const vaciar = () => {
		if (elim) out.push({ tipo: "eliminado", texto: elim });
		if (anad) out.push({ tipo: "añadido", texto: anad });
		elim = "";
		anad = "";
	};
	for (const p of pasos) {
		if (p.tipo === "eliminado") elim += p.texto;
		else if (p.tipo === "añadido") anad += p.texto;
		else {
			vaciar();
			const prev = out[out.length - 1];
			if (prev?.tipo === "igual") prev.texto += p.texto;
			else out.push({ tipo: "igual", texto: p.texto });
		}
	}
	vaciar();
	return out;
}
