/**
 * Segunda revisión: cada cambio es una tarjeta en su sitio, con lo antiguo
 * tachado y lo nuevo subrayado por palabra (`<del>`/`<ins>` con texto oculto
 * «Eliminado:»/«Añadido:»), «Ver el original» y tres acciones. Los cambios con
 * avisos exigen confirmar con el antes y el después a la vista.
 */

import * as React from "react";

import { textoDeBloque } from "../lib/bloques.js";
import { diffPalabras } from "../lib/diff.js";
import type { CambioVista, ComentarioVista, PTNode, SegmentoDiff, Veredicto } from "../lib/types.js";
import { Aviso } from "./comun.js";
import { Dialogo } from "./Dialogo.js";
import { Icono } from "./iconos.js";
import { BloqueSoloLectura } from "./Lector.js";
import { T } from "./textos.js";

function textoDe(x: PTNode | string | null): string {
	if (x === null || x === undefined) return "";
	if (typeof x === "string") return x;
	try {
		return textoDeBloque(x);
	} catch {
		return "";
	}
}

/** Texto marcado por palabra. */
export function Marcado({ antes, despues }: { antes: string; despues: string }) {
	const segmentos = React.useMemo(() => {
		try {
			return diffPalabras(antes, despues);
		} catch {
			return [
				{ tipo: "eliminado" as const, texto: antes },
				{ tipo: "añadido" as const, texto: despues },
			];
		}
	}, [antes, despues]);
	return <Segmentos segmentos={segmentos} />;
}

/** Segmentos ya calculados: `<del>`/`<ins>` con «Eliminado:»/«Añadido:» para el lector de pantalla. */
export function Segmentos({ segmentos }: { segmentos: readonly SegmentoDiff[] }) {
	return (
		<>
			{segmentos.map((s, i) =>
				s.tipo === "igual" ? (
					<React.Fragment key={i}>{s.texto}</React.Fragment>
				) : s.tipo === "eliminado" ? (
					<del key={i}>
						<span className="rv-sr">{T.srEliminado}</span>
						{s.texto}
					</del>
				) : (
					<ins key={i}>
						<span className="rv-sr">{T.srAnadido}</span>
						{s.texto}
					</ins>
				),
			)}
			<span className="rv-sr"> {T.srFinCambio}</span>
		</>
	);
}

function resumenDe(c: CambioVista): string {
	if (c.op === "insertar") return T.resumenInsertar;
	if (c.op === "eliminar") return T.resumenEliminar;
	if (c.op === "campo") return c.campo === "title" ? T.resumenTituloCampo : T.resumenExtractoCampo;
	const n = (c.despues ?? c.antes) as PTNode | string | null;
	return n && typeof n !== "string" && n._type === "table" ? T.resumenTabla : T.resumenReemplazo;
}

function Contenido({ x }: { x: PTNode | string | null }) {
	if (x === null || x === undefined) return null;
	if (typeof x === "string") return <p style={{ margin: 0 }}>{x}</p>;
	return <BloqueSoloLectura node={x} />;
}

export interface PropsTarjeta {
	cambio: CambioVista;
	indice: number;
	total: number;
	comentarios: ComentarioVista[];
	ocupado: boolean;
	onVeredicto: (c: CambioVista, v: Veredicto, nota?: string, confirmado?: boolean) => Promise<boolean>;
	onComentar?: (c: CambioVista, origen: HTMLElement) => void;
}

