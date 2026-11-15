/**
 * Detección de cambios sensibles entre dos versiones de un texto (pura): cifras con
 * su unidad, negaciones y cuantificadores, y términos extra (fármacos). Se comparan
 * multiconjuntos, así que reordenar una frase no da avisos y cambiar una cifra, sí.
 */
import type { Aviso } from "./types.js";

// ─── Cifras ──────────────────────────────────────────────────────────────────

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const ESP = String.raw`[\s   ]`;
const UNIDADES = [
	"%",
	"‰",
	"mg/dl",
	"mg/día",
	"mg/d",
	"mmol/l",
	"pg/ml",
	"ng/ml",
	"ui/l",
	"mmhg",
	"mg",
	"µg",
	"μg",
	"mcg",
	"ng",
	"pg",
	"kg",
	"g",
	"ml",
	"dl",
	"l",
	"ui",
	"iu",
	"kcal",
	"cm",
	"mm",
	"años",
	"año",
	"meses",
	"mes",
	"semanas",
	"semana",
	"días",
	"día",
	"horas",
	"hora",
	"minutos",
	"veces",
];
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const RE_CIFRA = new RegExp(
	String.raw`(?<![\p{L}\p{N}.,])(?:${NUM})(?:${ESP}*[-–—]${ESP}*(?:${NUM}))?(?:${ESP}?(?:${UNIDADES.map(escapar).join("|")})(?![\p{L}\p{N}]))?`,
	"giu",
);
/** Citas `[3]`, `[3, 4]`, `[3-5]`: no son cifras del texto. */
const RE_CITA = /\[\d+(?:\s*[-–,]\s*\d+)*\]/g;

interface Ficha {
	canon: string;
	original: string;
}

export function cifrasDe(texto: string): Ficha[] {
	const limpio = texto.replace(RE_CITA, (m) => " ".repeat(m.length));
	return [...limpio.matchAll(RE_CIFRA)].map((m) => {
		const original = m[0].replace(/[   ]/g, " ").trim();
		const canon = original.toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-").replace("μ", "µ");
		return { canon, original };
	});
}

// ─── Negaciones y cuantificadores ────────────────────────────────────────────

const NEGADORES = new Set(["no", "nunca", "ni", "sin", "jamás", "tampoco", "ninguna", "ninguno", "ningún", "nadie", "nada"]);
const CUANTIFICADORES = new Set([
	"siempre",
	"más",
	"menos",
	"antes",
	"después",
	"mayor",
	"menor",
	"mayores",
	"menores",
	"aumenta",
	"aumentan",
	"reduce",
	"reducen",
	"disminuye",
	"disminuyen",
	"todas",
	"todos",
]);

function palabrasClave(texto: string): Ficha[] {
	return (texto.match(/[\p{L}]+/gu) ?? [])
		.map((p) => ({ canon: p.toLowerCase(), original: p }))
		.filter((p) => NEGADORES.has(p.canon) || CUANTIFICADORES.has(p.canon));
}

// ─── Términos extra ──────────────────────────────────────────────────────────

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function contar(texto: string, termino: string): number {
	const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${escapar(sinTildes(termino))}(?![\p{L}\p{N}])`, "gu");
	return (sinTildes(texto).match(re) ?? []).length;
}

// ─── Comparación ─────────────────────────────────────────────────────────────

/** Diferencia de multiconjuntos por `canon`, en orden de aparición. */
function diferencia(a: Ficha[], b: Ficha[]): { quitadas: Ficha[]; nuevas: Ficha[] } {
	const resta = (x: Ficha[], y: Ficha[]) => {
		const cuenta = new Map<string, number>();
		for (const f of y) cuenta.set(f.canon, (cuenta.get(f.canon) ?? 0) + 1);
		const out: Ficha[] = [];
		for (const f of x) {
			const n = cuenta.get(f.canon) ?? 0;
			if (n > 0) cuenta.set(f.canon, n - 1);
			else out.push(f);
		}
		return out;
	};
	return { quitadas: resta(a, b), nuevas: resta(b, a) };
}

/** Avisos al comparar el texto de un bloque antes y después. `extra`: términos adicionales (fármacos). */
export function detectarSensibles(antes: string, despues: string, extra: string[] = []): Aviso[] {
	const avisos: Aviso[] = [];
	antes = antes ?? "";
	despues = despues ?? "";

	const c = diferencia(cifrasDe(antes), cifrasDe(despues));
	const pares = Math.min(c.quitadas.length, c.nuevas.length);
	for (let i = 0; i < pares; i++) {
		const q = c.quitadas[i]?.original ?? "";
		const n = c.nuevas[i]?.original ?? "";
		avisos.push({ tipo: "cifra", mensaje: `Ha cambiado una cifra: de «${q}» a «${n}».`, antes: q, despues: n });
	}
	for (const f of c.quitadas.slice(pares)) avisos.push({ tipo: "cifra", mensaje: `Se ha quitado una cifra: «${f.original}».`, antes: f.original });
	for (const f of c.nuevas.slice(pares)) avisos.push({ tipo: "cifra", mensaje: `Hay una cifra nueva: «${f.original}».`, despues: f.original });

	const p = diferencia(palabrasClave(antes), palabrasClave(despues));
	const motivo = (w: string) => (NEGADORES.has(w) ? "puede invertir el sentido" : "puede cambiar el alcance");
	const vistas = new Set<string>();
	for (const f of p.quitadas) {
		if (vistas.has(`-${f.canon}`)) continue;
		vistas.add(`-${f.canon}`);
		avisos.push({ tipo: "negacion", mensaje: `Se ha quitado «${f.canon}»: ${motivo(f.canon)}.`, antes: f.canon });
	}
	for (const f of p.nuevas) {
		if (vistas.has(`+${f.canon}`)) continue;
		vistas.add(`+${f.canon}`);
		avisos.push({ tipo: "negacion", mensaje: `Se ha añadido «${f.canon}»: ${motivo(f.canon)}.`, despues: f.canon });
	}

	const terminos = [...new Set(extra.map((t) => t.trim()).filter(Boolean))];
	for (const t of terminos) {
		const a = contar(antes, t);
		const d = contar(despues, t);
		if (a === d) continue;
		const mensaje =
			a === 0 ? `Se ha añadido el término sensible «${t}».` : d === 0 ? `Se ha quitado el término sensible «${t}».` : `Cambian las menciones de «${t}» (de ${a} a ${d}).`;
		avisos.push({ tipo: "farmaco", mensaje, ...(a > 0 ? { antes: t } : {}), ...(d > 0 ? { despues: t } : {}) });
	}
	return avisos;
}
