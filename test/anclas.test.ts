import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anclaDeFragmento, crearAncla, normalizar, resolverAncla } from "../src/lib/anclas.js";
import { textoDeUnidad } from "../src/lib/bloques.js";
import type { DocRevisable, PTBlock, PTImage, PTNode, PTSpan, PTTable } from "../src/lib/types.js";

const span = (text: string, marks: string[] = [], _key = `s${Math.random().toString(36).slice(2, 8)}`): PTSpan => ({ _type: "span", _key, text, marks });
const blk = (_key: string, ...children: PTSpan[]): PTBlock => ({ _type: "block", _key, style: "normal", children, markDefs: [] });

function base(): DocRevisable {
	const tabla: PTTable = {
		_type: "table",
		_key: "t1",
		hasHeaderRow: true,
		rows: [
			{ _type: "tableRow", _key: "r0", cells: [{ _type: "tableCell", _key: "c0", content: [span("Fármaco")], isHeader: true }, { _type: "tableCell", _key: "c1", content: [span("Dosis")], isHeader: true }] },
			{ _type: "tableRow", _key: "r1", cells: [{ _type: "tableCell", _key: "c2", content: [span("Estradiol")] }, { _type: "tableCell", _key: "c3", content: [span("50 µg al día")] }] },
		],
	};
	const img: PTImage = { _type: "image", _key: "i1", alt: "Isabel explica algo a tres amigas.", caption: "Figura 1. Las etapas son tramos de distinta duración." };
	return {
		titulo: "Qué es la menopausia: guía completa",
		extracto: "La menopausia es una fecha: la de tu última regla.",
		referencias: "1. Ministerio de Sanidad. La menopausia.\n2. AEEM. Guía de práctica clínica.\n3. NICE NG23. Menopause.",
		content: [
			blk("b1", span("La menopausia es "), span("una fecha", ["strong"]), span(": la de tu última regla, que solo se confirma doce meses después.")),
			blk("b2", span("Los sofocos duran años. Los sofocos no siempre desaparecen con la última regla.")),
			tabla,
			img,
			blk("b3", span("Para el Ministerio, “no es una enfermedad ni un trastorno” [1].")),
			blk("b4", span("Texto repetido aquí. Texto repetido aquí.")),
		],
	};
}

const conBloque = (doc: DocRevisable, key: string, nuevo: PTNode): DocRevisable => ({ ...doc, content: doc.content.map((n) => (n._key === key ? nuevo : n)) });

describe("normalizar", () => {
	it("colapsa espacios finos, unifica comillas y guiones, y mapea índices", () => {
		const t = "«No es»  una — “enfermedad” %";
		const n = normalizar(t);
		expect(n.texto).toBe('"No es" una - "enfermedad" %');
		expect(n.mapa).toHaveLength(n.texto.length + 1);
		expect(n.mapa[n.mapa.length - 1]).toBe(t.length);
		const i = n.texto.indexOf("una");
		expect(t.slice(n.mapa[i], (n.mapa[i] ?? 0) + 3)).toBe("una");
	});
	it("NFKC y puntos suspensivos", () => {
		expect(normalizar("ﬁn…").texto).toBe("fin...");
		expect(normalizar("é").texto).toBe("é");
	});
});

describe("crearAncla", () => {
	it("fragmento con cita, prefijo y sufijo", () => {
		const doc = base();
		const a = crearAncla(doc, { campo: "content", blockKey: "b1", inicio: 17, fin: 26 }, "rev1");
		expect(a).toMatchObject({ campo: "content", blockKey: "b1", inicio: 17, fin: 26, cita: "una fecha", prefijo: "La menopausia es ", baseRevisionId: "rev1" });
		expect(a?.sufijo).toBe(": la de tu última regla, que sol");
	});
	it("unidad entera, offsets inválidos y unidad inexistente", () => {
		const doc = base();
		const a = crearAncla(doc, { campo: "content", blockKey: "b2" });
		expect(a?.inicio).toBeUndefined();
		expect(a?.cita).toBe(textoDeUnidad(doc, { campo: "content", blockKey: "b2" }));
		expect(crearAncla(doc, { campo: "content", blockKey: "b2", inicio: 5, fin: 5 })).toBeNull();
		expect(crearAncla(doc, { campo: "content", blockKey: "b2", inicio: 0, fin: 999 })).toBeNull();
		expect(crearAncla(doc, { campo: "content", blockKey: "zz" })).toBeNull();
		expect(crearAncla(doc, { campo: "content" })).toBeNull();
	});
});

