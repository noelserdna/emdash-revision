import { describe, expect, it } from "vitest";

import { reescribirSpans } from "../src/lib/ops.js";
import type { PTSpan } from "../src/lib/types.js";

let n = 0;
const clave = () => `k${++n}`;
const sp = (text: string, marks: string[] = []): PTSpan => ({ _type: "span", _key: clave(), text, marks });
const texto = (s: PTSpan[]) => s.map((x) => x.text).join("");
const marcado = (s: PTSpan[], m: string) => s.filter((x) => (x.marks ?? []).includes(m)).map((x) => x.text).join("");

describe("reescribirSpans", () => {
	const base = () => [sp("Deja de tomarlo y "), sp("consulta ese mismo día", ["strong"]), sp(" con tu "), sp("médico", ["enlace1"]), sp(".")];

	it("conserva negritas y enlaces de lo que no se toca", () => {
		const nuevo = "Suspende la medicación y consulta ese mismo día con tu médico.";
		const out = reescribirSpans(base(), nuevo, clave);
		expect(texto(out)).toBe(nuevo);
		expect(marcado(out, "strong")).toBe("consulta ese mismo día");
		expect(marcado(out, "enlace1")).toBe("médico");
	});

	it("lo que se cambia dentro de una negrita sigue en negrita", () => {
		const nuevo = "Deja de tomarlo y consulta lo antes posible con tu médico.";
		const out = reescribirSpans(base(), nuevo, clave);
		expect(texto(out)).toBe(nuevo);
		expect(marcado(out, "strong")).toBe("consulta lo antes posible");
		expect(marcado(out, "enlace1")).toBe("médico");
	});

	it("admite añadir al final, borrar al principio y reescribirlo entero", () => {
		for (const nuevo of ["Deja de tomarlo y consulta ese mismo día con tu médico. Y avisa.", "consulta ese mismo día con tu médico.", "Otra frase completamente distinta", "x"]) {
			expect(texto(reescribirSpans(base(), nuevo, clave))).toBe(nuevo);
		}
	});

	it("no deja spans vacíos ni claves repetidas", () => {
		const out = reescribirSpans(base(), "Consulta con tu médico.", clave);
		expect(out.every((s) => s.text.length > 0)).toBe(true);
		expect(new Set(out.map((s) => s._key)).size).toBe(out.length);
	});
});
