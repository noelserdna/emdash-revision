import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crearAncla } from "../src/lib/anclas.js";
import { textoDeBloque } from "../src/lib/bloques.js";
import { aplicarOps, deshacerCambio, hashDoc, sustituirFragmento, type ContextoOps } from "../src/lib/ops.js";
import type { Ancla, DocRevisable, PTBlock, PTImage, PTSpan, PTTable } from "../src/lib/types.js";

let n = 0;
const clave = () => `n${++n}`;
const span = (text: string, marks: string[] = [], _key = clave()): PTSpan => ({ _type: "span", _key, text, marks });

function base(): DocRevisable {
	return {
		titulo: "Terapia hormonal de la menopausia",
		extracto: "Qué es, para quién y con qué riesgos.",
		referencias: "1. NICE NG23.\n2. AEEM 2024.\n3. Ministerio de Sanidad.",
		content: [
			{ _type: "block", _key: "h", style: "h2", children: [span("¿Qué es?")], markDefs: [] },
			{
				_type: "block",
				_key: "p1",
				style: "normal",
				children: [span("Se recomienda "), span("estradiol en parche", ["strong"], "sb"), span(" a dosis de 50 µg "), span("según la guía", ["lk"]), span(" [1].")],
				markDefs: [{ _type: "link", _key: "lk", href: "/articulos/guia" }],
			},
			{ _type: "image", _key: "img", alt: "Isabel", caption: "Figura 1. Parche." } as PTImage,
			{ _type: "block", _key: "p2", style: "normal", children: [span("El 60 % de las mujeres tiene sofocos [2].")], markDefs: [] },
			{
				_type: "table",
				_key: "t",
				hasHeaderRow: true,
				rows: [
					{ _type: "tableRow", _key: "r0", cells: [{ _type: "tableCell", _key: "c0", content: [span("Vía")], isHeader: true }] },
					{ _type: "tableRow", _key: "r1", cells: [{ _type: "tableCell", _key: "c1", content: [span("Parche de "), span("50 µg", ["strong"])] }] },
				],
			} as PTTable,
			{ _type: "callout", _key: "x", texto: "desconocido" },
		],
	};
}

const comentario = (id: string, ancla: Partial<Ancla> | null) => ({ id, ancla: ancla ? ({ cita: "", campo: "content", ...ancla } as Ancla) : null });
const ctx = (extra: Partial<ContextoOps> = {}): ContextoOps => ({
	comentarios: [comentario("c-p1", { blockKey: "p1" }), comentario("c-p2", { blockKey: "p2" }), comentario("c-gen", null), comentario("c-img", { blockKey: "img" }), comentario("c-tit", { campo: "title" })],
	nuevaClave: clave,
	...extra,
});
const tipos = (avisos: Array<{ tipo: string }>) => avisos.map((a) => a.tipo).sort();

