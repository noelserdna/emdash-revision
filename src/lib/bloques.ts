/**
 * Conversión entre Portable Text del sitio y Markdown a nivel de bloque (pura).
 *
 * El Markdown que se produce es el que ve la IA y el que vuelve en las operaciones:
 * un bloque por línea, marcas en línea y escapes mínimos para que la ida y vuelta
 * conserve tipo, estilo, lista, nivel, texto plano y marcas por rango.
 *
 * Decisiones:
 * - `**` y `*` se interpretan como interruptores (abren si la marca está apagada y
 *   cierran si está encendida), así que el orden de anidado no importa y los rangos
 *   solapados de PT se representan sin ambigüedad. Un interruptor sin pareja es texto.
 * - Los saltos de línea dentro de un bloque se escriben `<br>`.
 * - Las marcas que no son strong/em/code/enlace se escriben
 *   `<span data-mark="underline">…</span>`; las anotaciones desconocidas, además,
 *   con `data-def="[JSON]"` para no perder su definición.
 * - Se escapan `\ * _ \`` siempre, `[ ]` dentro de enlaces, `](` fuera de ellos,
 *   `<` delante de `span`/`br`/`!--`, `|` en celdas y los marcadores de bloque al
 *   principio de la línea (`#`, `>`, `-`, `+`, `1.`, `|`, `![`).
 */
import type {
	Ancla,
	BloqueParaIA,
	DocRevisable,
	PTBlock,
	PTImage,
	PTMarkDef,
	PTNode,
	PTSpan,
	PTTable,
	PTTableCell,
} from "./types.js";

// ─── Utilidades de tipo ──────────────────────────────────────────────────────

