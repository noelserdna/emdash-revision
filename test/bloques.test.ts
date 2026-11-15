import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	bloqueAMarkdown,
	bloquesParaIA,
	docAMarkdown,
	esEditable,
	markdownABloques,
	minutosDeLectura,
	normalizarClaves,
	nuevaClave,
	referenciasDe,
	textoDeBloque,
	textoDeUnidad,
	tipoDeBloque,
} from "../src/lib/bloques.js";
import type { DocRevisable, PTBlock, PTMarkDef, PTNode, PTSpan, PTTable } from "../src/lib/types.js";

const DIR = join(import.meta.dirname, "fixtures");
export const FIXTURES: Array<{ nombre: string; doc: DocRevisable }> = readdirSync(DIR)
	.filter((f) => f.endsWith(".json"))
	.sort()
	.map((f) => ({ nombre: f, doc: JSON.parse(readFileSync(join(DIR, f), "utf8")) as DocRevisable }));

let n = 0;
const clave = () => `c${++n}`;

/** Marcas por carácter, con los enlaces por su href (las claves no importan). */
function marcasPorRango(spans: PTSpan[], defs: PTMarkDef[] = []): string[] {
	const porClave = new Map(defs.map((d) => [d._key, d]));
	const out: string[] = [];
	for (const s of spans) {
		const ms = (s.marks ?? [])
			.map((m) => {
				const d = porClave.get(m);
				if (!d) return m;
				return d._type === "link" ? `link:${d.href}` : `def:${JSON.stringify({ ...d, _key: undefined })}`;
			})
			.sort()
			.join(",");
		for (let i = 0; i < s.text.length; i++) out.push(ms);
	}
	return out;
}

function forma(node: PTNode) {
	if (node._type === "table") {
		const t = node as PTTable;
		return {
			_type: "table",
			hasHeaderRow: !!t.hasHeaderRow,
			rows: t.rows.map((r) =>
				r.cells.map((c) => ({ texto: c.content.map((s) => s.text).join(""), marcas: marcasPorRango(c.content, c.markDefs), isHeader: !!c.isHeader })),
			),
		};
	}
	const b = node as PTBlock;
	return {
		_type: b._type,
		style: b.style ?? "normal",
		listItem: b.listItem ?? null,
		level: b.listItem ? (b.level ?? 1) : null,
		texto: b.children.map((s) => s.text).join(""),
		marcas: marcasPorRango(b.children, b.markDefs),
	};
}

describe("prueba dorada con artículos reales", () => {
	it("hay entre 6 y 8 fixtures con tablas, citas, listas, enlaces y negritas", () => {
		expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
		const todo = FIXTURES.flatMap((f) => f.doc.content);
		expect(todo.some((b) => b._type === "table")).toBe(true);
		expect(todo.some((b) => (b as PTBlock).style === "blockquote" && textoDeBloque(b).startsWith("• "))).toBe(true);
		expect(todo.some((b) => (b as PTBlock).listItem === "number")).toBe(true);
		expect(todo.some((b) => (b as PTBlock).listItem === "bullet")).toBe(true);
		expect(todo.some((b) => (b as PTBlock).markDefs?.some((d) => d._type === "link"))).toBe(true);
		expect(todo.some((b) => (b as PTBlock).children?.some((s) => s.marks?.includes("strong")))).toBe(true);
		expect(todo.some((b) => (b as PTBlock).children?.some((s) => s.marks?.includes("em")))).toBe(true);
	});

	for (const { nombre, doc } of FIXTURES) {
		it(`ida y vuelta de cada bloque: ${nombre}`, () => {
			let probados = 0;
			for (const b of doc.content) {
				if (b._type !== "block" && b._type !== "table") continue;
				const md = bloqueAMarkdown(b);
				const vuelta = markdownABloques(md, clave);
				expect(vuelta, md).toHaveLength(1);
				expect(forma(vuelta[0] as PTNode), md).toEqual(forma(b));
				probados++;
			}
			expect(probados).toBeGreaterThan(30);
		});
	}

	it("docAMarkdown incluye título, bloques y fuentes", () => {
		const { doc } = FIXTURES[0] as { doc: DocRevisable };
		const md = docAMarkdown(doc);
		expect(md.startsWith(`# ${doc.titulo}`)).toBe(true);
		expect(md).toContain("## Fuentes");
		expect(md).toContain("| --- |");
		expect(md).toContain("> • ");
	});
});

