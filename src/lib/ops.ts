/**
 * Aplicación de operaciones de corrección, sustitución literal («Cambiarlo ya») y
 * deshacer (pura). Nunca lanza: lo inválido va a `rechazadas`. Los bloques no tocados
 * se conservan por referencia.
 */
import { resolverAncla } from "./anclas.js";
import { celdaDe, esBloque, esEditable, esImagen, esTabla, markdownABloques, nuevaClave as claveAleatoria, referenciasDe, textoDeBloque, tipoDeBloque } from "./bloques.js";
import { igualesSinClaves } from "./hash.js";
import { detectarSensibles } from "./sensibles.js";
import type { Ancla, Aviso, CambioDoc, CampoAncla, DocRevisable, Op, OpRechazada, PTMarkDef, PTNode, PTSpan, ResultadoOps } from "./types.js";

export { hashDoc } from "./hash.js";

export interface ContextoOps {
	/** Comentarios abiertos, para validar a qué responde cada operación. */
	comentarios: Array<{ id: string; ancla: Ancla | null }>;
	/** true = reescritura completa: no se marca "no pedido". */
	completa?: boolean;
	terminosSensibles?: string[];
	nuevaClave?: () => string;
}

type Cambio = ResultadoOps["cambios"][number];

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Todos los href de enlaces de un nodo (bloque o tabla). */
function hrefsDe(node: PTNode): string[] {
	const out: string[] = [];
	const defs = (d: PTMarkDef[] | undefined) => {
		for (const m of d ?? []) if (typeof m.href === "string") out.push(m.href);
	};
	if (esBloque(node)) defs(node.markDefs);
	else if (esTabla(node)) for (const r of node.rows) for (const c of r.cells) defs(c.markDefs);
	return out;
}

function citasDe(texto: string): string[] {
	const out: string[] = [];
	for (const m of texto.matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g)) {
		for (const parte of (m[1] ?? "").split(/\s*,\s*/)) {
			const r = parte.match(/^(\d+)\s*[-–]\s*(\d+)$/);
			if (r) {
				const a = Number(r[1]);
				const b = Number(r[2]);
				if (b >= a && b - a < 50) for (let k = a; k <= b; k++) out.push(String(k));
			} else out.push(parte.trim());
		}
	}
	return out;
}

/** Avisos `cita_nueva` y `enlace_nuevo` para un texto/nodo nuevo frente al anterior. */
function avisosDeReferencias(textoAntes: string, textoDespues: string, numeros: Set<string>, hrefsNuevos: string[], hrefsConocidos: Set<string>): Aviso[] {
	const avisos: Aviso[] = [];
	const previas = new Set(citasDe(textoAntes));
	const vistas = new Set<string>();
	for (const n of citasDe(textoDespues)) {
		if (numeros.has(n) || previas.has(n) || vistas.has(n)) continue;
		vistas.add(n);
		avisos.push({ tipo: "cita_nueva", mensaje: `La cita [${n}] no existe en las referencias.`, despues: `[${n}]` });
	}
	const enl = new Set<string>();
	for (const h of hrefsNuevos) {
		if (hrefsConocidos.has(h) || enl.has(h)) continue;
		enl.add(h);
		avisos.push({ tipo: "enlace_nuevo", mensaje: `Hay un enlace nuevo: «${h}».`, despues: h });
	}
	return avisos;
}

function textoDeNodo(n: PTNode | null | undefined): string {
	return n ? textoDeBloque(n) : "";
}

// ─── aplicarOps ──────────────────────────────────────────────────────────────