export const ESTILOS_CONOCIDOS = new Set(["normal", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);

export function esBloque(n: PTNode | null | undefined): n is PTBlock {
	return !!n && n._type === "block" && Array.isArray((n as PTBlock).children);
}
export function esTabla(n: PTNode | null | undefined): n is PTTable {
	return !!n && n._type === "table" && Array.isArray((n as PTTable).rows);
}
export function esImagen(n: PTNode | null | undefined): n is PTImage {
	return !!n && n._type === "image";
}
function esSpan(s: unknown): s is PTSpan {
	return !!s && typeof s === "object" && (s as PTSpan)._type === "span" && typeof (s as PTSpan).text === "string";
}

/** Concatenación exacta del texto de los spans (los objetos en línea no cuentan). */
export function textoDeSpans(spans: readonly unknown[] | undefined): string {
	let t = "";
	for (const s of spans ?? []) if (esSpan(s)) t += s.text;
	return t;
}

/** Busca la celda de `ruta` = "rowKey/cellKey" en una tabla. */
export function celdaDe(tabla: PTTable, ruta: string): PTTableCell | null {
	const [rk, ck] = ruta.split("/");
	const fila = tabla.rows.find((r) => r._key === rk);
	return fila?.cells.find((c) => c._key === ck) ?? null;
}

// ─── Texto plano ─────────────────────────────────────────────────────────────

/** Texto plano de una unidad: concatenación exacta de span.text. `ruta` como en Ancla. */
export function textoDeBloque(node: PTNode, ruta?: string): string {
	if (esBloque(node)) return textoDeSpans(node.children);
	if (esTabla(node)) {
		if (ruta) {
			const c = celdaDe(node, ruta);
			return c ? textoDeSpans(c.content) : "";
		}
		return node.rows.map((r) => r.cells.map((c) => textoDeSpans(c.content)).join("\t")).join("\n");
	}
	if (esImagen(node)) {
		const alt = typeof node.alt === "string" ? node.alt : "";
		const cap = typeof node.caption === "string" ? node.caption : "";
		if (ruta === "alt") return alt;
		if (ruta === "caption") return cap;
		return [alt, cap].filter(Boolean).join("\n");
	}
	return "";
}

/** Líneas de referencias: [{ numero: "1", texto: "Maki PM…" }] a partir del campo de texto. */
export function referenciasDe(texto: string): Array<{ numero: string; texto: string }> {
	const out: Array<{ numero: string; texto: string }> = [];
	for (const l of (texto ?? "").split(/\r?\n/)) {
		const m = l.match(/^\s*(\d+)\.\s+(.*)$/);
		if (m) out.push({ numero: m[1] ?? "", texto: m[2] ?? "" });
	}
	return out;
}

/** Texto plano de la unidad que señala un ancla dentro del documento, o null si no existe. */
export function textoDeUnidad(doc: DocRevisable, ancla: Pick<Ancla, "campo" | "blockKey" | "ruta">): string | null {
	switch (ancla.campo) {
		case "title":
			return doc.titulo ?? "";
		case "excerpt":
			return doc.extracto ?? "";
		case "references": {
			if (!ancla.ruta) return doc.referencias ?? "";
			return referenciasDe(doc.referencias ?? "").find((r) => r.numero === ancla.ruta)?.texto ?? null;
		}
		case "content": {
			if (!ancla.blockKey) return null;
			const node = doc.content.find((n) => n._key === ancla.blockKey);
			if (!node) return null;
			if (ancla.ruta) {
				if (esTabla(node)) {
					const c = celdaDe(node, ancla.ruta);
					return c ? textoDeSpans(c.content) : null;
				}
				if (esImagen(node) && (ancla.ruta === "alt" || ancla.ruta === "caption")) return textoDeBloque(node, ancla.ruta);
				return null;
			}
			return textoDeBloque(node);
		}
		default:
			return null;
	}
}

/** parrafo | titulo | lista | cita | tabla | imagen | otro */
export function tipoDeBloque(node: PTNode): string {
	if (esBloque(node)) {
		const estilo = node.style ?? "normal";
		if (!ESTILOS_CONOCIDOS.has(estilo)) return "otro";
		if (node.listItem) return "lista";
		if (/^h[1-6]$/.test(estilo)) return "titulo";
		if (estilo === "blockquote") return "cita";
		return "parrafo";
	}
	if (esTabla(node)) return "tabla";
	if (esImagen(node)) return "imagen";
	return "otro";
}

/** Editable por operaciones: block de estilos conocidos y table. image y otros, no. */
export function esEditable(node: PTNode): boolean {
	if (esBloque(node)) {
		if (!ESTILOS_CONOCIDOS.has(node.style ?? "normal")) return false;
		if (node.listItem && node.listItem !== "bullet" && node.listItem !== "number") return false;
		return node.children.every(esSpan);
	}
	if (esTabla(node)) return node.rows.every((r) => Array.isArray(r.cells) && r.cells.every((c) => Array.isArray(c.content) && c.content.every(esSpan)));
	return false;
}

// ─── PT → Markdown (en línea) ────────────────────────────────────────────────

interface Pieza {
	texto: string;
	strong: boolean;
	em: boolean;
	code: boolean;
	enlace: string | null;
	href: string;
	decoradores: string[];
	anotaciones: Array<Record<string, unknown>>;
	firma: string;
}

function sinClave(def: PTMarkDef): Record<string, unknown> {
	const { _key: _, ...resto } = def;
	return resto;
}

function piezasDe(spans: readonly unknown[], markDefs: readonly PTMarkDef[]): Pieza[] {
	const defs = new Map(markDefs.map((d) => [d._key, d]));
	const out: Pieza[] = [];
	for (const s of spans) {
		if (!esSpan(s) || s.text === "") continue;
		const p: Pieza = { texto: s.text, strong: false, em: false, code: false, enlace: null, href: "", decoradores: [], anotaciones: [], firma: "" };
		for (const m of s.marks ?? []) {
			const def = defs.get(m);
			if (def) {
				if (def._type === "link" && typeof def.href === "string" && p.enlace === null) {
					p.enlace = m;
					p.href = def.href;
				} else p.anotaciones.push(sinClave(def));
			} else if (m === "strong") p.strong = true;
			else if (m === "em") p.em = true;
			else if (m === "code") p.code = true;
			else p.decoradores.push(m);
		}
		p.firma = JSON.stringify([p.strong, p.em, p.code, p.enlace, p.decoradores, p.anotaciones]);
		const prev = out[out.length - 1];
		if (prev && prev.firma === p.firma) prev.texto += p.texto;
		else out.push(p);
	}
	return out;
}

function escaparTexto(t: string, dentroDeEnlace: boolean, celda: boolean): string {
	let r = t.replace(/[\\*_`]/g, (c) => `\\${c}`);
	r = r.replace(/<(?=\/?span\b|br\b|!--)/gi, "\\<");
	if (dentroDeEnlace) r = r.replace(/[[\]]/g, (c) => `\\${c}`);
	else r = r.replace(/\](?=\()/g, "\\]");
	if (celda) r = r.replace(/\|/g, "\\|");
	return r.replace(/\n/g, "<br>");
}

function codigo(t: string, celda: boolean): string {
	let c = t.replace(/\n/g, " ");
	if (celda) c = c.replace(/\|/g, "\\|");
	const runs = c.match(/`+/g) ?? [];
	const n = Math.max(0, ...runs.map((x) => x.length)) + 1;
	const valla = "`".repeat(n);
	const relleno = c.startsWith("`") || c.endsWith("`") || (c.startsWith(" ") && c.endsWith(" ") && c.trim() !== "") ? " " : "";
	return `${valla}${relleno}${c}${relleno}${valla}`;
}

function escaparAtributo(v: string): string {
	return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hrefMd(href: string): string {
	return /[\s()<>]/.test(href) ? `<${href.replace(/>/g, "%3E")}>` : href;
}

/** Markdown en línea de una lista de spans con sus markDefs. */
export function spansAMarkdown(spans: readonly unknown[], markDefs: readonly PTMarkDef[] = [], opts: { celda?: boolean } = {}): string {
	const celda = !!opts.celda;
	const piezas = piezasDe(spans, markDefs);
	let out = "";
	let strong = false;
	let em = false;
	let enlace: string | null = null;
	let href = "";
	const interruptor = (s: boolean, e: boolean) => (s && e ? "***" : s ? "**" : e ? "*" : "");
	for (const p of piezas) {
		// 1) apagar marcas, 2) cerrar/abrir enlace, 3) encender marcas
		out += interruptor(strong && !p.strong, em && !p.em);
		if (strong && !p.strong) strong = false;
		if (em && !p.em) em = false;
		if (enlace !== p.enlace) {
			if (enlace !== null) out += `](${hrefMd(href)})`;
			if (p.enlace !== null) out += "[";
			enlace = p.enlace;
			href = p.href;
		}
		out += interruptor(p.strong && !strong, p.em && !em);
		strong = p.strong;
		em = p.em;
		let cuerpo = p.code ? codigo(p.texto, celda) : escaparTexto(p.texto, enlace !== null, celda);
		if (p.decoradores.length || p.anotaciones.length) {
			let attrs = "";
			if (p.decoradores.length) attrs += ` data-mark="${escaparAtributo(p.decoradores.join(" "))}"`;
			if (p.anotaciones.length) attrs += ` data-def="${escaparAtributo(JSON.stringify(p.anotaciones))}"`;
			cuerpo = `<span${attrs}>${cuerpo}</span>`;
		}
		out += cuerpo;
	}
	out += interruptor(strong, em);
	if (enlace !== null) out += `](${hrefMd(href)})`;
	return out;
}

/** Escapa un marcador de bloque al principio de la línea, si el texto empieza por uno. */
function escaparInicio(md: string): string {
	if (/^#{1,6}(\s|$)/.test(md) || /^[>+|]/.test(md) || /^-(\s|$|-)/.test(md) || md.startsWith("![")) return `\\${md}`;
	const m = md.match(/^(\d+)([.)])(\s|$)/);
	if (m) return `${m[1]}\\${md.slice((m[1] ?? "").length)}`;
	return md;
}

// ─── PT → Markdown (bloque) ──────────────────────────────────────────────────

/** Markdown de UN bloque. */
export function bloqueAMarkdown(node: PTNode): string {
	if (esBloque(node)) {
		const texto = spansAMarkdown(node.children, node.markDefs ?? []);
		const estilo = node.style ?? "normal";
		if (!ESTILOS_CONOCIDOS.has(estilo)) return `<!-- bloque:block:${estilo} -->\n${escaparInicio(texto)}`;
		const h = estilo.match(/^h([1-6])$/);
		if (h) return `${"#".repeat(Number(h[1]))} ${texto}`;
		if (estilo === "blockquote") return `> ${escaparInicio(texto)}`;
		if (node.listItem) {
			const nivel = Math.max(1, node.level ?? 1);
			return `${"  ".repeat(nivel - 1)}${node.listItem === "number" ? "1." : "-"} ${escaparInicio(texto)}`;
		}
		return escaparInicio(texto);
	}
	if (esTabla(node)) {
		const lineas: string[] = [];
		node.rows.forEach((r, i) => {
			const celdas = r.cells.map((c) => spansAMarkdown(c.content, c.markDefs ?? [], { celda: true }));
			lineas.push(`| ${celdas.join(" | ")} |`);
			if (i === 0 && node.hasHeaderRow) lineas.push(`| ${celdas.map(() => "---").join(" | ")} |`);
		});
		return lineas.join("\n");
	}
	if (esImagen(node)) {
		const alt = (typeof node.alt === "string" ? node.alt : "").replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\n/g, " ");
		const url = node.asset?.url ?? node.asset?._ref ?? "";
		const cap = typeof node.caption === "string" && node.caption ? `\n*${node.caption.replace(/[\\*_`]/g, (c) => `\\${c}`).replace(/\n/g, "<br>")}*` : "";
		return `![${alt}](${hrefMd(url)})${cap}`;
	}
	return `<!-- bloque:${node._type} -->`;
}

// ─── Markdown → PT (en línea) ────────────────────────────────────────────────

type Tok =
	| { t: "txt"; v: string }
	| { t: "del"; strong: boolean; em: boolean; raw: string; car: string }
	| { t: "code"; v: string }
	| { t: "lopen"; href: string }
	| { t: "lclose" }
	| { t: "uopen"; marcas: string[]; defs: Array<Record<string, unknown>>; raw: string; activo: boolean }
	| { t: "uclose"; raw: string; activo: boolean };

const PUNTUACION = /[!-/:-@[-`{-~]/;
const PALABRA = /[\p{L}\p{N}]/u;

function desescaparAtributo(v: string): string {
	return v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Busca el `]` que cierra el `[` de la posición `i` y el destino `(href)` que lo sigue. */
function buscarCierreEnlace(src: string, i: number): { cierre: number; fin: number; href: string } | null {
	let prof = 0;
	for (let j = i; j < src.length; j++) {
		const c = src[j];
		if (c === "\\") {
			j++;
			continue;
		}
		if (c === "[") prof++;
		else if (c === "]") {
			prof--;
			if (prof === 0) {
				if (src[j + 1] !== "(") return null;
				const resto = src.slice(j + 1);
				const m = resto.match(/^\(<([^>]*)>(?:\s+"[^"]*")?\)/) ?? resto.match(/^\(((?:[^\s()]|\([^\s()]*\))*)(?:\s+"[^"]*")?\)/);
				if (!m) return null;
				return { cierre: j, fin: j + 1 + m[0].length, href: m[1] ?? "" };
			}
		}
	}
	return null;
}

function tokenizar(src: string): Tok[] {
	const toks: Tok[] = [];
	const cierres = new Map<number, number>(); // posición de "]" → fin del destino
	let txt = "";
	const volcar = () => {
		if (txt) toks.push({ t: "txt", v: txt });
		txt = "";
	};
	let i = 0;
	while (i < src.length) {
		const c = src[i] ?? "";
		if (c === "\\" && i + 1 < src.length && PUNTUACION.test(src[i + 1] ?? "")) {
			txt += src[i + 1];
			i += 2;
			continue;
		}
		if (cierres.has(i)) {
			volcar();
			toks.push({ t: "lclose" });
			i = cierres.get(i) ?? i + 1;
			continue;
		}
		if (c === "`") {
			let n = 0;
			while (src[i + n] === "`") n++;
			const valla = "`".repeat(n);
			let j = i + n;
			let fin = -1;
			while (j < src.length) {
				const k = src.indexOf(valla, j);
				if (k < 0) break;
				let m = 0;
				while (src[k + m] === "`") m++;
				if (m === n) {
					fin = k;
					break;
				}
				j = k + m;
			}
			if (fin < 0) {
				txt += valla;
				i += n;
				continue;
			}
			let v = src.slice(i + n, fin);
			if (v.length >= 2 && v.startsWith(" ") && v.endsWith(" ") && v.trim() !== "") v = v.slice(1, -1);
			volcar();
			toks.push({ t: "code", v });
			i = fin + n;
			continue;
		}
		if (c === "*" || c === "_") {
			let n = 0;
			while (src[i + n] === c) n++;
			const antes = src[i - 1] ?? "";
			const despues = src[i + n] ?? "";
			const valido = n <= 3 && (c === "*" || !(PALABRA.test(antes) && PALABRA.test(despues)));
			if (!valido) {
				txt += c.repeat(n);
				i += n;
				continue;
			}
			volcar();
			toks.push({ t: "del", strong: n >= 2, em: n !== 2, raw: c.repeat(n), car: c });
			i += n;
			continue;
		}
		if (c === "[") {
			const e = buscarCierreEnlace(src, i);
			if (e) {
				volcar();
				cierres.set(e.cierre, e.fin);
				toks.push({ t: "lopen", href: e.href });
				i++;
				continue;
			}
		}
		if (c === "<") {
			const resto = src.slice(i);
			const br = resto.match(/^<br\s*\/?>/i);
			if (br) {
				txt += "\n";
				i += br[0].length;
				continue;
			}
			const ab = resto.match(/^<span((?:\s+[\w-]+="[^"]*")*)\s*>/i);
			if (ab) {
				const attrs = ab[1] ?? "";
				const marca = attrs.match(/data-mark="([^"]*)"/i);
				const def = attrs.match(/data-def="([^"]*)"/i);
				let defs: Array<Record<string, unknown>> = [];
				if (def) {
					try {
						const v: unknown = JSON.parse(desescaparAtributo(def[1] ?? ""));
						if (Array.isArray(v)) defs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
					} catch {
						defs = [];
					}
				}
				volcar();
				toks.push({
					t: "uopen",
					marcas: marca ? desescaparAtributo(marca[1] ?? "").split(/\s+/).filter(Boolean) : [],
					defs,
					raw: ab[0],
					activo: true,
				});
				i += ab[0].length;
				continue;
			}
			const ce = resto.match(/^<\/span\s*>/i);
			if (ce) {
				volcar();
				toks.push({ t: "uclose", raw: ce[0], activo: true });
				i += ce[0].length;
				continue;
			}
		}
		txt += c;
		i++;
	}
	volcar();

	// Interruptores sin pareja → texto.
	for (const marca of ["strong", "em"] as const) {
		const idx: number[] = [];
		toks.forEach((t, k) => {
			if (t.t === "del" && t[marca]) idx.push(k);
		});
		if (idx.length % 2 === 1) {
			const k = idx[idx.length - 1] ?? -1;
			const t = toks[k];
			if (t && t.t === "del") {
				t[marca] = false;
				const lit = t.car.repeat(marca === "strong" ? 2 : 1);
				toks.splice(k, 0, { t: "txt", v: lit });
			}
		}
	}
	// Spans HTML sin pareja → texto.
	const pila: Array<Extract<Tok, { t: "uopen" }>> = [];
	for (const t of toks) {
		if (t.t === "uopen") pila.push(t);
		else if (t.t === "uclose") {
			if (!pila.pop()) t.activo = false;
		}
	}
	for (const t of pila) t.activo = false;
	return toks;
}

/** Markdown en línea → spans y markDefs con claves nuevas. */
export function markdownASpans(src: string, clave: () => string = nuevaClave): { children: PTSpan[]; markDefs: PTMarkDef[] } {
	const toks = tokenizar(src);
	const markDefs: PTMarkDef[] = [];
	const usados = new Set<string>();
	const children: PTSpan[] = [];
	let strong = false;
	let em = false;
	const enlaces: string[] = [];
	const extras: string[][] = [];
	const emitir = (texto: string, code: boolean) => {
		if (!texto) return;
		const marcas: string[] = [];
		for (const ex of extras) marcas.push(...ex);
		if (strong) marcas.push("strong");
		if (em) marcas.push("em");
		if (code) marcas.push("code");
		marcas.push(...enlaces);
		for (const m of marcas) usados.add(m);
		const prev = children[children.length - 1];
		if (prev && JSON.stringify(prev.marks) === JSON.stringify(marcas)) prev.text += texto;
		else children.push({ _type: "span", _key: clave(), text: texto, marks: marcas });
	};
	for (const t of toks) {
		switch (t.t) {
			case "txt":
				emitir(t.v, false);
				break;
			case "code":
				emitir(t.v, true);
				break;
			case "del":
				if (!t.strong && !t.em) break;
				if (t.strong) strong = !strong;
				if (t.em) em = !em;
				break;
			case "lopen": {
				const k = clave();
				markDefs.push({ _type: "link", _key: k, href: t.href });
				enlaces.push(k);
				break;
			}
			case "lclose":
				enlaces.pop();
				break;
			case "uopen": {
				if (!t.activo) {
					emitir(t.raw, false);
					break;
				}
				const ms = [...t.marcas];
				for (const d of t.defs) {
					const k = clave();
					markDefs.push({ _type: "unknown", ...d, _key: k } as PTMarkDef);
					ms.push(k);
				}
				extras.push(ms);
				break;
			}
			case "uclose":
				if (!t.activo) emitir(t.raw, false);
				else extras.pop();
				break;
		}
	}
	if (!children.length) children.push({ _type: "span", _key: clave(), text: "", marks: [] });
	return { children, markDefs: markDefs.filter((d) => usados.has(d._key)) };
}

// ─── Markdown → PT (bloques) ─────────────────────────────────────────────────

const RE_LISTA = /^(\s*)([-*+]|\d+[.)])(?:[ \t]+(.*)|[ \t]*)$/;
const RE_TITULO = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const RE_SEPARADOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RE_REGLA = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

function esEspecial(l: string): boolean {
	return l.trim() === "" || RE_TITULO.test(l) || /^ {0,3}>/.test(l) || /^\s*([-*+]|\d+[.)])[ \t]/.test(l) || /^\s*\|/.test(l) || /^\s*!\[/.test(l) || /^\s*<!--/.test(l);
}

/** Separa una fila de tabla en celdas respetando `\|`. */
function celdasDeFila(linea: string): string[] {
	let l = linea.trim();
	if (l.startsWith("|")) l = l.slice(1);
	const celdas: string[] = [];
	let actual = "";
	for (let i = 0; i < l.length; i++) {
		const c = l[i];
		if (c === "\\" && i + 1 < l.length) {
			if (l[i + 1] === "|") actual += "|";
			else actual += c + l[i + 1];
			i++;
			continue;
		}
		if (c === "|") {
			celdas.push(actual);
			actual = "";
			continue;
		}
		actual += c;
	}
	if (actual.trim() !== "" || celdas.length === 0) celdas.push(actual);
	return celdas.map((c) => c.trim());
}

/** Markdown (uno o varios bloques separados por línea en blanco) → nodos PT con claves nuevas. */
export function markdownABloques(md: string, clave: () => string = nuevaClave): PTNode[] {
	const L = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
	const out: PTNode[] = [];
	const bloque = (texto: string, style: string, extra: Partial<PTBlock> = {}): PTBlock => ({
		_type: "block",
		_key: clave(),
		style,
		...markdownASpans(texto, clave),
		...extra,
	});
	let i = 0;
	while (i < L.length) {
		const l = L[i] ?? "";
		if (l.trim() === "" || RE_REGLA.test(l)) {
			i++;
			continue;
		}
		if (/^\s*<!--/.test(l)) {
			while (i < L.length && !(L[i] ?? "").includes("-->")) i++;
			i++;
			continue;
		}
		let m = l.match(RE_TITULO);
		if (m) {
			out.push(bloque((m[2] ?? "").trim(), `h${(m[1] ?? "#").length}`));
			i++;
			continue;
		}
		if (/^ {0,3}>/.test(l)) {
			const q: string[] = [];
			while (i < L.length && /^ {0,3}>/.test(L[i] ?? "")) q.push((L[i++] ?? "").replace(/^ {0,3}>[ \t]?/, ""));
			let para: string[] = [];
			const vaciar = () => {
				if (para.length) out.push(bloque(para.join(" "), "blockquote"));
				para = [];
			};
			for (const ql of q) {
				if (ql.trim() === "") {
					vaciar();
					continue;
				}
				const li = ql.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
				if (li) {
					vaciar();
					out.push(bloque(`• ${li[1] ?? ""}`, "blockquote"));
				} else if (/^\*\*.*\*\*$/.test(ql.trim()) || /\*\*\s*$/.test(ql.trim())) {
					vaciar();
					para.push(ql.trim());
					vaciar();
				} else para.push(ql.trim());
			}
			vaciar();
			continue;
		}
		if (/^\s*\|/.test(l)) {
			const t: string[] = [];
			while (i < L.length && /^\s*\|/.test(L[i] ?? "")) t.push(L[i++] ?? "");
			const cabecera = t.length > 1 && RE_SEPARADOR.test(t[1] ?? "");
			const filas = t.filter((x, k) => !(RE_SEPARADOR.test(x) && (k === 1 || !x.match(/[^\s|:-]/))));
			const tabla: PTTable = {
				_type: "table",
				_key: clave(),
				hasHeaderRow: cabecera,
				rows: filas.map((f, r) => ({
					_type: "tableRow" as const,
					_key: clave(),
					cells: celdasDeFila(f).map((c) => {
						const { children, markDefs } = markdownASpans(c, clave);
						const celda: PTTableCell = { _type: "tableCell", _key: clave(), content: children, markDefs };
						if (cabecera && r === 0) celda.isHeader = true;
						return celda;
					}),
				})),
			};
			out.push(tabla);
			continue;
		}
		if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l)) {
			// No se generan imágenes: se ignora la línea y su pie inmediato.
			i++;
			if (/^\s*[*_][^*_].*[*_]\s*$/.test(L[i] ?? "")) i++;
			continue;
		}
		m = l.match(RE_LISTA);
		if (m) {
			const nivel = Math.floor((m[1] ?? "").replace(/\t/g, "  ").length / 2) + 1;
			let texto = m[3] ?? "";
			i++;
			while (i < L.length && (L[i] ?? "").trim() !== "" && /^\s{2,}\S/.test(L[i] ?? "") && !/^\s*([-*+]|\d+[.)])\s/.test(L[i] ?? "")) texto += ` ${(L[i++] ?? "").trim()}`;
			out.push(bloque(texto.trim(), "normal", { listItem: /\d/.test(m[2] ?? "") ? "number" : "bullet", level: nivel }));
			continue;
		}
		const p = [l.trim()];
		i++;
		while (i < L.length && !esEspecial(L[i] ?? "")) p.push((L[i++] ?? "").trim());
		out.push(bloque(p.join(" "), "normal"));
	}
	return out;
}