describe("aplicarOps", () => {
	it("rechaza claves desconocidas, bloques no editables y markdown vacío", () => {
		const doc = base();
		const r = aplicarOps(
			doc,
			[
				{ op: "reemplazar", blockKey: "zz", markdown: "x", comentarioIds: [] },
				{ op: "reemplazar", blockKey: "img", markdown: "x", comentarioIds: ["c-img"] },
				{ op: "reemplazar", blockKey: "x", markdown: "x", comentarioIds: [] },
				{ op: "reemplazar", blockKey: "p1", markdown: "   \n ", comentarioIds: ["c-p1"] },
				{ op: "insertar_tras", blockKey: "zz", markdown: "x", comentarioIds: [] },
				{ op: "insertar_tras", blockKey: "p1", markdown: "", comentarioIds: [] },
				{ op: "eliminar", blockKey: "zz", comentarioIds: [] },
				{ op: "eliminar", blockKey: "img", comentarioIds: ["c-gen"] },
				{ op: "eliminar", blockKey: "x", comentarioIds: ["c-gen"] },
				{ op: "campo", campo: "title", texto: " ", comentarioIds: [] },
				{ op: "otra" } as never,
			],
			ctx(),
		);
		expect(r.cambios).toHaveLength(0);
		expect(r.rechazadas).toHaveLength(11);
		expect(r.rechazadas.every((x) => typeof x.motivo === "string" && x.motivo.length > 10)).toBe(true);
		expect(r.rechazadas[0]?.motivo).toContain("No existe el bloque «zz»");
		expect(r.doc).toBe(doc);
	});

	it("reemplazo: conserva la _key, deja los demás bloques idénticos y no avisa si se pidió", () => {
		const doc = base();
		const r = aplicarOps(doc, [{ op: "reemplazar", blockKey: "p2", markdown: "El 60 % de las mujeres tiene **sofocos** [2].", comentarioIds: ["c-p2"] }], ctx());
		expect(r.rechazadas).toEqual([]);
		expect(r.cambios).toHaveLength(1);
		const c = r.cambios[0];
		expect(c).toMatchObject({ op: "reemplazar", campo: "content", blockKey: "p2", trasKey: "img", orden: 0, comentarioIds: ["c-p2"], avisos: [] });
		expect(r.doc.content[3]?._key).toBe("p2");
		expect(c?.antes).toBe(doc.content[3]);
		doc.content.forEach((b, i) => {
			if (b._key !== "p2") expect(r.doc.content[i]).toBe(b);
		});
		expect(JSON.stringify(r.doc.content[1])).toBe(JSON.stringify(doc.content[1]));
	});

	it("reemplazo idéntico no produce cambio", () => {
		const doc = base();
		const r = aplicarOps(doc, [{ op: "reemplazar", blockKey: "p2", markdown: "El 60 % de las mujeres tiene sofocos [2].", comentarioIds: ["c-p2"] }], ctx());
		expect(r.cambios).toEqual([]);
		expect(r.doc).toBe(doc);
	});

	it("reemplazo que produce varios bloques: el primero reemplaza y el resto se inserta detrás", () => {
		const doc = base();
		const r = aplicarOps(doc, [{ op: "reemplazar", blockKey: "p2", markdown: "Primero.\n\n## Segundo\n\n- tercero", comentarioIds: ["c-p2"] }], ctx());
		expect(r.cambios.map((c) => [c.op, c.orden])).toEqual([
			["reemplazar", 0],
			["insertar", 1],
			["insertar", 2],
		]);
		const keys = r.doc.content.map((b) => b._key);
		const i = keys.indexOf("p2");
		expect(r.cambios[1]).toMatchObject({ trasKey: "p2", blockKey: keys[i + 1] });
		expect(r.cambios[2]).toMatchObject({ trasKey: keys[i + 1], blockKey: keys[i + 2] });
		expect(textoDeBloque(r.doc.content[i + 2] as PTBlock)).toBe("tercero");
		expect(r.cambios.every((c) => !c.avisos.some((a) => a.tipo === "no_pedido"))).toBe(true);
	});

	it("aviso no_pedido; no con comentario general ni en reescritura completa", () => {
		const doc = base();
		const op = { op: "reemplazar" as const, blockKey: "p2", markdown: "Muchas mujeres tienen sofocos [2]. El 60 % de las mujeres.", comentarioIds: ["c-p1"] };
		expect(tipos(aplicarOps(doc, [op], ctx()).cambios[0]?.avisos ?? [])).toContain("no_pedido");
		expect(tipos(aplicarOps(doc, [{ ...op, comentarioIds: ["inexistente"] }], ctx()).cambios[0]?.avisos ?? [])).toContain("no_pedido");
		expect(tipos(aplicarOps(doc, [{ ...op, comentarioIds: ["c-gen"] }], ctx()).cambios[0]?.avisos ?? [])).not.toContain("no_pedido");
		expect(tipos(aplicarOps(doc, [op], ctx({ completa: true })).cambios[0]?.avisos ?? [])).not.toContain("no_pedido");
	});

	it("avisos cita_nueva, enlace_nuevo y sensibles", () => {
		const doc = base();
		const r = aplicarOps(
			doc,
			[
				{
					op: "reemplazar",
					blockKey: "p2",
					markdown: "No el 58,40 % de las mujeres tiene sofocos con estradiol [2][7]. Ver [la guía](/articulos/guia) y [otra](https://ejemplo.es).",
					comentarioIds: ["c-p2"],
				},
			],
			ctx({ terminosSensibles: ["estradiol"] }),
		);
		const avisos = r.cambios[0]?.avisos ?? [];
		expect(tipos(avisos)).toEqual(["cifra", "cita_nueva", "enlace_nuevo", "farmaco", "negacion"]);
		expect(avisos.find((a) => a.tipo === "cita_nueva")?.mensaje).toContain("[7]");
		expect(avisos.find((a) => a.tipo === "enlace_nuevo")?.despues).toBe("https://ejemplo.es");
		expect(avisos.find((a) => a.tipo === "cifra")?.mensaje).toBe("Ha cambiado una cifra: de «60 %» a «58,40 %».");
	});

	it("insertar_tras, eliminar y campo", () => {
		const doc = base();
		const r = aplicarOps(
			doc,
			[
				{ op: "insertar_tras", blockKey: "h", markdown: "Nuevo párrafo con 3 mg.", comentarioIds: ["c-gen"] },
				{ op: "eliminar", blockKey: "img", comentarioIds: ["c-img"] },
				{ op: "eliminar", blockKey: "p2", comentarioIds: ["c-p2"] },
				{ op: "campo", campo: "title", texto: "Terapia hormonal (THM)", comentarioIds: ["c-tit"] },
				{ op: "campo", campo: "excerpt", texto: "Otro extracto.", comentarioIds: ["c-p1"] },
			],
			ctx(),
		);
		expect(r.rechazadas).toEqual([]);
		expect(r.cambios.map((c) => c.op)).toEqual(["insertar", "eliminar", "eliminar", "campo", "campo"]);
		expect(r.cambios[0]).toMatchObject({ trasKey: "h", antes: null });
		expect(tipos(r.cambios[0]?.avisos ?? [])).toEqual(["cifra"]);
		expect(r.cambios[1]).toMatchObject({ blockKey: "img", trasKey: "p1" });
		expect(r.cambios[2]).toMatchObject({ blockKey: "p2", trasKey: "p1" });
		expect(r.cambios[3]).toMatchObject({ campo: "title", antes: doc.titulo, despues: "Terapia hormonal (THM)", avisos: [] });
		expect(tipos(r.cambios[4]?.avisos ?? [])).toEqual(["no_pedido"]);
		expect(r.doc.titulo).toBe("Terapia hormonal (THM)");
		expect(r.doc.content.map((b) => b._key)).toEqual(["h", r.cambios[0]?.blockKey, "p1", "t", "x"]);
		expect(doc.content).toHaveLength(6);
	});

	it("reemplazar una tabla", () => {
		const doc = base();
		const r = aplicarOps(doc, [{ op: "reemplazar", blockKey: "t", markdown: "| Vía |\n| --- |\n| Parche de **25 µg** |", comentarioIds: [] }], ctx());
		expect(r.cambios[0]?.avisos.map((a) => a.mensaje)).toContain("Ha cambiado una cifra: de «50 µg» a «25 µg».");
		expect((r.doc.content[4] as PTTable).rows[1]?.cells[0]?.content.map((s) => s.text).join("")).toBe("Parche de 25 µg");
	});
});

