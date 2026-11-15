/**
 * Lista de comentarios del artículo: abiertos en orden de lectura, los que no
 * se pudieron colocar, y los resueltos plegados. Cada comentario se puede
 * editar, borrar, dar por resuelto, reabrir o, si propone un texto, aplicar
 * con «Cambiarlo ya».
 */

import * as React from "react";

import type { ComentarioVista } from "../lib/types.js";
import { fechaCorta } from "./comun.js";
import { Icono } from "./iconos.js";
import { T } from "./textos.js";

export interface AccionesComentario {
	onActivar: (c: ComentarioVista) => void;
	onEstado: (c: ComentarioVista, estado: "abierto" | "descartado") => Promise<void>;
	onBorrar: (c: ComentarioVista) => Promise<void>;
	onEditar: (c: ComentarioVista, texto: string, propuesto: string) => Promise<void>;
	onAplicar: (c: ComentarioVista) => Promise<void>;
}

export interface PropsPanel extends AccionesComentario {
	comentarios: ComentarioVista[];
	activo: string | null;
	/** Posición de lectura de cada comentario (para ordenar). */
	orden: Map<string, number>;
	/** «párrafo 12», «celda…», etc. */
	descripcion: (c: ComentarioVista) => string | null;
	huerfanos: Set<string>;
	filtro: string[] | null;
	onQuitarFiltro: () => void;
	onComentarGeneral: (origen: HTMLElement) => void;
	compositor: React.ReactNode;
	nivel?: 2 | 3;
	ocupado: boolean;
}

export function PanelComentarios(p: PropsPanel) {
	const H = p.nivel === 3 ? "h3" : "h2";
	const raiz = p.comentarios.filter((c) => !c.parentId);
	const respuestas = (id: string) => p.comentarios.filter((c) => c.parentId === id);
	const visibles = p.filtro ? raiz.filter((c) => p.filtro?.includes(c.id)) : raiz;
	const ord = (a: ComentarioVista, b: ComentarioVista) =>
		(p.orden.get(a.id) ?? 1e9) - (p.orden.get(b.id) ?? 1e9) || a.creado.localeCompare(b.creado);
	const abiertos = visibles.filter((c) => c.estado === "abierto" && !p.huerfanos.has(c.id)).sort(ord);
	const sinColocar = visibles.filter((c) => c.estado === "abierto" && p.huerfanos.has(c.id));
	const cerrados = visibles.filter((c) => c.estado !== "abierto").sort(ord);

	// El comentario activo se trae a la vista dentro del panel.
	React.useEffect(() => {
		if (!p.activo) return;
		document.getElementById(`rv-c-${p.activo}`)?.scrollIntoView({ block: "nearest" });
	}, [p.activo]);

	const lista = (cs: ComentarioVista[]) => (
		<ul className="rv-comentarios">
			{cs.map((c) => (
				<Comentario key={c.id} c={c} respuestas={respuestas(c.id)} p={p} />
			))}
		</ul>
	);

	return (
		<div className="rv-panel">
			{p.compositor}
			<div className="rv-cabecera">
				<H style={{ margin: 0 }}>{T.comentariosTitulo}</H>
				<button type="button" className="rv-btn rv-btn--peque" onClick={(e) => p.onComentarGeneral(e.currentTarget)}>
					<Icono nombre="comentario" tam={16} />
					{T.comentarioGeneral}
				</button>
			</div>
			{p.filtro ? (
				<div>
					<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={p.onQuitarFiltro}>
						{T.verTodos}
					</button>
				</div>
			) : null}
			{abiertos.length === 0 && sinColocar.length === 0 && cerrados.length === 0 ? (
				<p className="rv-ayuda" style={{ margin: 0 }}>
					{T.sinComentarios}
				</p>
			) : null}
			{abiertos.length ? lista(abiertos) : null}
			{sinColocar.length ? (
				<section aria-label={T.sinColocar} style={{ display: "grid", gap: "0.5rem" }}>
					<p style={{ margin: 0, fontWeight: 600 }}>{T.sinColocar}</p>
					<p className="rv-ayuda" style={{ margin: 0 }}>
						{T.sinColocarExplica}
					</p>
					{lista(sinColocar)}
				</section>
			) : null}
			{cerrados.length ? (
				<details>
					<summary style={{ cursor: "pointer", minHeight: "2.75rem", display: "flex", alignItems: "center" }}>
						{T.resueltos(cerrados.length)}
					</summary>
					{lista(cerrados)}
				</details>
			) : null}
		</div>
	);
}

