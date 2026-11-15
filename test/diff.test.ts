import { describe, expect, it } from "vitest";
import { diffPalabras, tokenizarPalabras } from "../src/lib/diff.js";
import type { SegmentoDiff } from "../src/lib/types.js";

const reconstruir = (segs: SegmentoDiff[], lado: "antes" | "despues") =>
	segs
		.filter((s) => s.tipo === "igual" || s.tipo === (lado === "antes" ? "eliminado" : "añadido"))
		.map((s) => s.texto)
		.join("");

const CASOS: Array<[string, string]> = [
	["", ""],
	["", "Texto nuevo."],
	["Texto viejo.", ""],
	["Se recomienda estradiol.", "No se recomienda estradiol."],
	["El 60 % de las mujeres.", "El 58,40 % de las mujeres."],
	["uno dos tres cuatro", "uno tres dos cuatro"],
	["La menopausia es una fecha: la de tu última regla.", "La menopausia es un día: el de la última regla, que se confirma después."],
	["«No es una enfermedad» [1].", "«No es una enfermedad ni un trastorno» [1][2]."],
	["  espacios   raros  ", " espacios raros "],
	["a b c", "x y c"],
];

describe("diffPalabras", () => {
	it("textos iguales → un solo segmento igual", () => {
		expect(diffPalabras("Hola, mundo.", "Hola, mundo.")).toEqual([{ tipo: "igual", texto: "Hola, mundo." }]);
		expect(diffPalabras("", "")).toEqual([]);
	});

	it("cambio de una palabra", () => {
		expect(diffPalabras("Los sofocos duran años.", "Los sofocos duran meses.")).toEqual([
			{ tipo: "igual", texto: "Los sofocos duran " },
			{ tipo: "eliminado", texto: "años" },
			{ tipo: "añadido", texto: "meses" },
			{ tipo: "igual", texto: "." },
		]);
	});

	it("inserción y borrado", () => {
		expect(diffPalabras("se recomienda", "no se recomienda")).toEqual([
			{ tipo: "añadido", texto: "no " },
			{ tipo: "igual", texto: "se recomienda" },
		]);
		expect(diffPalabras("muy muy largo", "muy largo")).toEqual([
			{ tipo: "igual", texto: "muy " },
			{ tipo: "eliminado", texto: "muy " },
			{ tipo: "igual", texto: "largo" },
		]);
	});

	it("un espacio entre dos cambios se funde con ellos", () => {
		expect(diffPalabras("a b c", "x y c")).toEqual([
			{ tipo: "eliminado", texto: "a b" },
			{ tipo: "añadido", texto: "x y" },
			{ tipo: "igual", texto: " c" },
		]);
	});

	it("la puntuación es un token propio", () => {
		expect(tokenizarPalabras("Hola, «mundo» 58,40 %.")).toEqual(["Hola", ",", " ", "«", "mundo", "»", " ", "58", ",", "40", " ", "%", "."]);
	});

	for (const [antes, despues] of CASOS) {
		it(`reconstruye ambos lados: ${JSON.stringify(antes)} → ${JSON.stringify(despues)}`, () => {
			const segs = diffPalabras(antes, despues);
			expect(reconstruir(segs, "antes")).toBe(antes);
			expect(reconstruir(segs, "despues")).toBe(despues);
			// sin segmentos vacíos ni dos iguales seguidos
			expect(segs.every((s) => s.texto.length > 0)).toBe(true);
			for (let i = 1; i < segs.length; i++) expect(segs[i]?.tipo === "igual" && segs[i - 1]?.tipo === "igual").toBe(false);
		});
	}

	it("textos largos (por encima del límite) siguen reconstruyendo", () => {
		const a = Array.from({ length: 3000 }, (_, i) => `p${i}`).join(" ");
		const b = Array.from({ length: 3000 }, (_, i) => `q${i}`).join(" ");
		const segs = diffPalabras(a, b);
		expect(reconstruir(segs, "antes")).toBe(a);
		expect(reconstruir(segs, "despues")).toBe(b);
	});
});