describe("anclaDeFragmento", () => {
	it("encuentra el fragmento con comillas y espacios distintos", () => {
		const doc = base();
		const a = anclaDeFragmento(doc, { campo: "content", blockKey: "b3" }, '"no es una enfermedad');
		expect(a?.cita).toBe("“no es una enfermedad");
		expect(a?.inicio).toBe("Para el Ministerio, ".length);
	});
	it("ambiguo o ausente → null", () => {
		const doc = base();
		expect(anclaDeFragmento(doc, { campo: "content", blockKey: "b4" }, "Texto repetido")).toBeNull();
		expect(anclaDeFragmento(doc, { campo: "content", blockKey: "b4" }, "no está")).toBeNull();
		expect(anclaDeFragmento(doc, { campo: "content", blockKey: "b4" }, "  ")).toBeNull();
	});
	it("en todo el campo content (sin blockKey) y en referencias", () => {
		const doc = base();
		const a = anclaDeFragmento(doc, { campo: "content" }, "50 µg");
		expect(a).toMatchObject({ blockKey: "t1", ruta: "r1/c3", inicio: 0, fin: 5 });
		const r = anclaDeFragmento(doc, { campo: "references" }, "NICE NG23");
		expect(r).toMatchObject({ campo: "references", ruta: "3", inicio: 0 });
		expect(anclaDeFragmento(doc, { campo: "content" }, "sofocos")).toBeNull(); // dos veces en b2
	});
});