export function TarjetaCambio({ cambio: c, indice, total, comentarios, ocupado, onVeredicto, onComentar }: PropsTarjeta) {
	const [nota, setNota] = React.useState("");
	const [propuesto, setPropuesto] = React.useState("");
	const [pidiendoNota, setPidiendoNota] = React.useState(false);
	const [errNota, setErrNota] = React.useState(false);
	const [confirmando, setConfirmando] = React.useState(false);
	const volverRef = React.useRef<HTMLButtonElement>(null);
	const idNota = React.useId();
	const idTit = `rv-cambio-h-${c.id}`;
	const conAvisos = c.avisos.length > 0;
	const motivos = comentarios.filter((x) => c.comentarioIds.includes(x.id));
	const textual = c.op === "reemplazar" || c.op === "campo";

	const bien = () => {
		if (conAvisos) setConfirmando(true);
		else void onVeredicto(c, "bien");
	};

	return (
		<section
			id={`rv-cambio-${c.id}`}
			className={`rv-cambio${c.veredicto === "pendiente" ? " rv-cambio--pendiente" : ""}${conAvisos ? " rv-cambio--aviso" : ""}`}
			aria-labelledby={idTit}
			data-rv-bloque={c.blockKey ?? undefined}
			data-rv-cambio={c.id}
		>
			<div className="rv-cambio__cab">
				<h3 id={idTit} tabIndex={-1}>
					{T.cambioN(indice, total)}
				</h3>
				<span>{resumenDe(c)}</span>
				{c.veredicto !== "pendiente" ? (
					<span className="rv-veredicto">
						<Icono nombre={c.veredicto === "bien" ? "check" : c.veredicto === "deshecho" ? "deshacer" : "alerta"} tam={16} />
						{T.veredictoActual(T.veredictoNombre[c.veredicto])}
					</span>
				) : null}
			</div>

			{conAvisos ? (
				<div style={{ marginBottom: "0.75rem", fontFamily: "system-ui, sans-serif", fontSize: "0.9375rem" }}>
					<Aviso tono="aviso">
						<p>
							<strong>{T.cambioConAvisos}</strong>
						</p>
						<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
							{c.avisos.map((a, i) => (
								<li key={i}>{a.mensaje}</li>
							))}
						</ul>
					</Aviso>
				</div>
			) : null}

			<div className="rv-cambio__texto">
				{textual ? (
					<p style={{ margin: 0 }}>
						<Marcado antes={textoDe(c.antes)} despues={textoDe(c.despues)} />
					</p>
				) : c.op === "insertar" ? (
					<div>
						<span className="rv-sr">{T.srAnadido}</span>
						<ins style={{ display: "block", textDecoration: "none" }}>
							<Contenido x={c.despues} />
						</ins>
					</div>
				) : (
					<div>
						<span className="rv-sr">{T.srEliminado}</span>
						<del style={{ display: "block" }}>
							<Contenido x={c.antes} />
						</del>
					</div>
				)}
			</div>

			<div className="rv-cambio__pie">
				{textual ? (
					<details>
						<summary>{T.verOriginal}</summary>
						<div className="rv-cambio__original">
							<Contenido x={c.antes} />
						</div>
					</details>
				) : null}
				{motivos.length ? (
					<div>
						<span className="rv-ayuda">{T.porComentario}</span>
						<ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
							{motivos.map((m) => (
								<li key={m.id}>
									{m.texto}
									{m.respuestaIA ? <span className="rv-ayuda"> — {m.respuestaIA}</span> : null}
								</li>
							))}
						</ul>
					</div>
				) : null}

				{pidiendoNota ? (
					<form
						style={{ display: "grid", gap: "0.5rem" }}
						noValidate
						onSubmit={(e) => {
							e.preventDefault();
							if (!nota.trim()) {
								setErrNota(true);
								return;
							}
							const mia = propuesto.trim();
							const completa = mia ? `${nota.trim()}\n\n${T.noEsEstoPropuestoEnNota(mia)}` : nota.trim();
							void onVeredicto(c, "no_es_esto", completa).then((ok) => {
								if (ok) {
									setPidiendoNota(false);
									setNota("");
									setPropuesto("");
								}
							});
						}}
					>
						<label htmlFor={idNota} className="rv-etq" style={{ fontWeight: 600 }}>
							{T.noEsEstoNota}
						</label>
						<textarea
							id={idNota}
							className="rv-input"
							value={nota}
							autoFocus
							aria-required="true"
							aria-invalid={errNota ? true : undefined}
							aria-describedby={errNota ? `${idNota}-err` : undefined}
							onChange={(e) => {
								setNota(e.target.value);
								if (e.target.value.trim()) setErrNota(false);
							}}
						/>
						{errNota ? (
							<p className="rv-error" id={`${idNota}-err`}>
								{T.noEsEstoVacio}
							</p>
						) : null}
						<label htmlFor={`${idNota}-mia`} className="rv-etq" style={{ fontWeight: 600 }}>
							{T.noEsEstoPropuesto}
						</label>
						<textarea
							id={`${idNota}-mia`}
							className="rv-input rv-input--redaccion"
							value={propuesto}
							aria-describedby={`${idNota}-mia-ayuda`}
							onChange={(e) => setPropuesto(e.target.value)}
						/>
						<div className="rv-acciones">
							<span className="rv-ayuda" id={`${idNota}-mia-ayuda`}>
								{T.noEsEstoPropuestoAyuda}
							</span>
							{textoDe(c.despues) && !propuesto ? (
								<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={() => setPropuesto(textoDe(c.despues))}>
									{T.noEsEstoPartir}
								</button>
							) : null}
						</div>
						<div className="rv-acciones">
							<button type="submit" className="rv-btn rv-btn--principal" disabled={ocupado}>
								{T.noEsEstoEnviar}
							</button>
							<button type="button" className="rv-btn rv-btn--plano" onClick={() => setPidiendoNota(false)}>
								{T.cancelar}
							</button>
						</div>
					</form>
				) : (
					<div className="rv-acciones" role="group" aria-label={T.cambioN(indice, total)}>
						<button
							type="button"
							className={`rv-btn${c.veredicto === "pendiente" ? " rv-btn--principal" : ""}`}
							aria-pressed={c.veredicto === "bien"}
							disabled={ocupado}
							onClick={bien}
						>
							<Icono nombre="check" tam={16} />
							{T.estaBien}
						</button>
						<button
							type="button"
							className="rv-btn"
							aria-pressed={c.veredicto === "deshecho"}
							disabled={ocupado}
							onClick={() => void onVeredicto(c, "deshecho")}
						>
							<Icono nombre="deshacer" tam={16} />
							{T.deshacer}
						</button>
						<button
							type="button"
							className="rv-btn"
							aria-pressed={c.veredicto === "no_es_esto"}
							disabled={ocupado}
							onClick={() => setPidiendoNota(true)}
						>
							{T.noEsEsto}
						</button>
						{onComentar && (c.blockKey || c.op === "campo") && c.op !== "eliminar" ? (
							<button type="button" className="rv-btn rv-btn--plano" onClick={(e) => onComentar(c, e.currentTarget)}>
								<Icono nombre="comentario" tam={16} />
								{T.comentarParrafo}
							</button>
						) : null}
					</div>
				)}
			</div>

			<Dialogo
				abierto={confirmando}
				onCerrar={() => setConfirmando(false)}
				titulo={T.confirmarTitulo}
				rol="alertdialog"
				focoInicial={volverRef}
				ancho
			>
				<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
					{c.avisos.map((a, i) => (
						<li key={i}>{a.mensaje}</li>
					))}
				</ul>
				<div className="rv-antesdespues">
					<div>
						<h3>{T.confirmarAntes}</h3>
						<Contenido x={c.antes} />
					</div>
					<div>
						<h3>{T.confirmarDespues}</h3>
						<Contenido x={c.despues} />
					</div>
				</div>
				<div className="rv-acciones">
					<button ref={volverRef} type="button" className="rv-btn" onClick={() => setConfirmando(false)}>
						{T.volver}
					</button>
					<button
						type="button"
						className="rv-btn rv-btn--principal"
						disabled={ocupado}
						onClick={() => {
							setConfirmando(false);
							void onVeredicto(c, "bien", undefined, true);
						}}
					>
						{T.confirmarSi}
					</button>
				</div>
			</Dialogo>
		</section>
	);
}