describe("marcas y casos límite", () => {
	const rt = (b: PTNode) => {
		const v = markdownABloques(bloqueAMarkdown(b), clave);
		expect(v).toHaveLength(1);
		expect(forma(v[0] as PTNode)).toEqual(forma(b));
		return v[0] as PTBlock;
	};
	const span = (text: string, marks: string[] = []): PTSpan => ({ _type: "span", _key: clave(), text, marks });
	const blk = (children: PTSpan[], extra: Partial<PTBlock> = {}): PTBlock => ({ _type: "block", _key: clave(), style: "normal", children, markDefs: [], ...extra });

	it("marcas solapadas, código y enlaces", () => {
		rt(blk([span("uno "), span("dos", ["strong"]), span(" tres", ["strong", "em"]), span(" cuatro", ["em"]), span(" cinco")]));
		rt(blk([span("a "), span("x*y", ["code"]), span(" b `c`")]));
		rt(
			blk([span("ver "), span("la guía", ["l1"]), span(" y ", []), span("negrita enlazada", ["strong", "l2"])], {
				markDefs: [
					{ _type: "link", _key: "l1", href: "/articulos/x" },
					{ _type: "link", _key: "l2", href: "https://e.es/a (b)" },
				],
			}),
		);
	});

	it("escapa texto que parecería Markdown", () => {
		rt(blk([span("# no es título")]));
		rt(blk([span("- no es lista")]));
		rt(blk([span("1. no es lista numerada")]));
		rt(blk([span("> no es cita")]));
		rt(blk([span("| no es tabla")]));
		rt(blk([span("a*b_c\\d [1](no enlace) <span> x</span> [2][3]")]));
		rt(blk([span("línea uno\nlínea dos")]));
	});

	it("estilos, listas anidadas y citas con viñeta", () => {
		rt(blk([span("Título")], { style: "h3" }));
		rt(blk([span("Cita "), span("fuerte", ["strong"])], { style: "blockquote" }));
		rt(blk([span("• elemento de cita")], { style: "blockquote" }));
		rt(blk([span("nivel dos")], { listItem: "bullet", level: 2 }));
		rt(blk([span("numerado")], { listItem: "number", level: 1 }));
	});

	it("marcas desconocidas se conservan como <span data-mark>", () => {
		const b = blk([span("a "), span("sub", ["underline"]), span(" b "), span("anot", ["k9"])], { markDefs: [{ _type: "comentario", _key: "k9", autor: "x" }] });
		const md = bloqueAMarkdown(b);
		expect(md).toContain('<span data-mark="underline">sub</span>');
		expect(md).toContain("data-def=");
		rt(b);
	});

	it("tabla con barras y saltos en las celdas", () => {
		const celda = (t: string, isHeader = false) => ({ _type: "tableCell" as const, _key: clave(), content: [span(t)], markDefs: [], ...(isHeader ? { isHeader } : {}) });
		const t: PTTable = {
			_type: "table",
			_key: clave(),
			hasHeaderRow: true,
			rows: [
				{ _type: "tableRow", _key: clave(), cells: [celda("A", true), celda("B|C", true)] },
				{ _type: "tableRow", _key: clave(), cells: [celda("1\n2"), celda("")] },
			],
		};
		const v = markdownABloques(bloqueAMarkdown(t), clave);
		expect(v).toHaveLength(1);
		expect(forma(v[0] as PTNode)).toEqual(forma(t));
	});

	it("varios bloques e imágenes ignoradas", () => {
		const v = markdownABloques("## Título\n\nPárrafo *en* dos\nlíneas.\n\n- uno\n- dos\n  sigue\n\n![x](y.jpg)\n*pie*\n\n<!-- bloque:image -->\n\n> cita", clave);
		expect(v.map((b) => [tipoDeBloque(b), textoDeBloque(b)])).toEqual([
			["titulo", "Título"],
			["parrafo", "Párrafo en dos líneas."],
			["lista", "uno"],
			["lista", "dos sigue"],
			["cita", "cita"],
		]);
	});

	it("Markdown suelto de la IA: _cursiva_, asteriscos sin pareja", () => {
		const [b] = markdownABloques("Un _dato_ y 3 * 4 = 12", clave) as PTBlock[];
		expect(textoDeBloque(b as PTNode)).toBe("Un dato y 3 * 4 = 12");
		expect((b as PTBlock).children.find((s) => s.text === "dato")?.marks).toEqual(["em"]);
		const [c] = markdownABloques("snake_case_name", clave);
		expect(textoDeBloque(c as PTNode)).toBe("snake_case_name");
	});
});

