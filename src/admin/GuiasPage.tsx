/**
 * Guías de redacción (solo administrador): lista y editor de Markdown.
 */

import * as React from "react";

import type { GuiaDoc } from "../lib/types.js";
import { api, esSinPermiso, urlInicio } from "./api.js";
import { Aviso, AvisoError, Raiz, useAnuncio } from "./comun.js";
import { Dialogo } from "./Dialogo.js";
import { Icono } from "./iconos.js";
import { T } from "./textos.js";

type Guia = GuiaDoc & { id: string };

interface Borrador {
	id?: string;
	nombre: string;
	markdown: string;
	orden: number;
}

export function GuiasPage() {
	return (
		<Raiz>
			<Guias />
		</Raiz>
	);
}

function Guias() {
	const { anunciar } = useAnuncio();
	const [guias, setGuias] = React.useState<Guia[] | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [borrador, setBorrador] = React.useState<Borrador | null>(null);
	const [sucio, setSucio] = React.useState(false);
	const [errNombre, setErrNombre] = React.useState(false);
	const [errGuardar, setErrGuardar] = React.useState<unknown>(null);
	const [guardando, setGuardando] = React.useState(false);
	const [borrando, setBorrando] = React.useState(false);
	const volverRef = React.useRef<HTMLButtonElement>(null);
	const nombreRef = React.useRef<HTMLInputElement>(null);
	const ids = { n: React.useId(), o: React.useId(), m: React.useId() };

	const cargar = React.useCallback(async () => {
		try {
			const res = await api.listarGuias();
			const lista = [...res.guias].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
			setGuias(lista);
			setError(null);
			return lista;
		} catch (e) {
			setError(e);
			return null;
		}
	}, []);

	React.useEffect(() => {
		void cargar().then((l) => {
			const g = l?.[0];
			if (g) setBorrador({ id: g.id, nombre: g.nombre, markdown: g.markdown, orden: g.orden });
		});
	}, [cargar]);

	if (error && !guias) {
		return (
			<div className="rv-pagina">
				{esSinPermiso(error) ? (
					<Aviso tono="error">
						<p>{T.sinPermiso}</p>
						<p>
							<a href={urlInicio()}>{T.volverAlInicio}</a>
						</p>
					</Aviso>
				) : (
					<AvisoError error={error} onReintentar={() => void cargar()} />
				)}
			</div>
		);
	}
	if (!guias) {
		return (
			<div className="rv-pagina" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}

	const elegir = (g: Guia | null) => {
		if (sucio && !window.confirm(`${T.guiaSinGuardar} ¿Descartarlos?`)) return;
		setBorrador(g ? { id: g.id, nombre: g.nombre, markdown: g.markdown, orden: g.orden } : { nombre: "", markdown: "", orden: guias.length + 1 });
		setSucio(false);
		setErrNombre(false);
		setErrGuardar(null);
		window.requestAnimationFrame(() => nombreRef.current?.focus());
	};

	const editar = (cambio: Partial<Borrador>) => {
		setBorrador((b) => (b ? { ...b, ...cambio } : b));
		setSucio(true);
	};

	const guardar = async () => {
		if (!borrador) return;
		if (!borrador.nombre.trim()) {
			setErrNombre(true);
			nombreRef.current?.focus();
			return;
		}
		setGuardando(true);
		setErrGuardar(null);
		try {
			const res = await api.guardarGuia({
				id: borrador.id,
				nombre: borrador.nombre.trim(),
				markdown: borrador.markdown,
				orden: borrador.orden,
			});
			setBorrador({ id: res.guia.id, nombre: res.guia.nombre, markdown: res.guia.markdown, orden: res.guia.orden });
			setSucio(false);
			await cargar();
			anunciar(T.guardado);
		} catch (e) {
			setErrGuardar(e);
		} finally {
			setGuardando(false);
		}
	};

	const borrar = async () => {
		if (!borrador?.id) return;
		setGuardando(true);
		try {
			await api.borrarGuia(borrador.id);
			setBorrando(false);
			setSucio(false);
			const l = await cargar();
			const g = l?.[0];
			setBorrador(g ? { id: g.id, nombre: g.nombre, markdown: g.markdown, orden: g.orden } : null);
			anunciar(T.guiaBorrada);
		} catch (e) {
			setErrGuardar(e);
			setBorrando(false);
		} finally {
			setGuardando(false);
		}
	};

	return (
		<div className="rv-pagina rv-guias">
			<div className="rv-cabecera">
				<h1>{T.guiasTitulo}</h1>
				<a className="rv-btn rv-btn--plano" href={urlInicio()}>
					{T.volverAlInicio}
				</a>
			</div>
			<p className="rv-ayuda" style={{ margin: 0 }}>
				{T.guiasIntro}
			</p>
			<div className="rv-dos">
				<nav aria-label={T.guiasTitulo} style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
					{guias.length === 0 ? <p className="rv-ayuda">{T.guiasVacio}</p> : null}
					<ul className="rv-guias-lista">
						{guias.map((g) => (
							<li key={g.id}>
								<button
									type="button"
									className="rv-btn rv-btn--plano"
									aria-current={borrador?.id === g.id ? "true" : undefined}
									onClick={() => elegir(g)}
								>
									<Icono nombre="libro" tam={16} />
									{g.nombre}
								</button>
							</li>
						))}
					</ul>
					<div>
						<button type="button" className="rv-btn" onClick={() => elegir(null)}>
							{T.guiaNueva}
						</button>
					</div>
				</nav>
				{borrador ? (
					<form
						className="rv-tarjeta"
						noValidate
						onSubmit={(e) => {
							e.preventDefault();
							void guardar();
						}}
					>
						<div className="rv-rejilla">
							<div className="rv-campo">
								<label htmlFor={ids.n}>{T.guiaNombre}</label>
								<input
									id={ids.n}
									ref={nombreRef}
									type="text"
									className="rv-input"
									value={borrador.nombre}
									aria-invalid={errNombre ? true : undefined}
									aria-describedby={errNombre ? `${ids.n}-err` : undefined}
									onChange={(e) => {
										editar({ nombre: e.target.value });
										if (e.target.value.trim()) setErrNombre(false);
									}}
								/>
								{errNombre ? (
									<p className="rv-error" id={`${ids.n}-err`}>
										{T.guiaNombreVacio}
									</p>
								) : null}
							</div>
							<div className="rv-campo">
								<label htmlFor={ids.o}>{T.guiaOrden}</label>
								<input
									id={ids.o}
									type="number"
									inputMode="numeric"
									className="rv-input"
									value={borrador.orden}
									onChange={(e) => editar({ orden: Math.trunc(Number(e.target.value)) || 0 })}
								/>
							</div>
						</div>
						<div className="rv-campo">
							<label htmlFor={ids.m}>{T.guiaTexto}</label>
							<textarea
								id={ids.m}
								className="rv-input rv-markdown"
								value={borrador.markdown}
								spellCheck
								onChange={(e) => editar({ markdown: e.target.value })}
							/>
						</div>
						{errGuardar ? <AvisoError error={errGuardar} /> : null}
						<div className="rv-acciones">
							<button type="submit" className="rv-btn rv-btn--principal" disabled={guardando}>
								{guardando ? T.guardando : T.guardar}
							</button>
							{sucio ? <span className="rv-ayuda">{T.guiaSinGuardar}</span> : null}
							{borrador.id ? (
								<button type="button" className="rv-btn rv-btn--peligro" onClick={() => setBorrando(true)} style={{ marginLeft: "auto" }}>
									{T.borrar}
								</button>
							) : null}
						</div>
					</form>
				) : null}
			</div>
			<Dialogo
				abierto={borrando}
				onCerrar={() => setBorrando(false)}
				titulo={T.guiaBorrarConfirmar(borrador?.nombre ?? "")}
				rol="alertdialog"
				focoInicial={volverRef}
			>
				<div className="rv-acciones">
					<button ref={volverRef} type="button" className="rv-btn" onClick={() => setBorrando(false)}>
						{T.volver}
					</button>
					<button type="button" className="rv-btn rv-btn--peligro" disabled={guardando} onClick={() => void borrar()}>
						{T.borrar}
					</button>
				</div>
			</Dialogo>
		</div>
	);
}
