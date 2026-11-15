/**
 * Inicio: ordenado por «qué me toca». Bienvenida la primera vez, cuántos
 * quedan, barra de aprobados, «Seguir con», bandeja de preguntas que se
 * responden aquí mismo y grupos de artículos.
 */

import * as React from "react";

import type { ArticuloFila, InicioVista, PreguntaVista } from "../lib/types.js";
import { api, mensajeDe, urlAjustes, urlArticulo, urlGuias } from "./api.js";
import { Aviso, AvisoError, EtiquetaPublicacion, EtiquetaRevision, Raiz, useAnuncio } from "./comun.js";
import { Icono } from "./iconos.js";
import { agruparInicio, trabajoActivo } from "./logica.js";
import { activarAtajos, atajosActivos, bienvenidaVista, marcarBienvenidaVista } from "./navegacion.js";
import { T } from "./textos.js";

const POR_PAGINA = 20;

export function InicioPage() {
	return (
		<Raiz>
			<Inicio />
		</Raiz>
	);
}

function Inicio() {
	const { anunciar } = useAnuncio();
	const [datos, setDatos] = React.useState<InicioVista | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [bienvenida, setBienvenida] = React.useState(() => !bienvenidaVista());
	const [necesitan, setNecesitan] = React.useState(false);

	const cargar = React.useCallback(async () => {
		try {
			setDatos(await api.inicio());
			setError(null);
		} catch (e) {
			setError(e);
		}
	}, []);

	React.useEffect(() => {
		void cargar();
	}, [cargar]);

	if (error && !datos) {
		return (
			<div className="rv-pagina">
				<AvisoError error={error} onReintentar={() => void cargar()} />
			</div>
		);
	}
	if (!datos) {
		return (
			<div className="rv-pagina" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}

	const { usuario, config, resumen } = datos;
	const grupos = agruparInicio(datos.articulos, necesitan);
	const quedan = Math.max(0, resumen.total - resumen.aprobados);
	const preguntas = datos.preguntas.filter((p) => !p.respuesta || p.respuesta.tipo === "luego");
	const esAdmin = usuario.esAdmin;

	return (
		<div className="rv-pagina rv-inicio">
			<div className="rv-cabecera">
				<h1>{config.etiqueta}</h1>
				{esAdmin ? (
					<div className="rv-acciones">
						<a className="rv-btn rv-btn--plano" href={urlGuias()}>
							<Icono nombre="libro" />
							{T.enlaceGuias}
						</a>
						<a className="rv-btn rv-btn--plano" href={urlAjustes()}>
							<Icono nombre="ajustes" />
							{T.enlaceAjustes}
						</a>
					</div>
				) : null}
			</div>

			{bienvenida ? (
				<Aviso tono="info">
					<p>{T.bienvenida}</p>
					<div>
						<button
							type="button"
							className="rv-btn"
							onClick={() => {
								marcarBienvenidaVista();
								setBienvenida(false);
							}}
						>
							{T.bienvenidaOk}
						</button>
					</div>
				</Aviso>
			) : null}

			<section className="rv-resumen" aria-label="Resumen">
				<p>{T.teQuedan(quedan)}</p>
				{resumen.total > 0 ? (
					<div className="rv-progreso">
						<label htmlFor="rv-aprobados">{T.aprobadosDe(resumen.aprobados, resumen.total)}</label>
						<progress id="rv-aprobados" max={resumen.total} value={resumen.aprobados}>
							{T.aprobadosDe(resumen.aprobados, resumen.total)}
						</progress>
					</div>
				) : null}
				{datos.seguirCon ? (
					<div>
						<a className="rv-btn rv-btn--principal" href={urlArticulo(datos.seguirCon)}>
							{datos.seguirCon.empezado ? T.seguirCon(datos.seguirCon.titulo) : T.empezarCon(datos.seguirCon.titulo)}
							<Icono nombre="flecha" tam={16} />
						</a>
					</div>
				) : null}
			</section>

			{preguntas.length ? (
				<section className="rv-grupo" aria-labelledby="rv-preguntas-tit">
					<h2 id="rv-preguntas-tit">{T.preguntasTitulo}</h2>
					<p className="rv-ayuda" style={{ margin: 0 }}>
						{T.preguntasIntro}
					</p>
					<ul className="rv-preguntas">
						{preguntas.map((p) => (
							<Pregunta
								key={p.reglaId}
								p={p}
								onRespondida={(nueva, mensaje) => {
									setDatos((d) => (d ? { ...d, preguntas: d.preguntas.map((x) => (x.reglaId === nueva.reglaId ? nueva : x)) } : d));
									anunciar(mensaje);
									// Las respuestas cambian el estado de los artículos afectados.
									void cargar();
								}}
							/>
						))}
					</ul>
				</section>
			) : null}

			{datos.articulos.length === 0 ? <p>{T.listaVacia}</p> : null}

			{esAdmin && datos.articulos.length ? (
				<div>
					<button type="button" className="rv-btn" aria-pressed={necesitan} onClick={() => setNecesitan((n) => !n)}>
						{necesitan ? T.filtroTodos : T.filtroNecesitan}
					</button>
				</div>
			) : null}

			<Grupo id="cambios" titulo={T.grupoCambios} filas={grupos.cambios} esAdmin={esAdmin} />
			<Grupo id="por-revisar" titulo={T.grupoPorRevisar} filas={grupos.porRevisar} esAdmin={esAdmin} />
			<Grupo id="esperando" titulo={T.grupoEsperando} filas={grupos.esperando} esAdmin={esAdmin} atenuado />
			<Grupo id="aprobados" titulo={T.grupoAprobados} filas={grupos.aprobados} esAdmin={esAdmin} plegado />

			<Preferencias />
		</div>
	);
}

// ─── Grupos y filas ──────────────────────────────────────────────────────────

function Grupo({
	id,
	titulo,
	filas,
	esAdmin,
	atenuado,
	plegado,
}: {
	id: string;
	titulo: string;
	filas: ArticuloFila[];
	esAdmin: boolean;
	atenuado?: boolean;
	plegado?: boolean;
}) {
	const [mostrar, setMostrar] = React.useState(POR_PAGINA);
	if (!filas.length) return null;
	const idTit = `rv-g-${id}`;
	const visibles = filas.slice(0, mostrar);
	const resto = filas.length - visibles.length;
	const lista = (
		<>
			<ul className="rv-lista" aria-labelledby={idTit}>
				{visibles.map((f) => (
					<Fila key={`${f.collection}:${f.id}`} f={f} esAdmin={esAdmin} />
				))}
			</ul>
			{resto > 0 ? (
				<div>
					<button type="button" className="rv-btn" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
						{T.verMas(resto)}
					</button>
				</div>
			) : null}
		</>
	);
	const cab = (
		<>
			<h2 id={idTit}>{titulo}</h2> <span className="rv-ayuda">({filas.length})</span>
		</>
	);
	if (plegado) {
		return (
			<details className="rv-grupo">
				<summary>{cab}</summary>
				{lista}
			</details>
		);
	}
	return (
		<section className={`rv-grupo${atenuado ? " rv-grupo--atenuado" : ""}`} aria-labelledby={idTit}>
			<div>{cab}</div>
			{lista}
		</section>
	);
}

function Fila({ f, esAdmin }: { f: ArticuloFila; esAdmin: boolean }) {
	return (
		<li className="rv-fila">
			<a className="rv-fila__titulo" href={urlArticulo(f)}>
				{f.titulo}
			</a>
			<div className="rv-fila__etiquetas">
				<EtiquetaRevision estado={f.estado} aprobacion={f.aprobacion} trabajo={f.trabajo} />
				<EtiquetaPublicacion publicacion={f.publicacion} />
			</div>
			<div className="rv-fila__meta">
				<span>{T.minutos(f.minutosLectura)}</span>
				{f.leido > 0 && f.leido < 100 ? <span>{T.leido(f.leido)}</span> : null}
				{f.preguntasPendientes > 0 ? (
					<span>
						{f.preguntasPendientes} {f.preguntasPendientes === 1 ? "pregunta" : "preguntas"}
					</span>
				) : null}
			</div>
			{esAdmin ? (
				<div className="rv-fila__admin">
					<span>{T.abiertos(f.abiertos)}</span>
					{f.vuelta > 0 ? <span>{T.vuelta(f.vuelta)}</span> : null}
					{f.cambiosPendientes > 0 ? <span>{f.cambiosPendientes} cambios sin revisar</span> : null}
					{f.trabajo ? (
						<span>
							{T.trabajoEtiqueta(f.trabajo.estado)}
							{trabajoActivo(f.trabajo) ? ` (${f.trabajo.motor === "api" ? "API" : "Claude Code"})` : ""}
						</span>
					) : null}
					{f.trabajo?.costeEstimado ? <span>{T.coste(f.trabajo.costeEstimado)}</span> : null}
				</div>
			) : null}
		</li>
	);
}

// ─── Preguntas ───────────────────────────────────────────────────────────────

function Pregunta({ p, onRespondida }: { p: PreguntaVista; onRespondida: (p: PreguntaVista, mensaje: string) => void }) {
	const [cambiando, setCambiando] = React.useState(false);
	const [texto, setTexto] = React.useState("");
	const [errTexto, setErrTexto] = React.useState(false);
	const [enviando, setEnviando] = React.useState(false);
	const [error, setError] = React.useState<unknown>(null);
	const idTit = React.useId();
	const idTexto = React.useId();

	const responder = async (tipo: "correcto" | "quitar" | "cambiar" | "luego", t?: string) => {
		setEnviando(true);
		setError(null);
		try {
			const res = await api.responderPregunta({ reglaId: p.reglaId, tipo, texto: t });
			onRespondida(res.pregunta, tipo === "luego" ? T.respLuegoGuardada : T.respGuardada);
		} catch (e) {
			setError(e);
		} finally {
			setEnviando(false);
		}
	};

	return (
		<li className="rv-pregunta">
			<p className="rv-pregunta__texto" id={idTit}>
				{p.pregunta}
			</p>
			{p.respuesta?.tipo === "luego" ? <p className="rv-ayuda">{T.respPendienteLuego}</p> : null}
			<div>
				<p className="rv-ayuda">{T.preguntaAfecta(p.entradas.length)}</p>
				<ul>
					{p.entradas.map((e) => (
						<li key={e.comentarioId}>
							<a href={urlArticulo(e)}>{e.titulo}</a>
							{e.cita ? <blockquote className="rv-cita">{e.cita}</blockquote> : null}
						</li>
					))}
				</ul>
			</div>
			{cambiando ? (
				<form
					noValidate
					style={{ display: "grid", gap: "0.5rem" }}
					onSubmit={(e) => {
						e.preventDefault();
						if (!texto.trim()) {
							setErrTexto(true);
							return;
						}
						void responder("cambiar", texto.trim());
					}}
				>
					<label htmlFor={idTexto} style={{ fontWeight: 600 }}>
						{T.respCambiarEtiqueta}
					</label>
					<textarea
						id={idTexto}
						className="rv-input"
						value={texto}
						autoFocus
						aria-invalid={errTexto ? true : undefined}
						aria-describedby={errTexto ? `${idTexto}-err` : undefined}
						onChange={(e) => {
							setTexto(e.target.value);
							if (e.target.value.trim()) setErrTexto(false);
						}}
					/>
					{errTexto ? (
						<p className="rv-error" id={`${idTexto}-err`}>
							{T.respCambiarVacio}
						</p>
					) : null}
					<div className="rv-acciones">
						<button type="submit" className="rv-btn rv-btn--principal" disabled={enviando}>
							{T.respCambiarEnviar}
						</button>
						<button type="button" className="rv-btn rv-btn--plano" onClick={() => setCambiando(false)}>
							{T.cancelar}
						</button>
					</div>
				</form>
			) : (
				<div className="rv-acciones" role="group" aria-labelledby={idTit}>
					<button type="button" className="rv-btn" disabled={enviando} onClick={() => void responder("correcto")}>
						<Icono nombre="check" tam={16} />
						{T.respCorrecto}
					</button>
					<button type="button" className="rv-btn" disabled={enviando} onClick={() => void responder("quitar")}>
						{T.respQuitar}
					</button>
					<button type="button" className="rv-btn" disabled={enviando} onClick={() => setCambiando(true)}>
						{T.respCambiar}
					</button>
					{p.respuesta?.tipo !== "luego" ? (
						<button type="button" className="rv-btn rv-btn--plano" disabled={enviando} onClick={() => void responder("luego")}>
							{T.respLuego}
						</button>
					) : null}
				</div>
			)}
			{error ? <p className="rv-error" role="alert">{mensajeDe(error)}</p> : null}
		</li>
	);
}

// ─── Preferencias personales ─────────────────────────────────────────────────

export function Preferencias() {
	const [atajos, setAtajos] = React.useState(() => atajosActivos());
	const id = React.useId();
	return (
		<details className="rv-tarjeta">
			<summary style={{ cursor: "pointer", minHeight: "2.75rem", display: "flex", alignItems: "center", fontWeight: 600 }}>
				{T.ajPersonales}
			</summary>
			<label className="rv-check" htmlFor={id}>
				<input
					id={id}
					type="checkbox"
					checked={atajos}
					aria-describedby={`${id}-ayuda`}
					onChange={(e) => {
						activarAtajos(e.target.checked);
						setAtajos(e.target.checked);
					}}
				/>
				<span>{T.ajAtajos}</span>
			</label>
			<small id={`${id}-ayuda`} className="rv-ayuda">
				{T.ajAtajosAyuda}
			</small>
		</details>
	);
}
