/**
 * Historial de versiones: copias guardadas en cada cambio y en cada
 * publicación, con «Ver diferencias» frente al texto actual y «Restaurar».
 * Restaurar guarda antes el texto actual como copia, así que se puede deshacer.
 */

import * as React from "react";

import type { Aprobacion, ArticuloVista, BloqueComparado, HistorialVista, VersionDetalle, VersionVista } from "../lib/types.js";
import { api } from "./api.js";
import { Segmentos } from "./Cambios.js";
import { AvisoError, fechaCorta, fechaLarga } from "./comun.js";
import { Dialogo } from "./Dialogo.js";
import { T } from "./textos.js";

type Detalle = { estado: "cargando" } | { estado: "error"; error: unknown } | { estado: "listo"; datos: VersionDetalle };

interface Confirmacion {
	version: VersionVista;
	publicar: boolean;
}

function etiquetaBloque(b: BloqueComparado): string {
	if (b.campo === "title") return T.campoTitulo;
	if (b.campo === "excerpt") return T.campoExtracto;
	if (b.campo === "references") return T.campoFuentes;
	if (b.estado === "añadido") return T.bloqueAnadido;
	if (b.estado === "eliminado") return T.bloqueEliminado;
	return T.bloqueCambiado;
}

function Comparacion({ id, detalle }: { id: string; detalle: Detalle | undefined }) {
	if (!detalle || detalle.estado === "cargando") {
		return (
			<div id={id} className="rv-version__dif" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}
	if (detalle.estado === "error") {
		return (
			<div id={id} className="rv-version__dif">
				<AvisoError error={detalle.error} />
			</div>
		);
	}
	const { comparacion } = detalle.datos;
	return (
		<div id={id} className="rv-version__dif">
			{comparacion.length === 0 ? (
				<p>{T.sinDiferencias}</p>
			) : (
				<>
					<p className="rv-version__meta">{T.diferenciasLeyenda}</p>
					<ul className="rv-version__bloques">
						{comparacion.map((b, i) => (
							<li key={`${b.campo}-${b.blockKey ?? ""}-${i}`}>
								<p className="rv-version__etiqueta">{etiquetaBloque(b)}</p>
								{b.soloFormato ? <p className="rv-version__meta">{T.soloFormato}</p> : null}
								<p className="rv-version__texto">
									{b.segmentos.length ? <Segmentos segmentos={b.segmentos} /> : T.sinTexto}
								</p>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}

function FilaVersion({
	v,
	detalle,
	abierta,
	onVer,
	onRestaurar,
}: {
	v: VersionVista;
	detalle: Detalle | undefined;
	abierta: boolean;
	onVer: (v: VersionVista) => void;
	onRestaurar: (c: Confirmacion) => void;
}) {
	const idDif = `rv-dif-${v.id}`;
	return (
		<li className="rv-version">
			<p className="rv-version__motivo">
				<strong>{v.motivo}</strong>
			</p>
			<p className="rv-version__meta">
				<time dateTime={v.fecha}>{fechaCorta(v.fecha)}</time>
				{v.nombre ? ` · ${T.historialPor(v.nombre)}` : ""}
			</p>
			<p className="rv-version__meta">
				{v.igualQueActual ? T.igualQueActual : T.parrafosDistintos(v.resumen.bloquesDistintos)}
			</p>
			<div className="rv-acciones">
				{v.igualQueActual ? null : (
					<button
						type="button"
						className="rv-btn"
						aria-expanded={abierta}
						aria-controls={abierta ? idDif : undefined}
						aria-label={T.verDiferenciasDe(v.motivo)}
						onClick={() => onVer(v)}
					>
						{abierta ? T.ocultarDiferencias : T.verDiferencias}
					</button>
				)}
				{v.igualQueActual ? null : (
					<button
						type="button"
						className="rv-btn"
						aria-label={T.restaurarVersionDe(v.motivo)}
						onClick={() => onRestaurar({ version: v, publicar: false })}
					>
						{T.restaurarVersion}
					</button>
				)}
				{v.tipo === "publicacion" ? (
					<button
						type="button"
						className="rv-btn"
						aria-label={T.restaurarYPublicarDe(v.motivo)}
						onClick={() => onRestaurar({ version: v, publicar: true })}
					>
						{T.restaurarYPublicar}
					</button>
				) : null}
			</div>
			{abierta ? <Comparacion id={idDif} detalle={detalle} /> : null}
		</li>
	);
}

function Seccion({
	titulo,
	lista,
	...resto
}: {
	titulo: string;
	lista: VersionVista[];
	detalles: Record<string, Detalle>;
	abiertas: Set<string>;
	onVer: (v: VersionVista) => void;
	onRestaurar: (c: Confirmacion) => void;
}) {
	const idTit = React.useId();
	return (
		<section className="rv-historial__seccion" aria-labelledby={idTit}>
			<h3 id={idTit}>{titulo}</h3>
			<p className="rv-version__meta">{T.historialRotacion}</p>
			{lista.length === 0 ? (
				<p>{T.historialSeccionVacia}</p>
			) : (
				<ul className="rv-historial__lista">
					{lista.map((v) => (
						<FilaVersion
							key={v.id}
							v={v}
							detalle={resto.detalles[v.id]}
							abierta={resto.abiertas.has(v.id)}
							onVer={resto.onVer}
							onRestaurar={resto.onRestaurar}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

export function DialogoHistorial({
	abierto,
	onCerrar,
	vista,
	onRestaurado,
}: {
	abierto: boolean;
	onCerrar: () => void;
	vista: ArticuloVista;
	onRestaurado: (v: ArticuloVista, publicado: boolean) => void;
}) {
	const cerrarRef = React.useRef<HTMLButtonElement>(null);
	const seguro = React.useRef<HTMLButtonElement>(null);
	const [datos, setDatos] = React.useState<HistorialVista | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [detalles, setDetalles] = React.useState<Record<string, Detalle>>({});
	const [abiertas, setAbiertas] = React.useState<Set<string>>(() => new Set());
	const [conf, setConf] = React.useState<Confirmacion | null>(null);
	const [aviso, setAviso] = React.useState<{ motivo: string; aprobacion: Aprobacion | null } | null>(null);
	const [errorConf, setErrorConf] = React.useState<unknown>(null);
	const [enviando, setEnviando] = React.useState(false);
	const { collection, id } = vista.articulo;

	const cargar = React.useCallback(async () => {
		setError(null);
		setDatos(null);
		try {
			setDatos(await api.versiones({ collection, id }));
		} catch (e) {
			setError(e);
		}
	}, [collection, id]);

	React.useEffect(() => {
		if (!abierto) return;
		setDetalles({});
		setAbiertas(new Set());
		setConf(null);
		void cargar();
	}, [abierto, cargar]);

	const onVer = (v: VersionVista) => {
		setAbiertas((prev) => {
			const s = new Set(prev);
			if (s.has(v.id)) s.delete(v.id);
			else s.add(v.id);
			return s;
		});
		const d = detalles[v.id];
		if (d && d.estado !== "error") return;
		setDetalles((p) => ({ ...p, [v.id]: { estado: "cargando" } }));
		api
			.verVersion(v.id)
			.then((datos) => setDetalles((p) => ({ ...p, [v.id]: { estado: "listo", datos } })))
			.catch((e: unknown) => setDetalles((p) => ({ ...p, [v.id]: { estado: "error", error: e } })));
	};

	const onRestaurar = (c: Confirmacion) => {
		setAviso(null);
		setErrorConf(null);
		setConf(c);
	};

	const restaurar = async () => {
		if (!conf) return;
		setEnviando(true);
		setErrorConf(null);
		try {
			const res = await api.restaurarVersion({ id: conf.version.id, publicar: conf.publicar || undefined, confirmar: aviso ? true : undefined });
			if (res.requiereConfirmacion) {
				setAviso({ motivo: res.motivo, aprobacion: res.aprobacion });
				seguro.current?.focus();
			} else {
				const publicado = conf.publicar;
				setConf(null);
				onRestaurado(res, publicado);
			}
		} catch (e) {
			setErrorConf(e);
		} finally {
			setEnviando(false);
		}
	};

	const soloAdmin = vista.config.requiereAprobacion && !vista.usuario.esAdmin;
	const vacio = !!datos && datos.cambios.length === 0 && datos.publicaciones.length === 0;

	return (
		<Dialogo abierto={abierto} onCerrar={onCerrar} titulo={T.historial} focoInicial={cerrarRef} ancho>
			<div className="rv-historial">
				<div className="rv-historial__cab">
					<p>{T.historialIntro}</p>
					<button ref={cerrarRef} type="button" className="rv-btn" onClick={onCerrar}>
						{T.cerrar}
					</button>
				</div>
				{error ? (
					<AvisoError error={error} onReintentar={() => void cargar()} />
				) : !datos ? (
					<p aria-busy="true">{T.cargando}</p>
				) : vacio ? (
					<p>{T.historialVacio}</p>
				) : (
					<>
						{datos.publicada ? (
							<p className="rv-version__meta">
								{datos.publicada.hash === datos.actual.hash ? T.historialActualPublicado : T.historialActualSinPublicar}
							</p>
						) : null}
						<Seccion
							titulo={T.historialCambios}
							lista={datos.cambios}
							detalles={detalles}
							abiertas={abiertas}
							onVer={onVer}
							onRestaurar={onRestaurar}
						/>
						<Seccion
							titulo={T.historialPublicadas}
							lista={datos.publicaciones}
							detalles={detalles}
							abiertas={abiertas}
							onVer={onVer}
							onRestaurar={onRestaurar}
						/>
					</>
				)}
			</div>

			<Dialogo
				abierto={!!conf}
				onCerrar={() => setConf(null)}
				titulo={conf?.publicar ? T.restaurarYPublicarTitulo : T.restaurarTitulo}
				rol="alertdialog"
				focoInicial={seguro}
			>
				{conf ? (
					<>
						<p>
							<strong>{conf.version.motivo}</strong> · {fechaCorta(conf.version.fecha)}
						</p>
						<p>{T.restaurarTexto}</p>
						{conf.publicar && !aviso ? <p>{T.restaurarYPublicarTexto}</p> : null}
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
						) : null}
						{errorConf ? <AvisoError error={errorConf} /> : null}
						<div className="rv-acciones">
							<button ref={seguro} type="button" className="rv-btn" onClick={() => setConf(null)}>
								{T.cancelar}
							</button>
							{aviso && soloAdmin ? null : (
								<button
									type="button"
									className="rv-btn rv-btn--principal"
									disabled={enviando}
									aria-busy={enviando || undefined}
									onClick={() => void restaurar()}
								>
									{enviando
										? T.restaurando
										: aviso
											? T.restaurarYPublicarIgualmente
											: conf.publicar
												? T.restaurarYPublicar
												: T.restaurar}
								</button>
							)}
						</div>
					</>
				) : null}
			</Dialogo>
		</Dialogo>
	);
}
