/**
 * Lector: pinta el documento revisable como se leerá publicado.
 *
 * - Cada unidad comentable conserva su elemento semántico (`p`, `h2`, `li`,
 *   `td`, `figure`…), lleva `data-rv-unidad` y contiene un `<button>`
 *   «Comentar» con `aria-label`. Una sola parada de tabulador entre esos
 *   botones; las flechas mueven el foco.
 * - El texto se pinta sin transformar: cada trozo de span va en un
 *   `[data-rv-t]`, y solo esos nodos cuentan para los offsets del ancla. Las
 *   marcas de comentario parten trozos pero no cambian el texto.
 * - Los enlaces no navegan; junto a ellos hay un «Abrir enlace» (solo
 *   http, https, mailto y relativos).
 */

import * as React from "react";

import { referenciasDe, tipoDeBloque } from "../lib/bloques.js";
import type {
	CambioVista,
	ComentarioVista,
	DocRevisable,
	PTBlock,
	PTImage,
	PTMarkDef,
	PTNode,
	PTSpan,
	PTTable,
} from "../lib/types.js";
import { Icono } from "./iconos.js";
import {
	hrefSeguro,
	idUnidad,
	type RangoMarca,
	type RefUnidad,
	seleccionAOffsets,
	trocearSpans,
} from "./logica.js";
import { T } from "./textos.js";

// ─── Contexto ────────────────────────────────────────────────────────────────

export interface MarcasUnidad {
	comentarios: ComentarioVista[];
	rangos: RangoMarca[];
	/** El comentario activo está en esta unidad. */
	activa: boolean;
	/** El comentario activo es de la unidad entera (sin fragmento). */
	entera: boolean;
}

export interface SeleccionLector {
	ref: RefUnidad;
	inicio: number;
	fin: number;
	cita: string;
	recortada: boolean;
}

interface ContextoLectorValor {
	soloLectura: boolean;
	marcas: Map<string, MarcasUnidad>;
	marcada: string | null;
	foco: string | null;
	setFoco: (id: string) => void;
	onComentar: (ref: RefUnidad, origen: HTMLElement) => void;
	onVerComentarios: (unidad: string, origen: HTMLElement) => void;
	cambiosPorBloque: Map<string, CambioVista>;
	eliminadosTras: Map<string, CambioVista[]>;
	cambiosCampo: Map<string, CambioVista>;
	renderCambio: (c: CambioVista) => React.ReactNode;
}

const vacio = new Map();
const ContextoLector = React.createContext<ContextoLectorValor>({
	soloLectura: true,
	marcas: vacio,
	marcada: null,
	foco: null,
	setFoco: () => {},
	onComentar: () => {},
	onVerComentarios: () => {},
	cambiosPorBloque: vacio,
	eliminadosTras: vacio,
	cambiosCampo: vacio,
	renderCambio: () => null,
});

const PRIMERA_UNIDAD = idUnidad({ campo: "title" });

// ─── Texto con marcas ────────────────────────────────────────────────────────

const MARCAS_SIMPLES: Record<string, "strong" | "em" | "code" | "u" | "s"> = {
	strong: "strong",
	em: "em",
	code: "code",
	underline: "u",
	"strike-through": "s",
};

function enlaceDe(span: PTSpan | undefined, defs: PTMarkDef[]): PTMarkDef | null {
	if (!span?.marks) return null;
	for (const m of span.marks) {
		const def = defs.find((d) => d._key === m);
		if (def && def._type === "link") return def;
	}
	return null;
}