function Comentario({ c, respuestas, p }: { c: ComentarioVista; respuestas: ComentarioVista[]; p: PropsPanel }) {
	const [editando, setEditando] = React.useState(false);
	const [borrando, setBorrando] = React.useState(false);
	const [texto, setTexto] = React.useState(c.texto);
	const [propuesto, setPropuesto] = React.useState(c.textoPropuesto ?? "");
	const idEd = React.useId();
	const activo = p.activo === c.id;
	const donde = p.descripcion(c);
	const cita = c.ancla?.cita;

	return (
		<li id={`rv-c-${c.id}`} className={`rv-comentario${activo ? " rv-comentario--activo" : ""}`}>
			<div className="rv-comentario__meta">
				{c.tipo === "pregunta" ? (
					<span className="rv-etiqueta rv-etiqueta--info">
						<Icono nombre="info" tam={14} />
						{T.pregunta}
					</span>
				) : null}
				<span>{c.autorNombre}</span>
				<span>{fechaCorta(c.creado)}</span>
				{c.estado !== "abierto" ? (
					<span className={`rv-etiqueta${c.estado === "aplicado" ? " rv-etiqueta--ok" : ""}`}>
						<Icono nombre="check" tam={14} />
						{T.estadoComentario[c.estado]}
					</span>
				) : null}
			</div>
			{donde || cita ? (
				<button
					type="button"
					className="rv-comentario__ir"
					aria-pressed={activo}
					onClick={() => p.onActivar(c)}
					aria-label={`${donde ?? ""}${cita ? `: «${cita}»` : ""}. Ir al texto`}
				>
					{donde ? <span className="rv-ayuda">{donde}</span> : null}
					{cita ? <blockquote className="rv-cita">{cita}</blockquote> : null}
				</button>
			) : null}
			{editando ? (
				<form
					style={{ display: "grid", gap: "0.5rem" }}
					onSubmit={(e) => {
						e.preventDefault();
						if (!texto.trim()) return;
						void p.onEditar(c, texto.trim(), propuesto.trim()).then(() => setEditando(false));
					}}
				>
					<label htmlFor={`${idEd}-t`} className="rv-etq">
						{T.formQue}
					</label>
					<textarea id={`${idEd}-t`} className="rv-input" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
					<label htmlFor={`${idEd}-p`} className="rv-etq">
						{T.formPropuesto}
					</label>
					<textarea
						id={`${idEd}-p`}
						className="rv-input"
						style={{ minHeight: "3.5rem" }}
						value={propuesto}
						onChange={(e) => setPropuesto(e.target.value)}
					/>
					<div className="rv-acciones">
						<button type="submit" className="rv-btn rv-btn--principal rv-btn--peque" disabled={p.ocupado}>
							{T.guardar}
						</button>
						<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={() => setEditando(false)}>
							{T.cancelar}
						</button>
					</div>
				</form>
			) : (
				<>
					<p>{c.texto}</p>
					{c.textoPropuesto ? (
						<p>
							<span className="rv-ayuda">{T.propone} </span>«{c.textoPropuesto}»
						</p>
					) : null}
					{c.respuestaIA ? (
						<p>
							<span className="rv-ayuda">{T.respuestaDe} </span>
							{c.respuestaIA}
						</p>
					) : null}
				</>
			)}
			{respuestas.length ? (
				<ul className="rv-respuestas">
					{respuestas.map((r) => (
						<li key={r.id}>
							<span className="rv-ayuda">
								{r.autorNombre} · {fechaCorta(r.creado)}
							</span>
							<p>{r.texto}</p>
						</li>
					))}
				</ul>
			) : null}
			{borrando ? (
				<div className="rv-acciones" role="group" aria-label={T.confirmarBorrar}>
					<span>{T.confirmarBorrar}</span>
					<button
						type="button"
						className="rv-btn rv-btn--peligro rv-btn--peque"
						disabled={p.ocupado}
						onClick={() => void p.onBorrar(c)}
						autoFocus
					>
						{T.borrarSi}
					</button>
					<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={() => setBorrando(false)}>
						{T.cancelar}
					</button>
				</div>
			) : !editando ? (
				<div className="rv-acciones">
					{c.estado === "abierto" && c.textoPropuesto && c.ancla ? (
						<button type="button" className="rv-btn rv-btn--peque" disabled={p.ocupado} onClick={() => void p.onAplicar(c)}>
							{T.cambiarloYa}
						</button>
					) : null}
					{c.estado === "abierto" ? (
						<button
							type="button"
							className="rv-btn rv-btn--plano rv-btn--peque"
							disabled={p.ocupado}
							onClick={() => void p.onEstado(c, "descartado")}
						>
							{T.darPorResuelto}
						</button>
					) : (
						<button
							type="button"
							className="rv-btn rv-btn--plano rv-btn--peque"
							disabled={p.ocupado}
							onClick={() => void p.onEstado(c, "abierto")}
						>
							{T.reabrir}
						</button>
					)}
					{c.editable ? (
						<>
							<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={() => setEditando(true)}>
								{T.editar}
							</button>
							<button type="button" className="rv-btn rv-btn--plano rv-btn--peque rv-btn--peligro" onClick={() => setBorrando(true)}>
								{T.borrar}
							</button>
						</>
					) : null}
				</div>
			) : null}
		</li>
	);
}