describe("sustituirFragmento", () => {
	const doc = base();
	const t1 = textoDeBloque(doc.content[1] as PTBlock);

	it("fragmento dentro de una negrita: la sustitución sigue en negrita", () => {
		const i = t1.indexOf("parche");
		const a = crearAncla(doc, { campo: "content", blockKey: "p1", inicio: i, fin: i + 6 }) as Ancla;
		const r = sustituirFragmento(doc, a, "gel", { nuevaClave: clave });
		const b = r?.doc.content[1] as PTBlock;
		expect(textoDeBloque(b)).toBe(t1.replace("parche", "gel"));
		expect(b.children.find((s) => s.marks?.includes("strong"))).toMatchObject({ _key: "sb", text: "estradiol en gel" });
		expect(b.markDefs).toBe((doc.content[1] as PTBlock).markDefs);
		expect(r?.cambios[0]).toMatchObject({ op: "reemplazar", blockKey: "p1", antes: doc.content[1], despues: b });
		expect(r?.doc.content[0]).toBe(doc.content[0]);
	});

	it("fragmento que cruza dos spans: marcas comunes y el resto intacto", () => {
		const i = t1.indexOf("parche");
		const f = t1.indexOf("50") + 2;
		const a = crearAncla(doc, { campo: "content", blockKey: "p1", inicio: i, fin: f }) as Ancla;
		const r = sustituirFragmento(doc, a, "gel a 25", { nuevaClave: clave });
		const b = r?.doc.content[1] as PTBlock;
		expect(textoDeBloque(b)).toBe("Se recomienda estradiol en gel a 25 µg según la guía [1].");
		expect(b.children.map((s) => [s.text, s.marks])).toEqual([
			["Se recomienda ", []],
			["estradiol en ", ["strong"]],
			["gel a 25 µg ", []],
			["según la guía", ["lk"]],
			[" [1].", []],
		]);
		expect(new Set(b.children.map((s) => s._key)).size).toBe(b.children.length);
		expect(tipos(r?.cambios[0]?.avisos ?? [])).toEqual(["cifra"]);
	});

	it("celda, pie de imagen, título y referencia", () => {
		const celda = crearAncla(doc, { campo: "content", blockKey: "t", ruta: "r1/c1", inicio: 10, fin: 12 }) as Ancla;
		const r1 = sustituirFragmento(doc, celda, "25", { nuevaClave: clave });
		const c = (r1?.doc.content[4] as PTTable).rows[1]?.cells[0];
		expect(c?.content.map((s) => [s.text, s.marks])).toEqual([
			["Parche de ", []],
			["25 µg", ["strong"]],
		]);
		const pie = crearAncla(doc, { campo: "content", blockKey: "img", ruta: "caption", inicio: 10, fin: 16 }) as Ancla;
		expect((sustituirFragmento(doc, pie, "Gel")?.doc.content[2] as PTImage).caption).toBe("Figura 1. Gel.");
		const tit = crearAncla(doc, { campo: "title", inicio: 0, fin: 7 }) as Ancla;
		const r2 = sustituirFragmento(doc, tit, "Tratamiento");
		expect(r2?.doc.titulo).toBe("Tratamiento hormonal de la menopausia");
		expect(r2?.cambios[0]).toMatchObject({ op: "campo", campo: "title", antes: doc.titulo });
		const ref = crearAncla(doc, { campo: "references", ruta: "2", inicio: 5, fin: 9 }) as Ancla;
		expect(sustituirFragmento(doc, ref, "2025")?.doc.referencias).toBe("1. NICE NG23.\n2. AEEM 2025.\n3. Ministerio de Sanidad.");
	});

	it("ancla huérfana → null", () => {
		const a = crearAncla(doc, { campo: "content", blockKey: "p2", inicio: 3, fin: 7 }) as Ancla;
		const sinBloque = { ...doc, content: doc.content.filter((b) => b._key !== "p2") };
		expect(sustituirFragmento(sinBloque, a, "x")).toBeNull();
		expect(sustituirFragmento(doc, { campo: "content", blockKey: "x", cita: "" }, "y")).toBeNull();
	});
});

