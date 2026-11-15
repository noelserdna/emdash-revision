/**
 * Formulario para comentar una unidad (o un fragmento, o el artículo entero).
 * El borrador se guarda en el dispositivo a cada cambio y sobrevive a una
 * sesión caducada.
 */

import * as React from "react";

import { anclaDeFragmento, crearAncla } from "../lib/anclas.js";
import type { Ancla, ArticuloVista, ComentarioVista, DocRevisable, RevisionDoc } from "../lib/types.js";
import { api, esSesionCaducada } from "./api.js";
import { AvisoError } from "./comun.js";
import { idUnidad, type RefUnidad } from "./logica.js";
import { borrarBorrador, guardarBorrador } from "./navegacion.js";
import { T } from "./textos.js";

export interface Objetivo {
	/** null = comentario sobre todo el artículo. */
	ref: RefUnidad | null;
	inicio?: number;
	fin?: number;
	/** Texto seleccionado, si lo hay. */
	cita?: string;
	/** Descripción legible: «párrafo 12». */
	descripcion: string;
}

export interface PropsCompositor {
	collection: string;
	id: string;
	doc: DocRevisable;
	draftRevisionId: string | null;
	objetivo: Objetivo;
	inicial?: { texto: string; propuesto: string; fragmento: string };
	recuperado?: boolean;
	aviso?: string | null;
	/** `yaAplicado`: se ha usado «Cambiarlo ya» y no hace falta la IA. */
	onGuardado: (c: ComentarioVista, r: RevisionDoc, yaAplicado?: boolean) => void;
	onAplicado: (v: ArticuloVista) => void;
	onCancelar: () => void;
	/** Encabezado de nivel 2 (panel) o 3 (dentro de la hoja). */
	nivel?: 2 | 3;
}