/** Comentarios que la corrección no aplicó, con su motivo y «De acuerdo» / «Insistir». */
export function NoAplicados({
	comentarios,
	vistos,
	ocupado,
	onDeAcuerdo,
	onInsistir,
}: {
	comentarios: ComentarioVista[];
	vistos: string[];
	ocupado: boolean;
	onDeAcuerdo: (c: ComentarioVista) => void;
	onInsistir: (c: ComentarioVista) => Promise<void>;
}) {
	const pendientes = comentarios.filter((c) => !vistos.includes(c.id) && c.estado !== "abierto");
	if (!pendientes.length) return null;
	return (
		<section className="rv-tarjeta" aria-labelledby="rv-noaplicados" style={{ fontFamily: "system-ui, sans-serif", fontSize: "0.9375rem", marginBottom: "1.25rem" }}>
			<h2 id="rv-noaplicados" style={{ margin: 0, fontSize: "1.0625rem" }}>
				{T.noAplicadosTitulo}
			</h2>
			<p className="rv-ayuda" style={{ margin: 0 }}>
				{T.noAplicadosIntro}
			</p>
			<ul className="rv-comentarios">
				{pendientes.map((c) => (
					<li key={c.id} className="rv-comentario">
						{c.ancla?.cita ? <blockquote className="rv-cita">{c.ancla.cita}</blockquote> : null}
						<p>{c.texto}</p>
						<p>
							<span className="rv-ayuda">{T.respuestaDe} </span>
							{c.respuestaIA || T.sinMotivo}
						</p>
						<div className="rv-acciones">
							<button type="button" className="rv-btn rv-btn--peque" disabled={ocupado} onClick={() => onDeAcuerdo(c)}>
								{T.deAcuerdo}
							</button>
							<button type="button" className="rv-btn rv-btn--peque" disabled={ocupado} onClick={() => void onInsistir(c)}>
								{T.insistir}
							</button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
