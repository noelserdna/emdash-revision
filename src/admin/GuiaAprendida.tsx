/**
 * Guía aprendida (solo administrador): de solo lectura. Lista de criterios por
 * tema con dónde se vieron, «Retirar» por criterio, «Actualizar ahora» e
 * «Historial de la guía» con «Restaurar».
 */

import * as React from "react";

import type { AprendizajeVista, EstadoAprendizajeVista, GuiaHistorialVista } from "../lib/types.js";
import { api, urlArticulo } from "./api.js";
import { Aviso, AvisoError, fechaCorta, fechaLarga, useAnuncio } from "./comun.js";
import { Dialogo } from "./Dialogo.js";
import { T } from "./textos.js";

/** Cada cuánto se consulta el estado mientras la IA está actualizando la guía. */
const SONDEO_MS = 4000;

export function GuiaAprendida() {
	const { anunciar, alertar } = useAnuncio();
	const [estado, setEstado] = React.useState<EstadoAprendizajeVista | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [errAccion, setErrAccion] = React.useState<unknown>(null);
	const [aviso, setAviso] = React.useState<string | null>(null);
	const [ocupado, setOcupado] = React.useState(false);
	const [esperando, setEsperando] = React.useState(false);
	const [retirando, setRetirando] = React.useState<AprendizajeVista | null>(null);
	const [historialAbierto, setHistorialAbierto] = React.useState(false);
	const volverRef = React.useRef<HTMLButtonElement>(null);
	const ultima = React.useRef<string | null>(null);
	const idTitulo = React.useId();

	const cargar = React.useCallback(async () => {
		try {
			const e = await api.estadoAprendizaje();
			setEstado(e);
			setError(null);
			return e;
		} catch (err) {
			setError(err);
			return null;
		}
	}, []);

	React.useEffect(() => {
		void cargar().then((e) => {
			ultima.current = e?.ultimaActualizacion ?? null;
			if (e?.enCurso) setEsperando(true);
		});
	}, [cargar]);

	// Mientras la IA trabaja, se consulta el estado cada pocos segundos.
	React.useEffect(() => {
		if (!esperando) return;
		const t = window.setInterval(() => {
			void cargar().then((e) => {
				if (!e || e.enCurso) return;
				setEsperando(false);
				if (e.error) setAviso(null);
				else if (e.ultimaActualizacion !== ultima.current) {
					setAviso(null);
					anunciar(T.apActualizada);
				}
				ultima.current = e.ultimaActualizacion;
			});
		}, SONDEO_MS);
		return () => window.clearInterval(t);
	}, [esperando, cargar, anunciar]);

	if (error && !estado) return <AvisoError error={error} onReintentar={() => void cargar()} />;
	if (!estado) {
		return (
			<div className="rv-tarjeta" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}

	const actualizar = async () => {
		setOcupado(true);
		setErrAccion(null);
		setAviso(null);
		try {
			const r = await api.actualizarAprendizaje();
			setEstado(r.estado);
			if (r.programado) {
				ultima.current = r.estado.ultimaActualizacion;
				setAviso(T.apProgramada);
				setEsperando(true);
				anunciar(T.apProgramada);
			} else {
				const msg = r.motivo === "sin_clave" ? T.apSinClave : r.motivo === "tope" ? T.apTope : T.apSinSenales;
				setAviso(msg);
				anunciar(msg);
			}
		} catch (e) {
			setErrAccion(e);
			alertar(e instanceof Error ? e.message : T.errorGenerico);
		} finally {
			setOcupado(false);
		}
	};

	const retirar = async () => {
		if (!retirando) return;
		setOcupado(true);
		try {
			setEstado(await api.retirarAprendizaje(retirando.id));
			setRetirando(null);
			anunciar(T.apRetirado);
		} catch (e) {
			setErrAccion(e);
			setRetirando(null);
			alertar(e instanceof Error ? e.message : T.errorGenerico);
		} finally {
			setOcupado(false);
		}
	};

	const activos = estado.aprendizajes.filter((a) => a.estado === "activo");
	const retirados = estado.aprendizajes.filter((a) => a.estado === "retirado");
	const porTema = new Map<string, AprendizajeVista[]>();
	for (const a of activos) porTema.set(a.tema, [...(porTema.get(a.tema) ?? []), a]);

	return (
		<section className="rv-tarjeta" aria-labelledby={idTitulo}>
			<div className="rv-historial__cab">
				<h2 id={idTitulo} style={{ margin: 0 }}>
					{estado.guia.nombre}
				</h2>
				<span className="rv-etiqueta rv-etiqueta--info">{T.apSeActualiza}</span>
			</div>
			<p className="rv-ayuda" style={{ margin: 0 }}>
				{T.apIntro}
			</p>
			<p style={{ margin: 0 }} aria-live="polite">
				{esperando || estado.enCurso ? T.apEnCurso : T.apEstado(estado.pendientes, estado.ultimaActualizacion ? fechaCorta(estado.ultimaActualizacion) : null)}
			</p>
			{estado.parado ? (
				<Aviso tono="aviso">
					<p>{T.apParado(estado.parado)}</p>
				</Aviso>
			) : null}
			{estado.error && !esperando ? (
				<Aviso tono="error">
					<p>{T.apError(estado.error)}</p>
				</Aviso>
			) : null}
			{aviso ? (
				<Aviso tono="info">
					<p>{aviso}</p>
				</Aviso>
			) : null}
			{estado.ultimoResumen ? (
				<p style={{ margin: 0 }}>
					<span className="rv-ayuda">{T.apUltimoResumen}: </span>
					{estado.ultimoResumen}
				</p>
			) : null}
			{errAccion ? <AvisoError error={errAccion} /> : null}
			<div className="rv-acciones">
				<button type="button" className="rv-btn rv-btn--principal" disabled={ocupado || esperando} onClick={() => void actualizar()}>
					{ocupado || esperando ? T.apActualizando : T.apActualizar}
				</button>
				<button type="button" className="rv-btn" onClick={() => setHistorialAbierto(true)}>
					{T.apHistorial}
				</button>
			</div>

			{activos.length === 0 ? <p className="rv-ayuda">{T.apVacio}</p> : null}
			{[...porTema].map(([tema, lista]) => (
				<div key={tema} className="rv-historial__seccion">
					<h3>{tema}</h3>
					<ul className="rv-historial__lista">
						{lista.map((a) => (
							<Criterio key={a.id} a={a} onRetirar={() => setRetirando(a)} />
						))}
					</ul>
				</div>
			))}
			{retirados.length > 0 ? (
				<details>
					<summary>{T.apRetirados(retirados.length)}</summary>
					<ul className="rv-historial__lista" style={{ marginTop: "0.75rem" }}>
						{retirados.map((a) => (
							<Criterio key={a.id} a={a} />
						))}
					</ul>
				</details>
			) : null}

			<Dialogo
				abierto={!!retirando}
				onCerrar={() => setRetirando(null)}
				titulo={T.apRetirarConfirmar}
				rol="alertdialog"
				focoInicial={volverRef}
			>
				{retirando ? <blockquote className="rv-cita">{retirando.texto}</blockquote> : null}
				<p>{T.apRetirarTexto}</p>
				<div className="rv-acciones">
					<button ref={volverRef} type="button" className="rv-btn" onClick={() => setRetirando(null)}>
						{T.volver}
					</button>
					<button type="button" className="rv-btn rv-btn--peligro" disabled={ocupado} onClick={() => void retirar()}>
						{T.apRetirar}
					</button>
				</div>
			</Dialogo>

			<HistorialGuia
				abierto={historialAbierto}
				onCerrar={() => setHistorialAbierto(false)}
				onRestaurada={(e) => {
					setEstado(e);
					setHistorialAbierto(false);
					anunciar(T.apRestaurada);
				}}
			/>
		</section>
	);
}

function Criterio({ a, onRetirar }: { a: AprendizajeVista; onRetirar?: () => void }) {
	const articulos = new Map<string, { collection: string; id: string; titulo: string }>();
	for (const e of a.evidencias) {
		const clave = `${e.collection ?? ""}:${e.entryId}`;
		if (!articulos.has(clave)) articulos.set(clave, { collection: e.collection ?? "", id: e.entryId, titulo: e.titulo });
	}
	return (
		<li className="rv-version">
			<p className="rv-version__texto" style={{ margin: 0 }}>
				{a.texto}
			</p>
			<p className="rv-version__meta" style={{ margin: 0 }}>
				{a.estado === "retirado" && a.retiradoPor ? `${T.apRetiradoPor(a.retiradoPor)} · ` : ""}
				{T.apDesde(fechaLarga(a.creado))}
			</p>
			{articulos.size > 0 ? (
				<p className="rv-version__meta" style={{ margin: 0 }}>
					{T.apVistoEn}{" "}
					{[...articulos.values()].map((art, i) => (
						<React.Fragment key={`${art.collection}:${art.id}`}>
							{i > 0 ? ", " : ""}
							{art.collection ? <a href={urlArticulo({ collection: art.collection, id: art.id })}>{art.titulo}</a> : art.titulo}
						</React.Fragment>
					))}
				</p>
			) : null}
			{onRetirar ? (
				<div>
					<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" aria-label={T.apRetirarDe(a.texto)} onClick={onRetirar}>
						{T.apRetirar}
					</button>
				</div>
			) : null}
		</li>
	);
}

function HistorialGuia({
	abierto,
	onCerrar,
	onRestaurada,
}: {
	abierto: boolean;
	onCerrar: () => void;
	onRestaurada: (e: EstadoAprendizajeVista) => void;
}) {
	const [versiones, setVersiones] = React.useState<GuiaHistorialVista[] | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [confirmar, setConfirmar] = React.useState<GuiaHistorialVista | null>(null);
	const [ocupado, setOcupado] = React.useState(false);
	const cerrarRef = React.useRef<HTMLButtonElement>(null);
	const volverRef = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		if (!abierto) {
			setConfirmar(null);
			return;
		}
		setVersiones(null);
		setError(null);
		api
			.historialGuia()
			.then((r) => setVersiones(r.versiones))
			.catch(setError);
	}, [abierto]);

	React.useEffect(() => {
		if (confirmar) volverRef.current?.focus();
	}, [confirmar]);

	const restaurar = async () => {
		if (!confirmar) return;
		setOcupado(true);
		setError(null);
		try {
			onRestaurada(await api.restaurarGuia(confirmar.id));
			setConfirmar(null);
		} catch (e) {
			setError(e);
		} finally {
			setOcupado(false);
		}
	};

	return (
		<Dialogo abierto={abierto} onCerrar={onCerrar} titulo={T.apHistorial} ancho focoInicial={cerrarRef}>
			<p className="rv-ayuda">{T.apHistorialIntro}</p>
			{error ? <AvisoError error={error} /> : null}
			{confirmar ? (
				<div className="rv-tarjeta" role="group" aria-label={T.apRestaurarConfirmar}>
					<p style={{ margin: 0, fontWeight: 600 }}>{T.apRestaurarConfirmar}</p>
					<p style={{ margin: 0 }}>
						{confirmar.desde ? T.apVersion(fechaLarga(confirmar.desde), confirmar.criterios) : T.apVersionPrimera(confirmar.criterios)}
					</p>
					<p className="rv-ayuda" style={{ margin: 0 }}>
						{T.apRestaurarTexto}
					</p>
					<div className="rv-acciones">
						<button ref={volverRef} type="button" className="rv-btn" onClick={() => setConfirmar(null)}>
							{T.volver}
						</button>
						<button type="button" className="rv-btn rv-btn--principal" disabled={ocupado} onClick={() => void restaurar()}>
							{ocupado ? T.restaurando : T.apRestaurar}
						</button>
					</div>
				</div>
			) : null}
			{!versiones && !error ? <p aria-busy="true">{T.cargando}</p> : null}
			{versiones && versiones.length === 0 ? <p>{T.apHistorialVacio}</p> : null}
			{versiones && versiones.length > 0 ? (
				<ul className="rv-historial__lista">
					{versiones.map((v) => {
						const nombre = v.desde ? fechaLarga(v.desde) : fechaLarga(v.fecha);
						return (
							<li key={v.id} className="rv-version">
								<p style={{ margin: 0, fontWeight: 600 }}>
									{v.desde ? T.apVersion(nombre, v.criterios) : T.apVersionPrimera(v.criterios)}
								</p>
								<p className="rv-version__meta" style={{ margin: 0 }}>
									{T.apReemplazada(fechaCorta(v.fecha), v.resumen)}
								</p>
								<div>
									<button
										type="button"
										className="rv-btn rv-btn--peque"
										aria-label={T.apRestaurarDe(nombre)}
										disabled={ocupado}
										onClick={() => setConfirmar(v)}
									>
										{T.apRestaurar}
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			) : null}
			<div className="rv-acciones">
				<button ref={cerrarRef} type="button" className="rv-btn" onClick={onCerrar}>
					{T.cerrar}
				</button>
			</div>
		</Dialogo>
	);
}