/** Aplica las operaciones en orden. No lanza: lo inválido va a `rechazadas`. */
export function aplicarOps(doc: DocRevisable, ops: Op[], ctx: ContextoOps): ResultadoOps {
	const clave = ctx.nuevaClave ?? claveAleatoria;
	const extra = ctx.terminosSensibles ?? [];
	const content = [...doc.content];
	let titulo = doc.titulo;
	let extracto = doc.extracto;
	const cambios: Cambio[] = [];
	const rechazadas: OpRechazada[] = [];

	const hrefsConocidos = new Set(doc.content.flatMap(hrefsDe));
	const numeros = new Set(referenciasDe(doc.referencias ?? "").map((r) => r.numero));
	const comentarios = new Map((ctx.comentarios ?? []).map((c) => [c.id, c.ancla]));

	/** ¿Algún comentario de la operación apunta a este bloque/campo (o es general)? */
	const pedido = (ids: string[], campo: CampoAncla, blockKey: string | null) =>
		ids.some((id) => {
			if (!comentarios.has(id)) return false;
			const a = comentarios.get(id);
			if (!a) return true;
			if (a.campo !== campo) return false;
			return campo !== "content" || a.blockKey === blockKey;
		});
	const avisoNoPedido = (ids: string[], campo: CampoAncla, blockKey: string | null): Aviso[] =>
		ctx.completa || pedido(ids, campo, blockKey) ? [] : [{ tipo: "no_pedido", mensaje: "Este cambio no lo pidió ningún comentario." }];

	const idx = (key: string) => content.findIndex((n) => n?._key === key);
	const rechazar = (op: Op, motivo: string) => rechazadas.push({ op, motivo });
	const registrar = (c: Omit<Cambio, "orden">) => cambios.push({ ...c, orden: cambios.length });

	/** Inserta nodos tras la posición `pos` y registra un cambio `insertar` por cada uno. */
	const insertar = (pos: number, nodos: PTNode[], ids: string[], blockKeyPedido: string) => {
		nodos.forEach((n, k) => {
			const at = pos + 1 + k;
			content.splice(at, 0, n);
			const texto = textoDeNodo(n);
			registrar({
				op: "insertar",
				campo: "content",
				blockKey: n._key,
				trasKey: content[at - 1]?._key ?? null,
				antes: null,
				despues: n,
				comentarioIds: [...ids],
				avisos: [
					...avisoNoPedido(ids, "content", blockKeyPedido),
					...detectarSensibles("", texto, extra),
					...avisosDeReferencias("", texto, numeros, hrefsDe(n), hrefsConocidos),
				],
			});
		});
	};

	for (const op of ops ?? []) {
		const ids = Array.isArray(op?.comentarioIds) ? op.comentarioIds.filter((x): x is string => typeof x === "string") : [];
		switch (op?.op) {
			case "reemplazar": {
				const i = idx(op.blockKey);
				const actual = content[i];
				if (i < 0 || !actual) {
					rechazar(op, `No existe el bloque «${op.blockKey}».`);
					break;
				}
				if (!esEditable(actual)) {
					rechazar(op, `El bloque «${op.blockKey}» (${tipoDeBloque(actual)}) no se puede editar.`);
					break;
				}
				if (typeof op.markdown !== "string" || !op.markdown.trim()) {
					rechazar(op, `El texto nuevo del bloque «${op.blockKey}» está vacío. Para quitarlo, usa «eliminar».`);
					break;
				}
				const nodos = markdownABloques(op.markdown, clave);
				const [primero, ...resto] = nodos;
				if (!primero) {
					rechazar(op, `El texto nuevo del bloque «${op.blockKey}» no produce ningún bloque.`);
					break;
				}
				const nuevo = { ...primero, _key: actual._key } as PTNode;
				if (!igualesSinClaves(nuevo, actual)) {
					content[i] = nuevo;
					const ta = textoDeNodo(actual);
					const td = textoDeNodo(nuevo);
					registrar({
						op: "reemplazar",
						campo: "content",
						blockKey: actual._key,
						trasKey: content[i - 1]?._key ?? null,
						antes: actual,
						despues: nuevo,
						comentarioIds: [...ids],
						avisos: [
							...avisoNoPedido(ids, "content", actual._key),
							...detectarSensibles(ta, td, extra),
							...avisosDeReferencias(ta, td, numeros, hrefsDe(nuevo), hrefsConocidos),
						],
					});
				}
				if (resto.length) insertar(i, resto, ids, actual._key);
				break;
			}
			case "insertar_tras": {
				const i = idx(op.blockKey);
				if (i < 0) {
					rechazar(op, `No existe el bloque «${op.blockKey}» tras el que insertar.`);
					break;
				}
				if (typeof op.markdown !== "string" || !op.markdown.trim()) {
					rechazar(op, "El texto que se quiere insertar está vacío.");
					break;
				}
				const nodos = markdownABloques(op.markdown, clave);
				if (!nodos.length) {
					rechazar(op, "El texto que se quiere insertar no produce ningún bloque.");
					break;
				}
				insertar(i, nodos, ids, op.blockKey);
				break;
			}
			case "eliminar": {
				const i = idx(op.blockKey);
				const actual = content[i];
				if (i < 0 || !actual) {
					rechazar(op, `No existe el bloque «${op.blockKey}».`);
					break;
				}
				if (!esEditable(actual)) {
					const apunta = ids.some((id) => comentarios.get(id)?.blockKey === actual._key);
					if (!esImagen(actual) || !apunta) {
						rechazar(op, `El bloque «${op.blockKey}» (${tipoDeBloque(actual)}) solo se puede quitar si un comentario sobre él lo pide.`);
						break;
					}
				}
				content.splice(i, 1);
				registrar({
					op: "eliminar",
					campo: "content",
					blockKey: actual._key,
					trasKey: content[i - 1]?._key ?? null,
					antes: actual,
					despues: null,
					comentarioIds: [...ids],
					avisos: avisoNoPedido(ids, "content", actual._key),
				});
				break;
			}
			case "campo": {
				if (op.campo !== "title" && op.campo !== "excerpt") {
					rechazar(op, `El campo «${String(op.campo)}» no se puede cambiar con esta operación.`);
					break;
				}
				if (typeof op.texto !== "string" || !op.texto.trim()) {
					rechazar(op, op.campo === "title" ? "El título nuevo está vacío." : "El extracto nuevo está vacío.");
					break;
				}
				const antes = op.campo === "title" ? titulo : extracto;
				const despues = op.texto.trim();
				if (antes === despues) break;
				if (op.campo === "title") titulo = despues;
				else extracto = despues;
				registrar({
					op: "campo",
					campo: op.campo,
					blockKey: null,
					trasKey: null,
					antes,
					despues,
					comentarioIds: [...ids],
					avisos: [...avisoNoPedido(ids, op.campo, null), ...detectarSensibles(antes, despues, extra), ...avisosDeReferencias(antes, despues, numeros, [], hrefsConocidos)],
				});
				break;
			}
			default:
				rechazar(op, `Operación desconocida: «${String((op as { op?: unknown })?.op)}».`);
		}
	}

	const cambiado = cambios.length > 0;
	return {
		doc: cambiado ? { ...doc, titulo, extracto, content } : doc,
		cambios,
		rechazadas,
	};
}