export function Compositor(p: PropsCompositor) {
	const [texto, setTexto] = React.useState(p.inicial?.texto ?? "");
	const [propuesto, setPropuesto] = React.useState(p.inicial?.propuesto ?? "");
	const [fragmento, setFragmento] = React.useState(p.inicial?.fragmento ?? "");
	const [general, setGeneral] = React.useState(false);
	const [conSeleccion, setConSeleccion] = React.useState(p.objetivo.inicio !== undefined && p.objetivo.fin !== undefined);
	const [errTexto, setErrTexto] = React.useState<string | null>(null);
	const [errFragmento, setErrFragmento] = React.useState<string | null>(null);
	const [errPropuesto, setErrPropuesto] = React.useState<string | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [enviando, setEnviando] = React.useState(false);
	const ids = { texto: React.useId(), propuesto: React.useId(), fragmento: React.useId(), titulo: React.useId(), general: React.useId() };
	const refTexto = React.useRef<HTMLTextAreaElement>(null);
	const refFragmento = React.useRef<HTMLInputElement>(null);
	const refPropuesto = React.useRef<HTMLTextAreaElement>(null);

	React.useEffect(() => {
		refTexto.current?.focus();
	}, []);

	// Borrador en el dispositivo a cada cambio.
	React.useEffect(() => {
		if (!texto && !propuesto && !fragmento) return;
		guardarBorrador(p.collection, p.id, {
			unidad: p.objetivo.ref ? idUnidad(p.objetivo.ref) : "general",
			inicio: conSeleccion ? p.objetivo.inicio : undefined,
			fin: conSeleccion ? p.objetivo.fin : undefined,
			texto,
			propuesto,
			fragmento,
			fecha: new Date().toISOString(),
		});
	}, [texto, propuesto, fragmento, conSeleccion, p.collection, p.id, p.objetivo]);

	const calcularAncla = (): { ancla: Ancla | null; ok: boolean; fallo?: "fragmento" | "ancla" } => {
		const ref = p.objetivo.ref;
		if (!ref) return { ancla: null, ok: true };
		const base = p.draftRevisionId;
		if (conSeleccion && p.objetivo.inicio !== undefined && p.objetivo.fin !== undefined) {
			const a = crearAncla(p.doc, { ...ref, inicio: p.objetivo.inicio, fin: p.objetivo.fin }, base);
			return a ? { ancla: a, ok: true } : { ancla: null, ok: false, fallo: "ancla" };
		}
		if (fragmento.trim()) {
			const a = anclaDeFragmento(p.doc, ref, fragmento.trim(), base);
			if (!a) {
				setErrFragmento(T.formFragmentoNoEncontrado);
				refFragmento.current?.focus();
				return { ancla: null, ok: false, fallo: "fragmento" };
			}
			return { ancla: a, ok: true };
		}
		const a = crearAncla(p.doc, ref, base);
		return a ? { ancla: a, ok: true } : { ancla: null, ok: false, fallo: "ancla" };
	};

	const enviar = async (cambiarYa: boolean) => {
		setError(null);
		setErrFragmento(null);
		setErrPropuesto(null);
		if (!texto.trim()) {
			setErrTexto(T.formQueVacio);
			refTexto.current?.focus();
			return;
		}
		setErrTexto(null);
		if (cambiarYa && !propuesto.trim()) {
			setErrPropuesto(T.formCambiarYaSinPropuesto);
			refPropuesto.current?.focus();
			return;
		}
		const { ancla, ok, fallo } = calcularAncla();
		if (!ok) {
			if (fallo === "ancla") setError(new Error(T.formNoSituado));
			return;
		}
		setEnviando(true);
		try {
			const res = await api.crearComentario({
				collection: p.collection,
				id: p.id,
				texto: texto.trim(),
				textoPropuesto: propuesto.trim() || undefined,
				ancla,
				fragmento: !conSeleccion && fragmento.trim() ? fragmento.trim() : undefined,
				general: general || undefined,
			});
			borrarBorrador(p.collection, p.id);
			if (cambiarYa) {
				p.onGuardado(res.comentario, res.revision, true);
				const vista = await api.aplicarComentario(res.comentario.id);
				p.onAplicado(vista);
			} else p.onGuardado(res.comentario, res.revision);
		} catch (e) {
			// Con la sesión caducada el borrador sigue guardado.
			setError(e);
		} finally {
			setEnviando(false);
		}
	};

	const H = p.nivel === 3 ? "h3" : "h2";
	const descTexto = [errTexto ? `${ids.texto}-err` : ""].filter(Boolean).join(" ") || undefined;

	return (
		<form
			className="rv-compositor"
			aria-labelledby={ids.titulo}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void enviar(false);
			}}
		>
			<H id={ids.titulo}>{p.objetivo.ref ? T.formTitulo : T.comentarioGeneral}</H>
			{p.recuperado ? <p className="rv-ayuda" style={{ margin: 0 }}>{T.formBorradorRecuperado}</p> : null}
			{p.aviso ? <p className="rv-ayuda" style={{ margin: 0 }}>{p.aviso}</p> : null}
			{p.objetivo.ref ? (
				<p style={{ margin: 0 }}>
					<span className="rv-ayuda">{T.formSobre} </span>
					{p.objetivo.descripcion}
				</p>
			) : null}
			{conSeleccion && p.objetivo.cita ? (
				<div className="rv-campo">
					<span className="rv-etq">{T.formFragmentoSeleccion}</span>
					<blockquote className="rv-cita">{p.objetivo.cita}</blockquote>
					<div>
						<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={() => setConSeleccion(false)}>
							{T.formQuitarFragmento}
						</button>
					</div>
				</div>
			) : null}

			<div className="rv-campo">
				<label htmlFor={ids.texto}>{T.formQue}</label>
				<textarea
					id={ids.texto}
					ref={refTexto}
					className="rv-input"
					value={texto}
					required
					aria-required="true"
					aria-invalid={errTexto ? true : undefined}
					aria-describedby={descTexto}
					onChange={(e) => {
						setTexto(e.target.value);
						if (errTexto && e.target.value.trim()) setErrTexto(null);
					}}
				/>
				{errTexto ? (
					<p className="rv-error" id={`${ids.texto}-err`}>
						{errTexto}
					</p>
				) : null}
			</div>

			{p.objetivo.ref ? (
				<div className="rv-campo">
					<label htmlFor={ids.propuesto}>{T.formPropuesto}</label>
					<textarea
						id={ids.propuesto}
						ref={refPropuesto}
						className="rv-input"
						style={{ minHeight: "4rem" }}
						value={propuesto}
						aria-invalid={errPropuesto ? true : undefined}
						aria-describedby={`${ids.propuesto}-ayuda${errPropuesto ? ` ${ids.propuesto}-err` : ""}`}
						onChange={(e) => {
							setPropuesto(e.target.value);
							if (errPropuesto && e.target.value.trim()) setErrPropuesto(null);
						}}
					/>
					<small id={`${ids.propuesto}-ayuda`}>{T.formPropuestoAyuda}</small>
					{errPropuesto ? (
						<p className="rv-error" id={`${ids.propuesto}-err`}>
							{errPropuesto}
						</p>
					) : null}
				</div>
			) : null}

			{p.objetivo.ref && !conSeleccion ? (
				<div className="rv-campo">
					<label htmlFor={ids.fragmento}>{T.formFragmento}</label>
					<input
						id={ids.fragmento}
						ref={refFragmento}
						type="text"
						className="rv-input"
						value={fragmento}
						aria-invalid={errFragmento ? true : undefined}
						aria-describedby={`${ids.fragmento}-ayuda${errFragmento ? ` ${ids.fragmento}-err` : ""}`}
						onChange={(e) => {
							setFragmento(e.target.value);
							if (errFragmento) setErrFragmento(null);
						}}
					/>
					<small id={`${ids.fragmento}-ayuda`}>{T.formFragmentoAyuda}</small>
					{errFragmento ? (
						<p className="rv-error" id={`${ids.fragmento}-err`}>
							{errFragmento}
						</p>
					) : null}
				</div>
			) : null}

			<div style={{ display: "grid", gap: "0.125rem" }}>
				<label className="rv-check" htmlFor={ids.general}>
					<input
						id={ids.general}
						type="checkbox"
						checked={general}
						aria-describedby={`${ids.general}-ayuda`}
						onChange={(e) => setGeneral(e.target.checked)}
					/>
					<span>{T.formGeneral}</span>
				</label>
				<small className="rv-ayuda" id={`${ids.general}-ayuda`} style={{ paddingLeft: "1.875rem" }}>
					{T.formGeneralAyuda}
				</small>
			</div>

			{error && !errFragmento ? <AvisoError error={error} /> : null}

			<div className="rv-acciones">
				<button type="submit" className="rv-btn rv-btn--principal" disabled={enviando}>
					{enviando ? T.guardando : T.formGuardar}
				</button>
				{p.objetivo.ref && propuesto.trim() ? (
					<button type="button" className="rv-btn" disabled={enviando} onClick={() => void enviar(true)}>
						{T.cambiarloYa}
					</button>
				) : null}
				<button
					type="button"
					className="rv-btn rv-btn--plano"
					onClick={() => {
						if (!esSesionCaducada(error)) borrarBorrador(p.collection, p.id);
						p.onCancelar();
					}}
				>
					{T.cancelar}
				</button>
			</div>
		</form>
	);
}
