#!/usr/bin/env node
/**
 * Genera los fixtures de Portable Text de la prueba dorada a partir de artículos reales
 * del sitio, con la misma conversión que `menopausia/scripts/importar-articulos.mjs`
 * (copiada aquí para que los tests no dependan del sitio).
 *
 *   node test/fixtures/generar.mjs [/ruta/a/menopausia/contenido]
 *
 * Los tests solo leen los JSON resultantes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CONTENIDO = process.argv[2] ?? "../menopausia/contenido";

const ARTICULOS = [
	"fase-1/01-que-es-la-menopausia",
	"fase-1/09-sintomas-de-la-menopausia",
	"fase-1/34-suplementos-menopausia-evidencia",
	"fase-2/22-senales-de-alarma-menopausia",
	"fase-2/25-vias-terapia-hormonal-parches-gel-pastillas",
	"fase-2/31-fezolinetant-veoza",
	"fase-2/47-depresion-menopausia",
	"fase-3/35-informacion-fiable-menopausia-menowashing",
];

// ---------- copia de importar-articulos.mjs (líneas ~55-175) ----------
// Claves deterministas para que el fixture sea reproducible.
let k = 0;
const key = () => `k${(++k).toString(36).padStart(5, "0")}`;

function frontmatter(md) {
	const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!m) return [{}, md];
	const fm = {};
	for (const line of m[1].split("\n")) {
		const mm = line.match(/^([a-z_]+):\s*(.*)$/);
		if (!mm) continue;
		let v = mm[2].trim();
		if (v.startsWith("[") && v.endsWith("]"))
			v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
		else v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
		fm[mm[1]] = v;
	}
	return [fm, md.slice(m[0].length)];
}

const INLINE = /\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text, extraMarks = []) {
	const children = [];
	const markDefs = [];
	let last = 0;
	const push = (t, marks) => t && children.push({ _type: "span", _key: key(), text: t, marks: [...extraMarks, ...marks] });
	for (const m of text.matchAll(INLINE)) {
		push(text.slice(last, m.index), []);
		if (m[1] != null) {
			const sub = inline(m[1], ["strong"]);
			children.push(...sub.children);
			markDefs.push(...sub.markDefs);
		} else if (m[2] != null || m[3] != null) push(m[2] ?? m[3], ["em"]);
		else if (m[4] != null) push(m[4], ["code"]);
		else if (m[5] != null) {
			const mk = key();
			markDefs.push({ _type: "link", _key: mk, href: m[6] });
			push(m[5], [mk]);
		}
		last = m.index + m[0].length;
	}
	push(text.slice(last), []);
	if (!children.length) children.push({ _type: "span", _key: key(), text: "", marks: [] });
	return { children, markDefs };
}

const block = (text, style = "normal", extra = {}) => ({ _type: "block", _key: key(), style, ...inline(text), ...extra });

function table(lines) {
	const rows = lines
		.filter((l) => !/^\|\s*:?-{2,}/.test(l))
		.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
	return {
		_type: "table",
		_key: key(),
		hasHeaderRow: true,
		rows: rows.map((cells, r) => ({
			_type: "tableRow",
			_key: key(),
			cells: cells.map((c) => {
				const { children, markDefs } = inline(c);
				return { _type: "tableCell", _key: key(), content: children, markDefs, ...(r === 0 ? { isHeader: true } : {}) };
			}),
		})),
	};
}

function toPT(md, imagen) {
	const L = md.split("\n");
	const out = [];
	let i = 0;
	const isSpecial = (l) => /^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|\||!\[)/.test(l) || l.trim() === "";
	while (i < L.length) {
		const l = L[i];
		if (l.trim() === "" || /^---+\s*$/.test(l)) { i++; continue; }
		let m;
		if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push(block(m[2].trim(), `h${m[1].length}`)); i++; continue; }
		if (l.startsWith(">")) {
			const q = [];
			while (i < L.length && L[i].startsWith(">")) q.push(L[i++].replace(/^>\s?/, ""));
			let para = [];
			const flush = () => { if (para.length) out.push(block(para.join(" "), "blockquote")); para = []; };
			for (const ql of q) {
				if (ql.trim() === "") { flush(); continue; }
				const li = ql.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
				if (li) { flush(); out.push(block(`• ${li[1]}`, "blockquote")); }
				else if (/^\*\*.*\*\*$/.test(ql.trim()) || /\*\*\s*$/.test(ql.trim())) { flush(); para.push(ql.trim()); flush(); }
				else para.push(ql.trim());
			}
			flush();
			continue;
		}
		if (l.startsWith("|")) {
			const t = [];
			while (i < L.length && L[i].startsWith("|")) t.push(L[i++]);
			out.push(table(t));
			continue;
		}
		if ((m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
			i++;
			let caption;
			while (i < L.length && L[i].trim() === "") i++;
			const c = L[i]?.match(/^\*(Figura.*)\*\s*$/) || L[i]?.match(/^_(Figura.*)_\s*$/);
			if (c) { caption = c[1]; i++; }
			out.push(imagen(m[2], m[1], caption));
			continue;
		}
		if ((m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/))) {
			const level = Math.floor(m[1].length / 2) + 1;
			let text = m[3];
			i++;
			while (i < L.length && L[i].trim() !== "" && /^\s{2,}\S/.test(L[i]) && !/^\s*([-*]|\d+\.)\s/.test(L[i])) text += " " + L[i++].trim();
			out.push(block(text, "normal", { listItem: /\d/.test(m[2]) ? "number" : "bullet", level }));
			continue;
		}
		const p = [l.trim()];
		i++;
		while (i < L.length && !isSpecial(L[i])) p.push(L[i++].trim());
		out.push(block(p.join(" ")));
	}
	return out;
}
// ---------- fin de la copia ----------

for (const rel of ARTICULOS) {
	k = 0;
	const [fm, cuerpo0] = frontmatter(readFileSync(join(CONTENIDO, rel, "articulo.md"), "utf8"));
	let cuerpo = cuerpo0.replace(/^\s*#\s+.*\n/, "");
	cuerpo = cuerpo.replace(/[ \t]*\[VERIFICAR(?:[^\[\]]|\[[^\]]*\])*\]/g, "");
	let referencias = "";
	const fi = cuerpo.search(/^##\s+Fuentes\s*$/m);
	if (fi >= 0) {
		referencias = cuerpo.slice(fi).split("\n").slice(1).filter((l) => /^\s*\d+\.\s/.test(l)).map((l) => l.trim()).join("\n");
		cuerpo = cuerpo.slice(0, fi);
	}
	// Imagen falsa: mismas propiedades que la subida real, sin medios.
	const imagen = (src, alt, caption) => ({
		_type: "image",
		_key: key(),
		asset: { _ref: `media-${src.replace(/\W+/g, "-")}`, url: `/_emdash/api/media/file/${src.replace(/^img\//, "")}` },
		alt,
		...(caption ? { caption } : {}),
		width: 1600,
		height: 900,
	});
	const content = toPT(cuerpo, imagen);
	const nombre = rel.split("/")[1];
	const salida = { titulo: fm.title, extracto: fm.excerpt, referencias, content };
	writeFileSync(join(AQUI, `${nombre}.json`), JSON.stringify(salida, null, "\t") + "\n");
	console.error(`✓ ${nombre}: ${content.length} bloques`);
}