// ─── sustituirFragmento ──────────────────────────────────────────────────────

/** Sustituye [inicio, fin) de una lista de spans por `texto`, con las marcas comunes al tramo. */
export function sustituirEnSpans(spans: PTSpan[], inicio: number, fin: number, texto: string, clave: () => string): PTSpan[] {
	type Trozo = { text: string; marks: string[]; key: string | null };
	const trozos: Trozo[] = [];
	const usadas = new Set<string>();
	const tomarClave = (k: string) => {
		if (usadas.has(k)) return null;
		usadas.add(k);
		return k;
	};
	// Marcas comunes a todos los caracteres sustituidos (o del carácter anterior si el tramo está vacío).
	let comunes: string[] | null = null;
	let pos = 0;
	for (const s of spans) {
		const a = pos;
		const b = pos + s.text.length;
		if (b > inicio && a < fin) {
			const m = s.marks ?? [];
			comunes = comunes === null ? [...m] : comunes.filter((x) => m.includes(x));
		}
		pos = b;
	}
	if (comunes === null) {
		pos = 0;
		for (const s of spans) {
			if (pos + s.text.length >= inicio) {
				comunes = [...(s.marks ?? [])];
				break;
			}
			pos += s.text.length;
		}
	}
	let insertado = false;
	pos = 0;
	for (const s of spans) {
		const a = pos;
		const b = pos + s.text.length;
		const marks = s.marks ?? [];
		if (b <= inicio || a >= fin) {
			if (a >= fin && !insertado) {
				trozos.push({ text: texto, marks: comunes ?? [], key: null });
				insertado = true;
			}
			trozos.push({ text: s.text, marks, key: tomarClave(s._key) });
		} else {
			if (a < inicio) trozos.push({ text: s.text.slice(0, inicio - a), marks, key: tomarClave(s._key) });
			if (!insertado) {
				trozos.push({ text: texto, marks: comunes ?? [], key: null });
				insertado = true;
			}
			if (b > fin) trozos.push({ text: s.text.slice(fin - a), marks, key: tomarClave(s._key) });
		}
		pos = b;
	}
	if (!insertado) trozos.push({ text: texto, marks: comunes ?? [], key: null });

	// Fundir trozos contiguos con las mismas marcas y quitar los vacíos.
	const out: PTSpan[] = [];
	for (const t of trozos) {
		if (!t.text) continue;
		const prev = out[out.length - 1];
		if (prev && JSON.stringify(prev.marks ?? []) === JSON.stringify(t.marks)) {
			prev.text += t.text;
			continue;
		}
		out.push({ _type: "span", _key: t.key ?? clave(), text: t.text, marks: [...t.marks] });
	}
	if (!out.length) out.push({ _type: "span", _key: spans[0]?._key ?? clave(), text: "", marks: [] });
	// Una clave no puede repetirse dentro del bloque.
	const vistas = new Set<string>();
	for (const s of out) {
		if (vistas.has(s._key)) s._key = clave();
		vistas.add(s._key);
	}
	return out;
}

