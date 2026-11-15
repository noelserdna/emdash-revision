/**
 * Diálogos de la vista de revisión: aprobar, publicar y corregir con la IA.
 * Aprobar y publicar son `alertdialog` con el foco inicial en la opción segura
 * y manejan las respuestas `requiereConfirmacion` del servidor.
 */

import * as React from "react";

import type { AjustesVista, Aprobacion, ArticuloVista, Esfuerzo, ModeloId, RevisionDoc, TrabajoVista } from "../lib/types.js";
import { api } from "./api.js";
import { AvisoError, fechaLarga } from "./comun.js";
import { Dialogo } from "./Dialogo.js";
import { T } from "./textos.js";

// ─── Aprobar ─────────────────────────────────────────────────────────────────

export function DialogoAprobar({
	abierto,
	onCerrar,
	vista,
	leido,
	pendientes,
	onAprobado,
}: {
	abierto: boolean;
	onCerrar: () => void;
	vista: ArticuloVista;
	leido: number;
	pendientes: number;
	onAprobado: (r: RevisionDoc) => void;
}) {
	const seguro = React.useRef<HTMLButtonElement>(null);
	const [servidor, setServidor] = React.useState<{ leido: number; cambiosPendientes: number } | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [enviando, setEnviando] = React.useState(false);

	React.useEffect(() => {
		if (abierto) {
			setServidor(null);
			setError(null);
		}
	}, [abierto]);

	const pctLeido = servidor ? servidor.leido : leido;
	const pend = servidor ? servidor.cambiosPendientes : pendientes;
	const abiertos = vista.revision.abiertos;
	const hayAvisos = pctLeido < 100 || pend > 0 || abiertos > 0;

	const aprobar = async () => {
		setEnviando(true);
		setError(null);
		try {
			const res = await api.aprobar({ collection: vista.articulo.collection, id: vista.articulo.id, confirmar: hayAvisos || !!servidor });
			if (res.requiereConfirmacion) {
				setServidor({ leido: res.leido, cambiosPendientes: res.cambiosPendientes });
				seguro.current?.focus();
			} else onAprobado(res.revision);
		} catch (e) {
			setError(e);
		} finally {
			setEnviando(false);
		}
	};

	return (
		<Dialogo abierto={abierto} onCerrar={onCerrar} titulo={T.aprobarTitulo} rol="alertdialog" focoInicial={seguro}>
			<p>{T.aprobarTexto}</p>
			{hayAvisos ? (
				<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
					{pctLeido < 100 ? <li>{T.aprobarLeido(pctLeido)}</li> : null}
					{pend > 0 ? <li>{T.aprobarPendientes(pend)}</li> : null}
					{abiertos > 0 ? <li>{T.aprobarAbiertos(abiertos)}</li> : null}
				</ul>
			) : null}
			{error ? <AvisoError error={error} /> : null}
			<div className="rv-acciones">
				<button ref={seguro} type="button" className="rv-btn" onClick={onCerrar}>
					{T.seguirRevisando}
				</button>
				<button type="button" className="rv-btn rv-btn--principal" disabled={enviando} onClick={() => void aprobar()}>
					{hayAvisos ? T.aprobarIgualmente : T.aprobar}
				</button>
			</div>
		</Dialogo>
	);
}

// ─── Publicar ────────────────────────────────────────────────────────────────

export function DialogoPublicar({
	abierto,
	onCerrar,
	vista,
	onPublicado,
}: {
	abierto: boolean;
	onCerrar: () => void;
	vista: ArticuloVista;
	onPublicado: (url: string | null) => void;
}) {
	const seguro = React.useRef<HTMLButtonElement>(null);
	const [aviso, setAviso] = React.useState<{ motivo: string; aprobacion: Aprobacion | null } | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [enviando, setEnviando] = React.useState(false);

	React.useEffect(() => {
		if (abierto) {
			setAviso(null);
			setError(null);
		}
	}, [abierto]);

	const soloAdmin = vista.config.requiereAprobacion && !vista.usuario.esAdmin;

	const publicar = async () => {
		setEnviando(true);
		setError(null);
		try {
			const res = await api.publicar({ collection: vista.articulo.collection, id: vista.articulo.id, confirmar: !!aviso });
			if (res.requiereConfirmacion) {
				setAviso({ motivo: res.motivo, aprobacion: res.aprobacion });
				seguro.current?.focus();
			} else onPublicado(res.urlPublica);
		} catch (e) {
			setError(e);
		} finally {
			setEnviando(false);
		}
	};

	return (
		<Dialogo abierto={abierto} onCerrar={onCerrar} titulo={T.publicarTitulo} rol="alertdialog" focoInicial={seguro}>
			{aviso ? (
				<>
					<p>
						<strong>{T.publicarSinAprobar}</strong>
					</p>
					{aviso.motivo ? <p>{aviso.motivo}</p> : null}
					<p>
						{aviso.aprobacion
							? T.publicarAprobadoPor(aviso.aprobacion.nombre, fechaLarga(aviso.aprobacion.fecha))
							: T.publicarNadie}
					</p>
					{soloAdmin ? <p>{T.publicarSoloAdmin}</p> : null}
				</>
			) : (
				<p>{T.publicarTexto}</p>
			)}
			{error ? <AvisoError error={error} /> : null}
			<div className="rv-acciones">
				<button ref={seguro} type="button" className="rv-btn" onClick={onCerrar}>
					{T.volver}
				</button>
				{aviso && soloAdmin ? null : (
					<button type="button" className="rv-btn rv-btn--principal" disabled={enviando} onClick={() => void publicar()}>
						{aviso ? T.publicarIgualmente : T.publicar}
					</button>
				)}
			</div>
		</Dialogo>
	);
}

