import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Lector } from "../src/admin/Lector.js";
import { idUnidad } from "../src/admin/logica.js";
import type { DocRevisable } from "../src/lib/types.js";

const DIR = join(import.meta.dirname, "fixtures");
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"));

function pintar(doc: DocRevisable): string {
	const nada = () => {};
	return renderToStaticMarkup(
		<Lector
			doc={doc}
			portada={null}
			marcas={new Map()}
			marcada={null}
			onMarcar={nada}
			onComentar={nada}
			onComentarSeleccion={nada}
			onVerComentarios={nada}
			cambiosPorBloque={new Map()}
			eliminadosTras={new Map()}
			cambiosCampo={new Map()}
			renderCambio={() => null}
		/>,
	);
}

describe("Lector (render estático)", () => {
	it.each(fixtures)("%s: una unidad por bloque, botones con nombre y sin enlaces peligrosos", (f) => {
		const doc = JSON.parse(readFileSync(join(DIR, f), "utf8")) as DocRevisable;
		const html = pintar(doc);
		for (const n of doc.content) {
			expect(html).toContain(`data-rv-unidad="${idUnidad({ campo: "content", blockKey: n._key })}"`);
		}
		const botones = html.match(/<button[^>]*class="rv-comentar"[^>]*>/g) ?? [];
		expect(botones.length).toBeGreaterThanOrEqual(doc.content.length);
		for (const b of botones) expect(b).toMatch(/aria-label="Comentar [^"]+"/);
		// Una sola parada de tabulador entre los botones «Comentar».
		expect(botones.filter((b) => b.includes('tabindex="0"'))).toHaveLength(1);
		expect(html).not.toMatch(/href="\s*javascript:/i);
	});

	it("el panel no usa dangerouslySetInnerHTML", () => {
		const dir = join(import.meta.dirname, "..", "src", "admin");
		for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toContain("dangerouslySetInnerHTML");
	});

	it("un enlace javascript: no se ofrece para abrir", () => {
		const doc: DocRevisable = {
			titulo: "T",
			extracto: "",
			referencias: "",
			content: [
				{
					_type: "block",
					_key: "b1",
					style: "normal",
					markDefs: [{ _type: "link", _key: "l1", href: "javascript:alert(1)" }],
					children: [{ _type: "span", _key: "s1", text: "pulsa", marks: ["l1"] }],
				},
			],
		};
		const html = pintar(doc);
		expect(html).not.toContain("javascript:");
		expect(html).toContain("Enlace con una dirección no válida");
	});

	it("el texto de un párrafo se pinta sin transformar", () => {
		const doc: DocRevisable = {
			titulo: "T",
			extracto: "",
			referencias: "1. Ref uno",
			content: [
				{
					_type: "block",
					_key: "b1",
					style: "normal",
					markDefs: [],
					children: [
						{ _type: "span", _key: "s1", text: "Dosis de ", marks: [] },
						{ _type: "span", _key: "s2", text: "2 mg", marks: ["strong"] },
						{ _type: "span", _key: "s3", text: " al día.", marks: [] },
					],
				},
			],
		};
		const html = pintar(doc);
		const textos = [...html.matchAll(/<span data-rv-t="">(.*?)<\/span>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));
		expect(textos).toEqual(["T", "Dosis de ", "2 mg", " al día.", "Ref uno"]);
	});
});