/** Quita los markDefs que ya no usa ningún span. */
function podarDefs(defs: PTMarkDef[] | undefined, spans: PTSpan[]): PTMarkDef[] | undefined {
	if (!defs) return defs;
	const usadas = new Set(spans.flatMap((s) => s.marks ?? []));
	const r = defs.filter((d) => usadas.has(d._key));
	return r.length === defs.length ? defs : r;
}

/**
 * Sustitución literal del fragmento de un ancla por `texto` conservando las marcas de
 * alrededor. Devuelve null si el ancla no se resuelve o no es un fragmento con offsets
 * ni una unidad de texto.
 */
export function sustituirFragmento(doc: DocRevisable, ancla: Ancla, texto: string, ctx: Pick<ContextoOps, "terminosSensibles" | "nuevaClave"> = {}): ResultadoOps | null {
	const clave = ctx.nuevaClave ?? claveAleatoria;
	const extra = ctx.terminosSensibles ?? [];
	const r = resolverAncla(doc, ancla);
	if (r.estado === "huerfana") return null;
	const a = r.ancla;
	const numeros = new Set(referenciasDe(doc.referencias ?? "").map((x) => x.numero));
	const reemplazarTexto = (original: string) => {
		const ini = a.inicio ?? 0;
		const fin = a.fin ?? original.length;
		return original.slice(0, ini) + texto + original.slice(fin);
	};

	if (a.campo === "title" || a.campo === "excerpt") {
		const antes = a.campo === "title" ? doc.titulo : doc.extracto;
		const despues = reemplazarTexto(antes);
		const nuevoDoc = a.campo === "title" ? { ...doc, titulo: despues } : { ...doc, extracto: despues };
		return {
			doc: nuevoDoc,
			cambios: [
				{
					orden: 0,
					op: "campo",
					campo: a.campo,
					blockKey: null,
					trasKey: null,
					antes,
					despues,
					comentarioIds: [],
					avisos: [...detectarSensibles(antes, despues, extra), ...avisosDeReferencias(antes, despues, numeros, [], new Set())],
				},
			],
			rechazadas: [],
		};
	}

	if (a.campo === "references") {
		if (!a.ruta) return null;
		const lineas = (doc.referencias ?? "").split("\n");
		const k = lineas.findIndex((l) => l.match(/^\s*(\d+)\.\s+/)?.[1] === a.ruta);
		const linea = lineas[k];
		if (k < 0 || linea === undefined) return null;
		const pref = linea.match(/^\s*\d+\.\s+/)?.[0] ?? "";
		lineas[k] = pref + reemplazarTexto(linea.slice(pref.length));
		const antes = doc.referencias;
		const despues = lineas.join("\n");
		return {
			doc: { ...doc, referencias: despues },
			cambios: [{ orden: 0, op: "campo", campo: "references", blockKey: null, trasKey: null, antes, despues, comentarioIds: [], avisos: detectarSensibles(antes, despues, extra) }],
			rechazadas: [],
		};
	}

	// content
	const i = doc.content.findIndex((n) => n._key === a.blockKey);
	const actual = doc.content[i];
	if (i < 0 || !actual) return null;
	let nuevo: PTNode;
	if (esBloque(actual) && !a.ruta) {
		if (!esEditable(actual)) return null;
		const largo = textoDeBloque(actual).length;
		const children = sustituirEnSpans(actual.children, a.inicio ?? 0, a.fin ?? largo, texto, clave);
		nuevo = { ...actual, children };
		const defs = podarDefs(actual.markDefs, children);
		if (defs !== actual.markDefs) (nuevo as typeof actual).markDefs = defs;
	} else if (esTabla(actual) && a.ruta) {
		const celda = celdaDe(actual, a.ruta);
		if (!celda) return null;
		const [rk, ck] = a.ruta.split("/");
		const largo = celda.content.reduce((n, s) => n + (s.text?.length ?? 0), 0);
		const content = sustituirEnSpans(celda.content, a.inicio ?? 0, a.fin ?? largo, texto, clave);
		const defs = podarDefs(celda.markDefs, content);
		nuevo = {
			...actual,
			rows: actual.rows.map((f) =>
				f._key !== rk ? f : { ...f, cells: f.cells.map((c) => (c._key !== ck ? c : { ...c, content, ...(defs !== undefined ? { markDefs: defs } : {}) })) },
			),
		};
	} else if (esImagen(actual) && (a.ruta === "alt" || a.ruta === "caption")) {
		const original = typeof actual[a.ruta] === "string" ? (actual[a.ruta] as string) : "";
		nuevo = { ...actual, [a.ruta]: reemplazarTexto(original) };
	} else return null;

	const content = [...doc.content];
	content[i] = nuevo;
	const ta = a.ruta ? textoDeBloque(actual, a.ruta) : textoDeBloque(actual);
	const td = a.ruta ? textoDeBloque(nuevo, a.ruta) : textoDeBloque(nuevo);
	return {
		doc: { ...doc, content },
		cambios: [
			{
				orden: 0,
				op: "reemplazar",
				campo: "content",
				blockKey: actual._key,
				trasKey: doc.content[i - 1]?._key ?? null,
				antes: actual,
				despues: nuevo,
				comentarioIds: [],
				avisos: [...detectarSensibles(ta, td, extra), ...avisosDeReferencias(ta, td, numeros, [], new Set())],
			},
		],
		rechazadas: [],
	};
}