/** Pinta spans sin alterar su texto, partidos según las marcas de la unidad. */
export function TextoSpans({ spans, markDefs = [], unidad }: { spans: PTSpan[]; markDefs?: PTMarkDef[]; unidad?: string }) {
	const ctx = React.useContext(ContextoLector);
	const rangos = unidad ? (ctx.marcas.get(unidad)?.rangos ?? []) : [];
	const trozos = trocearSpans(
		spans.map((s) => s.text ?? ""),
		rangos,
	);
	return (
		<>
			{trozos.map((t, i) => {
				const span = spans[t.span];
				let contenido: React.ReactNode = t.texto;
				for (const m of span?.marks ?? []) {
					const Tag = MARCAS_SIMPLES[m];
					if (Tag) contenido = <Tag>{contenido}</Tag>;
				}
				const enlace = enlaceDe(span, markDefs);
				if (enlace) contenido = <span className="rv-enlace">{contenido}</span>;
				const clase = t.activo ? "rv-frag rv-frag--activo" : t.frag ? "rv-frag" : undefined;
				// «Abrir enlace» tras el último trozo del enlace.
				const siguiente = trozos[i + 1];
				const finDeEnlace =
					enlace &&
					(!siguiente || (siguiente.span !== t.span && enlaceDe(spans[siguiente.span], markDefs)?._key !== enlace._key));
				let abrir: React.ReactNode = null;
				if (finDeEnlace) {
					let texto = "";
					for (let j = t.span; j >= 0 && enlaceDe(spans[j], markDefs)?._key === enlace._key; j--) texto = (spans[j]?.text ?? "") + texto;
					const href = hrefSeguro(enlace.href);
					abrir = href ? (
						<a className="rv-abrir-enlace" href={href} target="_blank" rel="noopener noreferrer" aria-label={T.abrirEnlace(texto.trim())}>
							<Icono nombre="externo" tam={14} />
						</a>
					) : (
						<span className="rv-abrir-enlace" title={T.enlaceNoValido} role="img" aria-label={T.enlaceNoValido}>
							<Icono nombre="alerta" tam={14} />
						</span>
					);
				}
				return (
					<React.Fragment key={i}>
						<span data-rv-t="" className={clase}>
							{contenido}
						</span>
						{abrir}
					</React.Fragment>
				);
			})}
		</>
	);
}

function TextoPlano({ texto, unidad }: { texto: string; unidad: string }) {
	return <TextoSpans spans={[{ _type: "span", _key: "t", text: texto }]} unidad={unidad} />;
}

// ─── Unidad comentable ───────────────────────────────────────────────────────

type Etiqueta = keyof React.JSX.IntrinsicElements;