describe("resolverAncla", () => {
	const doc = base();
	const ancla = crearAncla(doc, { campo: "content", blockKey: "b1", inicio: 17, fin: 26 });
	if (!ancla) throw new Error("sin ancla");

	it("sin cambios → exacta", () => {
		expect(resolverAncla(doc, ancla).estado).toBe("exacta");
	});

	it("edición antes del fragmento → recolocada con nuevos offsets", () => {
		const d = conBloque(doc, "b1", blk("b1", span("Dicho de forma sencilla, la menopausia es "), span("una fecha", ["strong"]), span(": la de tu última regla.")));
		const r = resolverAncla(d, ancla);
		expect(r.estado).toBe("recolocada");
		expect(r.ancla.inicio).toBe(42);
		expect(textoDeUnidad(d, r.ancla)?.slice(r.ancla.inicio, r.ancla.fin)).toBe("una fecha");
	});

	it("edición después del fragmento → exacta", () => {
		const d = conBloque(doc, "b1", blk("b1", span("La menopausia es "), span("una fecha", ["strong"]), span(" y nada más.")));
		expect(resolverAncla(d, ancla).estado).toBe("exacta");
	});

	it("edición dentro del fragmento → huérfana", () => {
		const d = conBloque(doc, "b1", blk("b1", span("La menopausia es "), span("un día", ["strong"]), span(": la de tu última regla.")));
		expect(resolverAncla(d, ancla).estado).toBe("huerfana");
	});

	it("texto repetido: el contexto desempata; si no, huérfana", () => {
		const a2 = crearAncla(doc, { campo: "content", blockKey: "b4", inicio: 21, fin: 35 });
		expect(a2?.cita).toBe("Texto repetido");
		// Se añade texto al principio: la segunda aparición se distingue por su prefijo.
		const d = conBloque(doc, "b4", blk("b4", span("Ojo. Texto repetido aquí. Texto repetido aquí.")));
		const r = resolverAncla(d, a2 as NonNullable<typeof a2>);
		expect(r.estado).toBe("recolocada");
		expect(r.ancla.inicio).toBe(26);
		// Sin contexto que desempate: huérfana.
		const sinContexto = { ...(a2 as NonNullable<typeof a2>), inicio: 0, fin: 3, prefijo: "", sufijo: "", cita: "Texto repetido" };
		const d2 = conBloque(doc, "b4", blk("b4", span("x Texto repetido y Texto repetido y")));
		expect(resolverAncla(d2, { ...sinContexto, prefijo: undefined, sufijo: undefined }).estado).toBe("huerfana");
		const d3 = conBloque(doc, "b4", blk("b4", span("ab Texto repetido cd. ab Texto repetido cd.")));
		expect(resolverAncla(d3, { ...sinContexto, prefijo: "ab ", sufijo: " cd" }).estado).toBe("huerfana");
	});

	it("comillas tipográficas y espacios finos → recolocada por búsqueda normalizada", () => {
		const t = textoDeUnidad(doc, { campo: "content", blockKey: "b3" }) ?? "";
		const a = crearAncla(doc, { campo: "content", blockKey: "b3", inicio: t.indexOf("“"), fin: t.indexOf("”") + 1 });
		expect(a?.cita).toBe("“no es una enfermedad ni un trastorno”");
		const d = conBloque(doc, "b3", blk("b3", span("Según el Ministerio,\u202F«no es\u00A0una enfermedad ni un\u202Ftrastorno» [1].")));
		const r = resolverAncla(d, a as NonNullable<typeof a>);
		expect(r.estado).toBe("recolocada");
		expect(r.ancla.cita).toBe("«no es\u00A0una enfermedad ni un\u202Ftrastorno»");
	});

	it("celdas de tabla", () => {
		const a = crearAncla(doc, { campo: "content", blockKey: "t1", ruta: "r1/c3", inicio: 0, fin: 5 });
		expect(a?.cita).toBe("50 µg");
		expect(resolverAncla(doc, a as NonNullable<typeof a>).estado).toBe("exacta");
		const t = structuredClone(doc.content[2]) as PTTable;
		const celda = t.rows[1]?.cells[1];
		if (celda) celda.content = [span("Entre 25 y 50 µg al día")];
		const r = resolverAncla(conBloque(doc, "t1", t), a as NonNullable<typeof a>);
		expect(r).toMatchObject({ estado: "recolocada", ancla: { ruta: "r1/c3", inicio: 11, fin: 16 } });
		// La celda desaparece y el texto pasa a otra: se busca en todo el campo.
		const t2 = structuredClone(doc.content[2]) as PTTable;
		if (t2.rows[1]) t2.rows[1].cells = [{ _type: "tableCell", _key: "c9", content: [span("Estradiol 50 µg")] }];
		expect(resolverAncla(conBloque(doc, "t1", t2), a as NonNullable<typeof a>)).toMatchObject({ estado: "recolocada", ancla: { ruta: "r1/c9", inicio: 10 } });
	});

	it("pie y texto alternativo de imagen", () => {
		const a = crearAncla(doc, { campo: "content", blockKey: "i1", ruta: "caption", inicio: 10, fin: 30 });
		expect(a?.cita).toBe("Las etapas son tramo");
		const d = conBloque(doc, "i1", { ...(doc.content[3] as PTImage), caption: "Figura 12. Las etapas son tramos." });
		expect(resolverAncla(d, a as NonNullable<typeof a>)).toMatchObject({ estado: "recolocada", ancla: { ruta: "caption", inicio: 11 } });
		const alt = crearAncla(doc, { campo: "content", blockKey: "i1", ruta: "alt" });
		expect(resolverAncla(doc, alt as NonNullable<typeof alt>).estado).toBe("exacta");
	});

	it("título, extracto y referencia n", () => {
		const t = crearAncla(doc, { campo: "title", inicio: 0, fin: 3 });
		expect(resolverAncla({ ...doc, titulo: "Guía: Qué es la menopausia" }, t as NonNullable<typeof t>)).toMatchObject({ estado: "recolocada", ancla: { inicio: 6 } });
		const e = crearAncla(doc, { campo: "excerpt", inicio: 21, fin: 26 });
		expect(e?.cita).toBe("fecha");
		expect(resolverAncla({ ...doc, extracto: "Es otra cosa." }, e as NonNullable<typeof e>).estado).toBe("huerfana");
		const r = crearAncla(doc, { campo: "references", ruta: "2", inicio: 6, fin: 31 });
		expect(r?.cita).toBe("Guía de práctica clínica.");
		const doc2 = { ...doc, referencias: "1. Ministerio de Sanidad. La menopausia.\n2. AEEM (2024). Guía de práctica clínica.\n3. NICE." };
		expect(resolverAncla(doc2, r as NonNullable<typeof r>)).toMatchObject({ estado: "recolocada", ancla: { ruta: "2", inicio: 13 } });
		// La referencia se renumera: se encuentra en otra línea del campo.
		const doc3 = { ...doc, referencias: "1. Otra.\n2. Ministerio.\n3. AEEM. Guía de práctica clínica." };
		expect(resolverAncla(doc3, r as NonNullable<typeof r>)).toMatchObject({ estado: "recolocada", ancla: { ruta: "3" } });
	});

	it("bloque eliminado → huérfana (también la unidad entera)", () => {
		const d = { ...doc, content: doc.content.filter((n) => n._key !== "b1") };
		expect(resolverAncla(d, ancla).estado).toBe("huerfana");
		const entera = crearAncla(doc, { campo: "content", blockKey: "b1" });
		expect(resolverAncla(d, entera as NonNullable<typeof entera>).estado).toBe("huerfana");
		expect(resolverAncla(doc, entera as NonNullable<typeof entera>).estado).toBe("exacta");
	});

	it("bloque eliminado pero su texto movido a otro bloque → recolocada", () => {
		const d = { ...doc, content: [blk("nuevo", span("La menopausia es una fecha: la de tu última regla.")), ...doc.content.filter((n) => n._key !== "b1")] };
		expect(resolverAncla(d, ancla)).toMatchObject({ estado: "recolocada", ancla: { blockKey: "nuevo", inicio: 17, fin: 26 } });
	});
});

describe("con un artículo real", () => {
	it("crear y resolver anclas en todos los párrafos", () => {
		const doc = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "01-que-es-la-menopausia.json"), "utf8")) as DocRevisable;
		let n = 0;
		for (const b of doc.content) {
			if (b._type !== "block") continue;
			const t = textoDeUnidad(doc, { campo: "content", blockKey: b._key }) ?? "";
			if (t.length < 40) continue;
			const a = crearAncla(doc, { campo: "content", blockKey: b._key, inicio: 10, fin: 30 });
			expect(resolverAncla(doc, a as NonNullable<typeof a>).estado).toBe("exacta");
			n++;
		}
		expect(n).toBeGreaterThan(20);
	});
});