// ─── Claves ──────────────────────────────────────────────────────────────────

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

export function nuevaClave(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
	return s;
}

/** Garantiza _key presentes y únicas en bloques, spans, markDefs, filas y celdas. */
export function normalizarClaves(content: PTNode[], clave: () => string = nuevaClave): { content: PTNode[]; cambiado: boolean } {
	let cambiado = false;
	const unica = (k: unknown, vistas: Set<string>): string | null => {
		if (typeof k === "string" && k && !vistas.has(k)) {
			vistas.add(k);
			return null;
		}
		let n = clave();
		while (vistas.has(n)) n = clave();
		vistas.add(n);
		return n;
	};
	/** Spans y markDefs de un contenedor (bloque o celda). Devuelve null si no cambió. */
	const contenedor = (spans: unknown[] | undefined, defs: PTMarkDef[] | undefined) => {
		const vistas = new Set<string>();
		let cambio = false;
		const nDefs = defs?.map((d) => {
			const k = unica(d?._key, vistas);
			if (k === null) return d;
			cambio = true;
			return { ...d, _key: k };
		});
		const nSpans = spans?.map((s) => {
			if (!s || typeof s !== "object") return s;
			const k = unica((s as { _key?: unknown })._key, vistas);
			if (k === null) return s;
			cambio = true;
			return { ...(s as object), _key: k };
		});
		return cambio ? { spans: nSpans, defs: nDefs } : null;
	};
	const vistasBloques = new Set<string>();
	const nuevo = content.map((node) => {
		let n: PTNode = node;
		const kb = unica(node?._key, vistasBloques);
		if (kb !== null) n = { ...n, _key: kb };
		if (esBloque(n)) {
			const r = contenedor(n.children, n.markDefs);
			if (r) {
				n = { ...n, children: r.spans as PTSpan[] };
				if (r.defs) (n as PTBlock).markDefs = r.defs;
			}
		} else if (esTabla(n)) {
			const tabla = n;
			const vistas = new Set<string>();
			let cambioTabla = false;
			const rows = tabla.rows.map((fila) => {
				let f = fila;
				const kf = unica(fila?._key, vistas);
				if (kf !== null) f = { ...f, _key: kf };
				const cells = (f.cells ?? []).map((celda) => {
					let c = celda;
					const kc = unica(celda?._key, vistas);
					if (kc !== null) c = { ...c, _key: kc };
					const r = contenedor(c.content, c.markDefs);
					if (r) {
						c = { ...c, content: r.spans as PTSpan[] };
						if (r.defs) c.markDefs = r.defs;
					}
					return c;
				});
				if (cells.some((c, k) => c !== f.cells?.[k])) f = { ...f, cells };
				return f;
			});
			if (rows.some((r, k) => r !== tabla.rows[k])) cambioTabla = true;
			if (cambioTabla) n = { ...tabla, rows };
		}
		if (n !== node) cambiado = true;
		return n;
	});
	return cambiado ? { content: nuevo, cambiado } : { content, cambiado };
}