// ─── deshacerCambio ──────────────────────────────────────────────────────────

/**
 * Deshace un cambio sobre el documento actual: reemplazar → repone `antes`; insertar →
 * quita el bloque; eliminar → reinserta `antes` tras `trasKey` (o al principio); campo →
 * repone el texto. Devuelve null si ya no es aplicable (el texto actual no es el que
 * dejó el cambio).
 */
export function deshacerCambio(doc: DocRevisable, cambio: Pick<CambioDoc, "op" | "campo" | "blockKey" | "trasKey" | "antes" | "despues">): DocRevisable | null {
	const esNodo = (v: unknown): v is PTNode => !!v && typeof v === "object" && typeof (v as PTNode)._key === "string";
	switch (cambio.op) {
		case "reemplazar": {
			if (cambio.campo !== "content") return deshacerCampo(doc, cambio);
			const i = doc.content.findIndex((n) => n._key === cambio.blockKey);
			const actual = doc.content[i];
			if (i < 0 || !actual || !esNodo(cambio.antes) || !igualesSinClaves(actual, cambio.despues)) return null;
			const content = [...doc.content];
			content[i] = cambio.antes;
			return { ...doc, content };
		}
		case "insertar": {
			const i = doc.content.findIndex((n) => n._key === cambio.blockKey);
			const actual = doc.content[i];
			if (i < 0 || !actual || !igualesSinClaves(actual, cambio.despues)) return null;
			return { ...doc, content: doc.content.filter((_, k) => k !== i) };
		}
		case "eliminar": {
			if (!esNodo(cambio.antes)) return null;
			const antes = cambio.antes;
			if (doc.content.some((n) => n._key === antes._key)) return null;
			let pos = 0;
			if (cambio.trasKey) {
				const t = doc.content.findIndex((n) => n._key === cambio.trasKey);
				if (t < 0) return null;
				pos = t + 1;
			}
			const content = [...doc.content];
			content.splice(pos, 0, antes);
			return { ...doc, content };
		}
		case "campo":
			return deshacerCampo(doc, cambio);
		default:
			return null;
	}
}

function deshacerCampo(doc: DocRevisable, cambio: Pick<CambioDoc, "campo" | "antes" | "despues">): DocRevisable | null {
	if (typeof cambio.antes !== "string") return null;
	const prop = cambio.campo === "title" ? "titulo" : cambio.campo === "excerpt" ? "extracto" : cambio.campo === "references" ? "referencias" : null;
	if (!prop || doc[prop] !== cambio.despues) return null;
	return { ...doc, [prop]: cambio.antes };
}