describe("deshacerCambio", () => {
	const doc = base();
	const r = aplicarOps(
		doc,
		[
			{ op: "reemplazar", blockKey: "p2", markdown: "Otro texto.", comentarioIds: ["c-p2"] },
			{ op: "insertar_tras", blockKey: "h", markdown: "Insertado.", comentarioIds: ["c-gen"] },
			{ op: "eliminar", blockKey: "p1", comentarioIds: ["c-p1"] },
			{ op: "campo", campo: "excerpt", texto: "Nuevo extracto.", comentarioIds: ["c-gen"] },
		],
		ctx(),
	);
	const [reemplazo, insercion, eliminacion, campo] = r.cambios;

	it("los cuatro tipos vuelven al estado anterior", () => {
		let d: DocRevisable | null = r.doc;
		for (const c of [campo, eliminacion, insercion, reemplazo]) {
			d = deshacerCambio(d as DocRevisable, c as NonNullable<typeof c>);
			expect(d).not.toBeNull();
		}
		expect(d).toEqual(doc);
	});

	it("deshacer una eliminación cuyo bloque anterior ya no existe, o al principio", () => {
		const sinH = { ...r.doc, content: r.doc.content.filter((b) => b._key !== "h" && b._key !== insercion?.blockKey) };
		expect(deshacerCambio(sinH, eliminacion as NonNullable<typeof eliminacion>)).toBeNull();
		const alPrincipio = deshacerCambio(r.doc, { ...(eliminacion as NonNullable<typeof eliminacion>), trasKey: null });
		expect(alPrincipio?.content[0]?._key).toBe("p1");
	});

	it("null si ya no es aplicable", () => {
		expect(deshacerCambio(doc, reemplazo as NonNullable<typeof reemplazo>)).toBeNull();
		expect(deshacerCambio(doc, insercion as NonNullable<typeof insercion>)).toBeNull();
		expect(deshacerCambio(doc, eliminacion as NonNullable<typeof eliminacion>)).toBeNull();
		expect(deshacerCambio(doc, campo as NonNullable<typeof campo>)).toBeNull();
	});
});

describe("hashDoc", () => {
	const doc = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "31-fezolinetant-veoza.json"), "utf8")) as DocRevisable;

	it("estable ante cambios de _key (incluidas las de markDefs)", async () => {
		const h = await hashDoc(doc);
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		const otro = JSON.parse(JSON.stringify(doc).replace(/"k0([0-9a-z]{4})"/g, '"z9$1"')) as DocRevisable;
		expect(JSON.stringify(otro)).not.toBe(JSON.stringify(doc));
		expect(await hashDoc(otro)).toBe(h);
		expect(await hashDoc({ ...doc })).toBe(h);
	});

	it("distinto ante cambios de texto, de marcas o de referencias", async () => {
		const h = await hashDoc(doc);
		const copia = structuredClone(doc);
		const b = copia.content.find((x) => x._type === "block") as PTBlock;
		(b.children[0] as PTSpan).text += ".";
		expect(await hashDoc(copia)).not.toBe(h);
		const copia2 = structuredClone(doc);
		const b2 = copia2.content.find((x) => x._type === "block") as PTBlock;
		(b2.children[0] as PTSpan).marks = ["em"];
		expect(await hashDoc(copia2)).not.toBe(h);
		expect(await hashDoc({ ...doc, referencias: `${doc.referencias}\n99. Nueva.` })).not.toBe(h);
	});
});