// ─── Documento ───────────────────────────────────────────────────────────────

/** Documento completo a Markdown. Incluye título como "# " y las referencias bajo "## Fuentes". */
export function docAMarkdown(doc: DocRevisable): string {
	const partes: string[] = [];
	if (doc.titulo) partes.push(`# ${spansAMarkdown([{ _type: "span", _key: "t", text: doc.titulo }])}`);
	if (doc.extracto) partes.push(spansAMarkdown([{ _type: "span", _key: "e", text: doc.extracto, marks: ["em"] }]));
	let previoLista = false;
	for (const n of doc.content) {
		const md = bloqueAMarkdown(n);
		const lista = esBloque(n) && !!n.listItem;
		if (lista && previoLista && partes.length) partes[partes.length - 1] += `\n${md}`;
		else partes.push(md);
		previoLista = lista;
	}
	const refs = (doc.referencias ?? "").trim();
	if (refs) partes.push(`## Fuentes\n\n${refs}`);
	return `${partes.join("\n\n")}\n`;
}

/** Bloques etiquetados para la IA. */
export function bloquesParaIA(content: PTNode[]): BloqueParaIA[] {
	return content.map((n) => ({ key: n._key, tipo: tipoDeBloque(n), editable: esEditable(n), markdown: bloqueAMarkdown(n) }));
}

/** Palabras del documento / 220, redondeado hacia arriba, mínimo 1. */
export function minutosDeLectura(doc: DocRevisable): number {
	const contar = (t: string) => (t.match(/\S+/g) ?? []).length;
	let palabras = contar(doc.titulo ?? "") + contar(doc.extracto ?? "");
	for (const n of doc.content) palabras += contar(textoDeBloque(n));
	return Math.max(1, Math.ceil(palabras / 220));
}