describe("utilidades", () => {
	const doc = FIXTURES[0]?.doc as DocRevisable;

	it("referenciasDe", () => {
		const r = referenciasDe("1. Maki PM. Algo.\n2. Otra\nbasura\n10. Diez");
		expect(r).toEqual([
			{ numero: "1", texto: "Maki PM. Algo." },
			{ numero: "2", texto: "Otra" },
			{ numero: "10", texto: "Diez" },
		]);
		expect(referenciasDe(doc.referencias).length).toBeGreaterThan(5);
	});

	it("textoDeUnidad para cada campo y ruta", () => {
		const tabla = doc.content.find((b) => b._type === "table") as PTTable;
		const fila = tabla.rows[1];
		const celda = fila?.cells[0];
		expect(textoDeUnidad(doc, { campo: "content", blockKey: tabla._key, ruta: `${fila?._key}/${celda?._key}` })).toBe(celda?.content.map((s) => s.text).join(""));
		expect(textoDeUnidad(doc, { campo: "content", blockKey: tabla._key, ruta: "x/y" })).toBeNull();
		const img = doc.content.find((b) => b._type === "image");
		expect(textoDeUnidad(doc, { campo: "content", blockKey: img?._key, ruta: "caption" })).toMatch(/^Figura/);
		expect(textoDeUnidad(doc, { campo: "title" })).toBe(doc.titulo);
		expect(textoDeUnidad(doc, { campo: "references", ruta: "1" })).toBe(referenciasDe(doc.referencias)[0]?.texto);
		expect(textoDeUnidad(doc, { campo: "content", blockKey: "no-existe" })).toBeNull();
	});

	it("tipos y editabilidad", () => {
		const tipos = new Set(doc.content.map(tipoDeBloque));
		expect(tipos).toEqual(new Set(["parrafo", "titulo", "lista", "cita", "tabla", "imagen"]));
		expect(doc.content.filter((b) => b._type === "image").every((b) => !esEditable(b))).toBe(true);
		expect(doc.content.filter((b) => b._type !== "image").every(esEditable)).toBe(true);
		expect(esEditable({ _type: "block", _key: "x", style: "lead", children: [] } as PTBlock)).toBe(false);
		expect(esEditable({ _type: "codigo", _key: "x" })).toBe(false);
		const ia = bloquesParaIA(doc.content);
		expect(ia[0]).toMatchObject({ key: doc.content[0]?._key, editable: true });
		expect(ia.find((b) => b.tipo === "imagen")?.markdown).toMatch(/^!\[.*\]\(.*\)\n\*Figura/);
	});

	it("nuevaClave y normalizarClaves", () => {
		expect(nuevaClave()).toMatch(/^[a-z0-9]{12}$/);
		const igual = normalizarClaves(doc.content);
		expect(igual.cambiado).toBe(false);
		expect(igual.content).toBe(doc.content);
		const roto = [
			{ _type: "block", _key: "a", children: [{ _type: "span", text: "x" }, { _type: "span", _key: "s", text: "y" }, { _type: "span", _key: "s", text: "z" }] },
			{ _type: "block", _key: "a", children: [] },
			doc.content[5] as PTNode,
		] as PTNode[];
		const r = normalizarClaves(roto, clave);
		expect(r.cambiado).toBe(true);
		expect(r.content[2]).toBe(roto[2]);
		const b0 = r.content[0] as PTBlock;
		expect(new Set(b0.children.map((s) => s._key)).size).toBe(3);
		expect(r.content[1]?._key).not.toBe("a");
	});

	it("minutosDeLectura", () => {
		expect(minutosDeLectura({ titulo: "", extracto: "", referencias: "", content: [] })).toBe(1);
		const m = minutosDeLectura(doc);
		expect(m).toBeGreaterThan(5);
		expect(m).toBeLessThan(40);
	});
});