function Unidad({
	como,
	refU,
	etiqueta,
	donde,
	className,
	bloque,
	children,
	extra,
}: {
	como: Etiqueta;
	refU: RefUnidad;
	/** aria-label del botón: «Comentar párrafo 12». */
	etiqueta: string;
	/** Para el contador: «este párrafo». */
	donde: string;
	className?: string;
	/** Clave del bloque de primer nivel, para el progreso de lectura. */
	bloque?: string;
	children: React.ReactNode;
	extra?: Record<string, unknown>;
}) {
	const ctx = React.useContext(ContextoLector);
	const Tag = como as React.ElementType;
	if (ctx.soloLectura) {
		return (
			<Tag className={className} {...extra}>
				{children}
			</Tag>
		);
	}
	const id = idUnidad(refU);
	const m = ctx.marcas.get(id);
	const n = m?.comentarios.length ?? 0;
	const clases = [
		"rv-u",
		n > 0 ? "rv-u--comentada" : "",
		m?.activa ? "rv-u--activa" : "",
		m?.activa && m.entera ? "rv-u--entera" : "",
		ctx.marcada === id ? "rv-u--marcada" : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");
	const esFoco = ctx.foco ? ctx.foco === id : id === PRIMERA_UNIDAD;
	return (
		<Tag
			className={clases}
			data-rv-unidad={id}
			data-campo={refU.campo}
			data-block-key={refU.blockKey}
			data-ruta={refU.ruta}
			data-rv-bloque={bloque}
			{...extra}
		>
			{children}
			<span className="rv-margen">
				<button
					type="button"
					className="rv-comentar"
					aria-label={etiqueta}
					title={T.comentar}
					tabIndex={esFoco ? 0 : -1}
					onFocus={() => ctx.setFoco(id)}
					onClick={(e) => ctx.onComentar(refU, e.currentTarget)}
				>
					<Icono nombre="comentario" />
				</button>
				{n > 0 ? (
					<button
						type="button"
						className="rv-contador"
						aria-label={T.contador(n, donde)}
						aria-pressed={!!m?.activa}
						onClick={(e) => ctx.onVerComentarios(id, e.currentTarget)}
					>
						{n}
					</button>
				) : null}
			</span>
		</Tag>
	);
}

// ─── Bloques ─────────────────────────────────────────────────────────────────

const ESTILOS_TITULO = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function esBloque(n: PTNode): n is PTBlock {
	return n._type === "block" && Array.isArray((n as PTBlock).children);
}
export function esTabla(n: PTNode): n is PTTable {
	return n._type === "table" && Array.isArray((n as PTTable).rows);
}
export function esImagen(n: PTNode): n is PTImage {
	return n._type === "image";
}

export interface Numeracion {
	tipo: string;
	n: number;
}

export function nombreTipo(tipo: string): string {
	switch (tipo) {
		case "parrafo":
			return T.tipoParrafo;
		case "titulo":
			return T.tipoTitulo;
		case "lista":
			return T.tipoLista;
		case "cita":
			return T.tipoCita;
		case "tabla":
			return T.tipoTabla;
		case "imagen":
			return T.tipoImagen;
		default:
			return T.tipoOtro;
	}
}

function BloqueTexto({ node, num }: { node: PTBlock; num: Numeracion }) {
	const refU: RefUnidad = { campo: "content", blockKey: node._key };
	const unidad = idUnidad(refU);
	const nombre = nombreTipo(num.tipo);
	const style = node.style ?? "normal";
	let como: Etiqueta = "p";
	if (node.listItem) como = "li";
	else if (ESTILOS_TITULO.has(style)) como = (style === "h1" ? "h2" : style) as Etiqueta;
	else if (style === "blockquote") como = "blockquote";
	return (
		<Unidad
			como={como}
			refU={refU}
			etiqueta={T.comentarUnidad(nombre, num.n)}
			donde={T.dondeEste(nombre)}
			bloque={node._key}
		>
			<TextoSpans spans={node.children ?? []} markDefs={node.markDefs ?? []} unidad={unidad} />
		</Unidad>
	);
}

function BloqueTabla({ node, num }: { node: PTTable; num: Numeracion }) {
	const ctx = React.useContext(ContextoLector);
	const refU: RefUnidad = { campo: "content", blockKey: node._key };
	return (
		<Unidad
			como="div"
			refU={refU}
			etiqueta={T.comentarUnidad(T.tipoTabla, num.n)}
			donde={T.dondeEste(T.tipoTabla)}
			bloque={node._key}
		>
			<div className="rv-tabla" role="region" aria-label={T.tablaNombre(num.n)} tabIndex={0}>
				<table>
					<tbody>
						{node.rows.map((fila, i) => (
							<tr key={fila._key || i}>
								{fila.cells.map((celda, j) => {
									const cab = celda.isHeader || (node.hasHeaderRow && i === 0);
									const ruta = `${fila._key}/${celda._key}`;
									const ru: RefUnidad = { campo: "content", blockKey: node._key, ruta };
									const contenido = (
										<TextoSpans spans={celda.content ?? []} markDefs={celda.markDefs ?? []} unidad={idUnidad(ru)} />
									);
									if (ctx.soloLectura) {
										return cab ? <th key={celda._key || j} scope="col">{contenido}</th> : <td key={celda._key || j}>{contenido}</td>;
									}
									return (
										<Unidad
											key={celda._key || j}
											como={cab ? "th" : "td"}
											refU={ru}
											etiqueta={T.comentarUnidad(T.tipoCelda(i + 1, j + 1), null)}
											donde={`esta celda`}
											extra={cab ? { scope: "col" } : undefined}
										>
											{contenido}
										</Unidad>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Unidad>
	);
}

function BloqueImagen({ node, num }: { node: PTImage; num: Numeracion }) {
	const refU: RefUnidad = { campo: "content", blockKey: node._key };
	const src = hrefSeguro(node.asset?.url, false);
	const alt = typeof node.alt === "string" ? node.alt : "";
	const pie = typeof node.caption === "string" ? node.caption : "";
	const refAlt: RefUnidad = { ...refU, ruta: "alt" };
	const refPie: RefUnidad = { ...refU, ruta: "caption" };
	return (
		<Unidad
			como="figure"
			refU={refU}
			className="rv-figura"
			etiqueta={T.comentarUnidad(T.tipoImagen, num.n)}
			donde={T.dondeEste(T.tipoImagen)}
			bloque={node._key}
		>
			{src ? (
				<img
					src={src}
					alt={alt}
					width={typeof node.width === "number" ? node.width : undefined}
					height={typeof node.height === "number" ? node.height : undefined}
					loading="lazy"
				/>
			) : null}
			<div className="rv-figura__textos">
				<Unidad como="p" refU={refAlt} etiqueta={T.comentarUnidad(T.tipoAlt, num.n)} donde={T.dondeEste(T.tipoAlt)}>
					<span className="rv-etq">{T.textoAlternativo} </span>
					{alt ? <TextoPlano texto={alt} unidad={idUnidad(refAlt)} /> : <em>{T.sinTextoAlternativo}</em>}
				</Unidad>
				{pie ? (
					<Unidad como="figcaption" refU={refPie} etiqueta={T.comentarUnidad(T.tipoPie, num.n)} donde={T.dondeEste(T.tipoPie)}>
						<span className="rv-etq">{T.pieImagen} </span>
						<TextoPlano texto={pie} unidad={idUnidad(refPie)} />
					</Unidad>
				) : null}
			</div>
		</Unidad>
	);
}

function BloqueOtro({ node, num }: { node: PTNode; num: Numeracion }) {
	const refU: RefUnidad = { campo: "content", blockKey: node._key };
	return (
		<Unidad
			como="div"
			refU={refU}
			className="rv-desconocido"
			etiqueta={T.comentarUnidad(T.tipoOtro, num.n)}
			donde={T.dondeEste(T.tipoOtro)}
			bloque={node._key}
		>
			<p style={{ margin: 0 }}>{T.bloqueDesconocido(node._type)}</p>
		</Unidad>
	);
}

/** Un bloque de primer nivel (o un elemento de lista), o su tarjeta de cambio. */
function Nodo({ node, num }: { node: PTNode; num: Numeracion }) {
	const ctx = React.useContext(ContextoLector);
	const cambio = ctx.soloLectura ? undefined : ctx.cambiosPorBloque.get(node._key);
	if (cambio) return <>{ctx.renderCambio(cambio)}</>;
	if (esBloque(node)) return <BloqueTexto node={node} num={num} />;
	if (esTabla(node)) return <BloqueTabla node={node} num={num} />;
	if (esImagen(node)) return <BloqueImagen node={node} num={num} />;
	return <BloqueOtro node={node} num={num} />;
}

function Eliminados({ tras }: { tras: string }) {
	const ctx = React.useContext(ContextoLector);
	if (ctx.soloLectura) return null;
	const lista = ctx.eliminadosTras.get(tras);
	if (!lista?.length) return null;
	return <>{lista.map((c) => <React.Fragment key={c.id}>{ctx.renderCambio(c)}</React.Fragment>)}</>;
}

// ─── Listas anidadas ─────────────────────────────────────────────────────────

interface ItemLista {
	node: PTBlock;
	hijos: Lista[];
}
interface Lista {
	tipo: "bullet" | "number";
	items: ItemLista[];
}

function construirListas(bs: PTBlock[], nivel: number): { listas: Lista[]; consumidos: number } {
	const out: Lista[] = [];
	let i = 0;
	while (i < bs.length) {
		const b = bs[i] as PTBlock;
		const lv = b.level ?? 1;
		if (lv < nivel) break;
		if (lv > nivel) {
			const sub = construirListas(bs.slice(i), lv);
			const ultimo = out.at(-1)?.items.at(-1);
			if (ultimo) ultimo.hijos.push(...sub.listas);
			else out.push(...sub.listas);
			i += Math.max(1, sub.consumidos);
			continue;
		}
		const tipo = b.listItem ?? "bullet";
		let actual = out.at(-1);
		if (!actual || actual.tipo !== tipo) {
			actual = { tipo, items: [] };
			out.push(actual);
		}
		actual.items.push({ node: b, hijos: [] });
		i++;
	}
	return { listas: out, consumidos: i };
}

function PintarListas({ listas, numeros }: { listas: Lista[]; numeros: Map<string, Numeracion> }) {
	return (
		<>
			{listas.map((l, i) => {
				const Tag = l.tipo === "number" ? "ol" : "ul";
				return (
					<Tag key={l.items[0]?.node._key ?? i}>
						{l.items.map((it) => (
							<ItemDeLista key={it.node._key} item={it} numeros={numeros} />
						))}
					</Tag>
				);
			})}
		</>
	);
}

function ItemDeLista({ item, numeros }: { item: ItemLista; numeros: Map<string, Numeracion> }) {
	const ctx = React.useContext(ContextoLector);
	const num = numeros.get(item.node._key) ?? { tipo: "lista", n: 0 };
	const cambio = ctx.soloLectura ? undefined : ctx.cambiosPorBloque.get(item.node._key);
	const elim = ctx.soloLectura ? undefined : ctx.eliminadosTras.get(item.node._key);
	const hijos = item.hijos.length ? <PintarListas listas={item.hijos} numeros={numeros} /> : null;
	if (cambio || item.hijos.length || elim?.length) {
		// El cambio va dentro de su propio elemento de lista.
		return (
			<>
				{cambio ? <li style={{ listStyle: "none" }}>{ctx.renderCambio(cambio)}{hijos}</li> : <BloqueTextoConHijos item={item} num={num} hijos={hijos} />}
				{elim?.length ? (
					<li style={{ listStyle: "none" }}>
						<Eliminados tras={item.node._key} />
					</li>
				) : null}
			</>
		);
	}
	return <BloqueTexto node={item.node} num={num} />;
}

function BloqueTextoConHijos({ item, num, hijos }: { item: ItemLista; num: Numeracion; hijos: React.ReactNode }) {
	const refU: RefUnidad = { campo: "content", blockKey: item.node._key };
	const nombre = nombreTipo(num.tipo);
	return (
		<Unidad como="li" refU={refU} etiqueta={T.comentarUnidad(nombre, num.n)} donde={T.dondeEste(nombre)} bloque={item.node._key}>
			<TextoSpans spans={item.node.children ?? []} markDefs={item.node.markDefs ?? []} unidad={idUnidad(refU)} />
			{hijos}
		</Unidad>
	);
}

// ─── Contenido completo ──────────────────────────────────────────────────────

type Tramo = { tipo: "nodo"; node: PTNode } | { tipo: "lista"; nodos: PTBlock[] };

function tramos(content: PTNode[]): Tramo[] {
	const out: Tramo[] = [];
	for (const n of content) {
		if (esBloque(n) && n.listItem) {
			const ult = out.at(-1);
			if (ult?.tipo === "lista") ult.nodos.push(n);
			else out.push({ tipo: "lista", nodos: [n] });
		} else out.push({ tipo: "nodo", node: n });
	}
	return out;
}

export function numerar(content: PTNode[]): Map<string, Numeracion> {
	const cuenta = new Map<string, number>();
	const m = new Map<string, Numeracion>();
	for (const n of content) {
		let tipo = "otro";
		try {
			tipo = tipoDeBloque(n);
		} catch {
			/* tipo desconocido */
		}
		const k = (cuenta.get(tipo) ?? 0) + 1;
		cuenta.set(tipo, k);
		m.set(n._key, { tipo, n: k });
	}
	return m;
}

export function Contenido({ content }: { content: PTNode[] }) {
	const numeros = React.useMemo(() => numerar(content), [content]);
	return (
		<>
			<Eliminados tras="" />
			{tramos(content).map((t) => {
				if (t.tipo === "lista") {
					const { listas } = construirListas(t.nodos, Math.min(...t.nodos.map((b) => b.level ?? 1)));
					return <PintarListas key={`l-${t.nodos[0]?._key}`} listas={listas} numeros={numeros} />;
				}
				const num = numeros.get(t.node._key) ?? { tipo: "otro", n: 0 };
				return (
					<React.Fragment key={t.node._key}>
						<Nodo node={t.node} num={num} />
						<Eliminados tras={t.node._key} />
					</React.Fragment>
				);
			})}
		</>
	);
}

/** Pinta un bloque suelto sin controles (original de un cambio, párrafo nuevo…). */
export function BloqueSoloLectura({ node }: { node: PTNode }) {
	const valor = React.useContext(ContextoLector);
	const soloLectura = React.useMemo(() => ({ ...valor, soloLectura: true }), [valor]);
	let contenido: React.ReactNode;
	if (esBloque(node) && node.listItem) {
		const Tag = node.listItem === "number" ? "ol" : "ul";
		contenido = (
			<Tag>
				<BloqueTexto node={node} num={{ tipo: "lista", n: 0 }} />
			</Tag>
		);
	} else contenido = <Nodo node={node} num={{ tipo: tipoSeguro(node), n: 0 }} />;
	return <ContextoLector.Provider value={soloLectura}>{contenido}</ContextoLector.Provider>;
}

function tipoSeguro(n: PTNode): string {
	try {
		return tipoDeBloque(n);
	} catch {
		return "otro";
	}
}

// ─── Selección de texto → offsets ────────────────────────────────────────────

function textosDeUnidad(unidad: Element): Text[] {
	const out: Text[] = [];
	const w = document.createTreeWalker(unidad, NodeFilter.SHOW_TEXT);
	for (let n = w.nextNode(); n; n = w.nextNode()) {
		const p = n.parentElement;
		if (p?.closest("[data-rv-t]") && p.closest("[data-rv-unidad]") === unidad) out.push(n as Text);
	}
	return out;
}

function puntoEnTextos(textos: Text[], contenedor: Node, offset: number): { indice: number; offset: number } {
	const i = textos.indexOf(contenedor as Text);
	if (i >= 0) return { indice: i, offset };
	const r = document.createRange();
	r.setStart(contenedor, offset);
	r.collapse(true);
	for (let j = 0; j < textos.length; j++) {
		const t = textos[j] as Text;
		if (r.comparePoint(t, 0) >= 0) return { indice: j, offset: 0 };
	}
	const ultimo = textos.length - 1;
	return { indice: ultimo, offset: textos[ultimo]?.length ?? 0 };
}

function refDeElemento(el: Element): RefUnidad | null {
	const campo = el.getAttribute("data-campo");
	if (campo !== "content" && campo !== "title" && campo !== "excerpt" && campo !== "references") return null;
	const ref: RefUnidad = { campo };
	const k = el.getAttribute("data-block-key");
	const r = el.getAttribute("data-ruta");
	if (k) ref.blockKey = k;
	if (r) ref.ruta = r;
	return ref;
}

/** Lee la selección actual si está dentro del papel; se recorta a la primera unidad. */
export function leerSeleccion(papel: Element): SeleccionLector | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const r = sel.getRangeAt(0);
	if (!papel.contains(r.commonAncestorContainer)) return null;
	const inicioEl = r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement;
	let unidad = inicioEl?.closest("[data-rv-unidad]") ?? null;
	if (!unidad || !papel.contains(unidad)) {
		// La selección empieza entre bloques: primera unidad tocada.
		unidad = Array.from(papel.querySelectorAll("[data-rv-unidad]")).find((u) => r.intersectsNode(u)) ?? null;
	}
	if (!unidad) return null;
	const ref = refDeElemento(unidad);
	const textos = textosDeUnidad(unidad);
	if (!ref || textos.length === 0) return null;
	const ini = unidad.contains(r.startContainer) ? puntoEnTextos(textos, r.startContainer, r.startOffset) : { indice: 0, offset: 0 };
	let recortada = false;
	let fin: { indice: number; offset: number };
	if (unidad.contains(r.endContainer)) fin = puntoEnTextos(textos, r.endContainer, r.endOffset);
	else {
		recortada = true;
		const u = textos.length - 1;
		fin = { indice: u, offset: textos[u]?.length ?? 0 };
	}
	const res = seleccionAOffsets(
		textos.map((t) => t.data),
		ini,
		fin,
	);
	return res ? { ref, ...res, recortada } : null;
}

// ─── Lector ──────────────────────────────────────────────────────────────────

export interface PropsLector {
	doc: DocRevisable;
	portada: { url: string; alt: string } | null;
	marcas: Map<string, MarcasUnidad>;
	marcada: string | null;
	onMarcar: (unidad: string | null) => void;
	onComentar: (ref: RefUnidad, origen: HTMLElement) => void;
	onComentarSeleccion: (s: SeleccionLector, origen: HTMLElement) => void;
	onVerComentarios: (unidad: string, origen: HTMLElement) => void;
	cambiosPorBloque: Map<string, CambioVista>;
	eliminadosTras: Map<string, CambioVista[]>;
	cambiosCampo: Map<string, CambioVista>;
	renderCambio: (c: CambioVista) => React.ReactNode;
	/** Atajos opcionales (solo con el foco en el lector). */
	onTecla?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
	antes?: React.ReactNode;
	papelRef?: React.RefObject<HTMLDivElement | null>;
	estilo?: React.CSSProperties;
	className?: string;
}

export function Lector(p: PropsLector) {
	const propio = React.useRef<HTMLDivElement>(null);
	const papel = p.papelRef ?? propio;
	const [foco, setFoco] = React.useState<string | null>(null);
	const [pildora, setPildora] = React.useState<{ x: number; y: number } | null>(null);
	const toque = React.useRef<{ x: number; y: number; t: number } | null>(null);

	const valor = React.useMemo<ContextoLectorValor>(
		() => ({
			soloLectura: false,
			marcas: p.marcas,
			marcada: p.marcada,
			foco,
			setFoco,
			onComentar: p.onComentar,
			onVerComentarios: p.onVerComentarios,
			cambiosPorBloque: p.cambiosPorBloque,
			eliminadosTras: p.eliminadosTras,
			cambiosCampo: p.cambiosCampo,
			renderCambio: p.renderCambio,
		}),
		[p.marcas, p.marcada, foco, p.onComentar, p.onVerComentarios, p.cambiosPorBloque, p.eliminadosTras, p.cambiosCampo, p.renderCambio],
	);

	// Píldora «Comentar» al seleccionar texto con ratón o trackpad.
	React.useEffect(() => {
		let fino = false;
		try {
			fino = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
		} catch {
			/* sin matchMedia */
		}
		if (!fino) return;
		const alCambiar = () => {
			const el = papel.current;
			const sel = window.getSelection();
			if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
				setPildora(null);
				return;
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			const base = el.getBoundingClientRect();
			setPildora({ x: rect.left + rect.width / 2 - base.left, y: rect.top - base.top });
		};
		document.addEventListener("selectionchange", alCambiar);
		return () => document.removeEventListener("selectionchange", alCambiar);
	}, [papel]);

	const teclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const t = e.target as HTMLElement;
		if (t.classList.contains("rv-comentar") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
			const botones = Array.from(papel.current?.querySelectorAll<HTMLButtonElement>("button.rv-comentar") ?? []);
			const i = botones.indexOf(t as HTMLButtonElement);
			const destino =
				e.key === "Home" ? botones[0] : e.key === "End" ? botones.at(-1) : botones[i + (e.key === "ArrowDown" ? 1 : -1)];
			if (destino) {
				e.preventDefault();
				destino.focus();
				destino.closest("[data-rv-unidad]")?.scrollIntoView({ block: "nearest" });
			}
			return;
		}
		p.onTecla?.(e);
	};

	const alPulsar = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "touch") return;
		toque.current = { x: e.clientX, y: e.clientY, t: Date.now() };
	};
	const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "touch" || !toque.current) return;
		const t = toque.current;
		toque.current = null;
		const movido = Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10;
		if (movido || Date.now() - t.t > 600) return; // un desplazamiento o una pulsación larga no cuentan
		const destino = e.target as HTMLElement;
		if (destino.closest("button, a, input, textarea, select, summary")) return;
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) return;
		const u = destino.closest("[data-rv-unidad]");
		p.onMarcar(u ? u.getAttribute("data-rv-unidad") : null);
	};

	const refTitulo: RefUnidad = { campo: "title" };
	const refExtracto: RefUnidad = { campo: "excerpt" };
	const referencias = React.useMemo(() => {
		try {
			return referenciasDe(p.doc.referencias ?? "");
		} catch {
			return [];
		}
	}, [p.doc.referencias]);
	const cambioTitulo = p.cambiosCampo.get("title");
	const cambioExtracto = p.cambiosCampo.get("excerpt");

	return (
		<ContextoLector.Provider value={valor}>
			<div
				ref={papel}
				className={`rv-paper${p.className ? ` ${p.className}` : ""}`}
				style={p.estilo}
				onKeyDown={teclas}
				onPointerDown={alPulsar}
				onPointerUp={alSoltar}
				onPointerCancel={() => {
					toque.current = null;
				}}
			>
				<div className="rv-paper__col">
					{p.antes}
					{cambioTitulo ? (
						p.renderCambio(cambioTitulo)
					) : (
						<Unidad
							como="h1"
							refU={refTitulo}
							etiqueta={T.comentarUnidad(T.tipoTituloArticulo, null)}
							donde={T.tipoTituloArticulo}
						>
							<TextoPlano texto={p.doc.titulo} unidad={idUnidad(refTitulo)} />
						</Unidad>
					)}
					{cambioExtracto ? (
						p.renderCambio(cambioExtracto)
					) : p.doc.extracto ? (
						<Unidad
							como="p"
							refU={refExtracto}
							className="rv-extracto"
							etiqueta={T.comentarUnidad(T.tipoExtracto, null)}
							donde={T.tipoExtracto}
						>
							<span className="rv-etq-campo">{T.extracto}</span>
							<TextoPlano texto={p.doc.extracto} unidad={idUnidad(refExtracto)} />
						</Unidad>
					) : null}
					{p.portada ? (
						<figure className="rv-portada">
							{hrefSeguro(p.portada.url, false) ? <img src={hrefSeguro(p.portada.url, false) ?? ""} alt={p.portada.alt} /> : null}
						</figure>
					) : null}
					{p.doc.content.length === 0 ? <p>{T.articuloVacio}</p> : <Contenido content={p.doc.content} />}
					{referencias.length ? (
						<section className="rv-referencias" aria-labelledby="rv-fuentes">
							<h2 id="rv-fuentes">{T.referencias}</h2>
							<ol>
								{referencias.map((r) => {
									const ru: RefUnidad = { campo: "references", ruta: r.numero };
									return (
										<Unidad
											key={r.numero}
											como="li"
											refU={ru}
											etiqueta={T.comentarUnidad(T.tipoReferencia, Number(r.numero) || null)}
											donde={T.dondeEste(T.tipoReferencia)}
											extra={{ value: Number(r.numero) || undefined }}
										>
											<TextoPlano texto={r.texto} unidad={idUnidad(ru)} />
										</Unidad>
									);
								})}
							</ol>
						</section>
					) : null}
					<p className="rv-fin" data-rv-fin="">
						{T.finArticulo}
					</p>
				</div>
				{pildora ? (
					<button
						type="button"
						className="rv-btn rv-btn--principal rv-btn--peque rv-pildora"
						style={{ left: pildora.x, top: pildora.y }}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							const el = papel.current;
							const s = el ? leerSeleccion(el) : null;
							setPildora(null);
							if (!s || !el) return;
							// La píldora desaparece: el foco volverá al botón «Comentar» de la unidad.
							const boton = Array.from(el.querySelectorAll<HTMLElement>("[data-rv-unidad]"))
								.find((u) => u.getAttribute("data-rv-unidad") === idUnidad(s.ref))
								?.querySelector<HTMLElement>(":scope > .rv-margen > .rv-comentar");
							p.onComentarSeleccion(s, boton ?? el);
						}}
					>
						<Icono nombre="comentario" tam={16} />
						{T.pildoraComentar}
					</button>
				) : null}
			</div>
		</ContextoLector.Provider>
	);
}
