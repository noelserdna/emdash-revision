import { describe, expect, it } from "vitest";
import { cifrasDe, detectarSensibles } from "../src/lib/sensibles.js";

const tipos = (a: Array<{ tipo: string }>) => a.map((x) => x.tipo);

describe("cifras", () => {
	it("coma decimal, punto de millar, porcentajes, unidades y rangos", () => {
		expect(cifrasDe("Entre 1.000 y 58,40 mujeres; el 60 % y el 12%; 2 mg, 50 µg, 400 UI; 51-52 años [3][4-6].").map((c) => c.original)).toEqual([
			"1.000",
			"58,40",
			"60 %",
			"12%",
			"2 mg",
			"50 µg",
			"400 UI",
			"51-52 años",
		]);
	});

	it("cambio de cifra con mensaje listo", () => {
		const a = detectarSensibles("El 60 % de las mujeres.", "El 58,40 % de las mujeres.");
		expect(a).toEqual([{ tipo: "cifra", mensaje: "Ha cambiado una cifra: de «60 %» a «58,40 %».", antes: "60 %", despues: "58,40 %" }]);
	});

	it("cambio de unidad (mg → µg) y cifra quitada o nueva", () => {
		expect(tipos(detectarSensibles("2 mg al día", "2 µg al día"))).toEqual(["cifra"]);
		expect(detectarSensibles("Con 2 mg y 1.000 UI.", "Con 2 mg.")[0]?.mensaje).toBe("Se ha quitado una cifra: «1.000 UI».");
		expect(detectarSensibles("Con 2 mg.", "Con 2 mg y 10 µg.")[0]?.mensaje).toBe("Hay una cifra nueva: «10 µg».");
	});

	it("espacio fino entre cifra y unidad no cuenta como cambio", () => {
		expect(detectarSensibles("el 60 % de", "el 60 % de")).toEqual([]);
		expect(detectarSensibles("el 60 % de", "el 60% de")).toEqual([]);
		expect(detectarSensibles("1.000 mujeres", "1.000 mujeres")).toEqual([]);
	});

	it("reordenar o cambiar citas no da aviso de cifra", () => {
		expect(detectarSensibles("A los 50 años [1].", "[2] A los 50 años.")).toEqual([]);
	});
});

describe("negaciones y cuantificadores", () => {
	it("negación invertida", () => {
		const a = detectarSensibles("Se recomienda la terapia.", "No se recomienda la terapia.");
		expect(a).toEqual([{ tipo: "negacion", mensaje: "Se ha añadido «no»: puede invertir el sentido.", despues: "no" }]);
		expect(detectarSensibles("No se recomienda.", "Se recomienda.")[0]?.mensaje).toBe("Se ha quitado «no»: puede invertir el sentido.");
	});

	it("cuantificadores", () => {
		const a = detectarSensibles("Las mujeres tienen más sofocos antes de la menopausia.", "Todas las mujeres tienen menos sofocos después de la menopausia.");
		expect(a.map((x) => x.mensaje)).toEqual([
			"Se ha quitado «más»: puede cambiar el alcance.",
			"Se ha quitado «antes»: puede cambiar el alcance.",
			"Se ha añadido «todas»: puede cambiar el alcance.",
			"Se ha añadido «menos»: puede cambiar el alcance.",
			"Se ha añadido «después»: puede cambiar el alcance.",
		]);
		expect(tipos(detectarSensibles("nunca", "siempre"))).toEqual(["negacion", "negacion"]);
		expect(detectarSensibles("aumenta el riesgo", "reduce el riesgo").map((x) => x.antes ?? x.despues)).toEqual(["aumenta", "reduce"]);
	});

	it("reordenar sin cambiar nada → sin avisos; palabras que contienen «no» no cuentan", () => {
		expect(detectarSensibles("No siempre ocurre.", "Ocurre no siempre.")).toEqual([]);
		expect(detectarSensibles("El ginecólogo.", "La noche y el nombre.")).toEqual([]);
	});
});

describe("términos extra (fármacos)", () => {
	const extra = ["estradiol", "fezolinetant", "  ", "Progesterona micronizada"];
	it("añadido, quitado y cambio de menciones, sin distinguir mayúsculas ni tildes", () => {
		expect(detectarSensibles("Con gel.", "Con estradiol en gel.", extra)).toEqual([{ tipo: "farmaco", mensaje: "Se ha añadido el término sensible «estradiol».", despues: "estradiol" }]);
		expect(detectarSensibles("Fezolinetant y algo.", "Algo.", extra)[0]?.mensaje).toBe("Se ha quitado el término sensible «fezolinetant».");
		expect(detectarSensibles("estradiol, Estradiol", "estradiol", extra)[0]?.mensaje).toBe("Cambian las menciones de «estradiol» (de 2 a 1).");
		expect(tipos(detectarSensibles("x", "progesterona micronizada", extra))).toEqual(["farmaco"]);
		expect(detectarSensibles("estradiolato", "x", extra)).toEqual([]);
		expect(detectarSensibles("Estradiol", "estradiol", extra)).toEqual([]);
	});
});