// ─── Corregir con la IA (administrador) ─────────────────────────────────────

const ESFUERZOS: Esfuerzo[] = ["low", "medium", "high", "xhigh"];

export function DialogoIA({
	abierto,
	onCerrar,
	vista,
	onCreado,
}: {
	abierto: boolean;
	onCerrar: () => void;
	vista: ArticuloVista;
	onCreado: (t: TrabajoVista) => void;
}) {
	const seguro = React.useRef<HTMLButtonElement>(null);
	const [ajustes, setAjustes] = React.useState<AjustesVista | null>(null);
	const [modelo, setModelo] = React.useState<ModeloId | "">("");
	const [esfuerzo, setEsfuerzo] = React.useState<Esfuerzo>("high");
	const [completa, setCompleta] = React.useState(false);
	const [error, setError] = React.useState<unknown>(null);
	const [enviando, setEnviando] = React.useState(false);
	const ids = { m: React.useId(), e: React.useId(), c: React.useId() };

	React.useEffect(() => {
		if (!abierto) return;
		setError(null);
		api
			.ajustes()
			.then((a) => {
				setAjustes(a);
				setModelo(a.ajustes.modeloDefecto);
				setEsfuerzo(a.ajustes.esfuerzo);
			})
			.catch(setError);
	}, [abierto]);

	const coste = ajustes?.modelos.find((m) => m.id === modelo)?.costeOrientativo;

	const lanzar = async () => {
		if (!modelo) return;
		setEnviando(true);
		setError(null);
		try {
			const res = await api.crearTrabajo({
				collection: vista.articulo.collection,
				id: vista.articulo.id,
				motor: "api",
				modelo,
				esfuerzo,
				completa,
			});
			onCreado(res.trabajo);
		} catch (e) {
			setError(e);
		} finally {
			setEnviando(false);
		}
	};

	return (
		<Dialogo abierto={abierto} onCerrar={onCerrar} titulo={T.iaTitulo} focoInicial={seguro}>
			{!ajustes && !error ? <p>{T.cargando}</p> : null}
			{ajustes && !ajustes.apiDisponible ? <p>{T.ajClaveNo}</p> : null}
			{ajustes ? (
				<>
					<div className="rv-campo">
						<label htmlFor={ids.m}>{T.iaModelo}</label>
						<select id={ids.m} className="rv-input" value={modelo} onChange={(e) => setModelo(e.target.value as ModeloId)}>
							{ajustes.modelos.map((m) => (
								<option key={m.id} value={m.id}>
									{m.nombre}
								</option>
							))}
						</select>
						{coste ? <small>{T.iaCoste(coste)}</small> : null}
					</div>
					<div className="rv-campo">
						<label htmlFor={ids.e}>{T.iaEsfuerzo}</label>
						<select id={ids.e} className="rv-input" value={esfuerzo} onChange={(e) => setEsfuerzo(e.target.value as Esfuerzo)}>
							{ESFUERZOS.map((e) => (
								<option key={e} value={e}>
									{T.esfuerzo(e)}
								</option>
							))}
						</select>
					</div>
					<label className="rv-check" htmlFor={ids.c}>
						<input id={ids.c} type="checkbox" checked={completa} onChange={(e) => setCompleta(e.target.checked)} />
						<span>{T.iaCompleta}</span>
					</label>
					<p className="rv-ayuda">{T.ajGasto(ajustes.gastoMes, ajustes.ajustes.topeMensualUsd)}</p>
				</>
			) : null}
			{error ? <AvisoError error={error} /> : null}
			<div className="rv-acciones">
				<button ref={seguro} type="button" className="rv-btn" onClick={onCerrar}>
					{T.cancelar}
				</button>
				<button
					type="button"
					className="rv-btn rv-btn--principal"
					disabled={enviando || !ajustes?.apiDisponible || !modelo}
					onClick={() => void lanzar()}
				>
					{T.iaLanzar}
				</button>
			</div>
		</Dialogo>
	);
}
