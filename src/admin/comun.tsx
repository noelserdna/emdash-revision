/**
 * Piezas comunes: raíz del plugin (lang="es", estilos y regiones vivas siempre
 * montadas), avisos, etiquetas y la alerta de sesión caducada.
 */

import * as React from "react";

import type { Aprobacion, EstadoRevision, Publicacion, TrabajoVista } from "../lib/types.js";
import { esSesionCaducada, mensajeDe } from "./api.js";
import { useEstilos } from "./estilos.js";
import { Icono, type NombreIcono } from "./iconos.js";
import { etiquetaRevision } from "./logica.js";
import { recargar } from "./navegacion.js";
import { T } from "./textos.js";

// ─── Regiones vivas ──────────────────────────────────────────────────────────

interface Anunciador {
	/** Mensaje cortés (role="status"). */
	anunciar: (texto: string) => void;
	/** Mensaje urgente (role="alert"). */
	alertar: (texto: string) => void;
}

const ContextoAnuncio = React.createContext<Anunciador>({ anunciar: () => {}, alertar: () => {} });

export function useAnuncio(): Anunciador {
	return React.useContext(ContextoAnuncio);
}

/** Raíz de cada página del plugin. */
export function Raiz({ children, className }: { children: React.ReactNode; className?: string }) {
	useEstilos();
	const [estado, setEstado] = React.useState("");
	const [alerta, setAlerta] = React.useState("");
	const temporizadores = React.useRef<number[]>([]);

	const valor = React.useMemo<Anunciador>(() => {
		// Vaciar y volver a escribir hace que se anuncie aunque el texto se repita.
		const poner = (set: (s: string) => void) => (texto: string) => {
			set("");
			temporizadores.current.push(window.setTimeout(() => set(texto), 60));
		};
		return { anunciar: poner(setEstado), alertar: poner(setAlerta) };
	}, []);

	React.useEffect(() => () => temporizadores.current.forEach((t) => window.clearTimeout(t)), []);

	return (
		<ContextoAnuncio.Provider value={valor}>
			<div className={`rv-root${className ? ` ${className}` : ""}`} lang="es">
				<div role="status" aria-live="polite" aria-atomic="true" className="rv-sr">
					{estado}
				</div>
				<div role="alert" aria-atomic="true" className="rv-sr">
					{alerta}
				</div>
				{children}
			</div>
		</ContextoAnuncio.Provider>
	);
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

export function Aviso({
	tono = "info",
	icono,
	children,
	id,
}: {
	tono?: "info" | "ok" | "aviso" | "error";
	icono?: NombreIcono;
	children: React.ReactNode;
	id?: string;
}) {
	const ic: NombreIcono = icono ?? (tono === "ok" ? "check" : tono === "info" ? "info" : "alerta");
	return (
		<div className={`rv-aviso rv-aviso--${tono}`} id={id}>
			<Icono nombre={ic} />
			<div className="rv-aviso__cuerpo">{children}</div>
		</div>
	);
}

/** Error de carga o de acción, con la salida adecuada si la sesión caducó. */
export function AvisoError({ error, onReintentar }: { error: unknown; onReintentar?: () => void }) {
	const caducada = esSesionCaducada(error);
	return (
		<Aviso tono="error">
			<p>{mensajeDe(error)}</p>
			{caducada ? (
				<div className="rv-acciones">
					<button type="button" className="rv-btn" onClick={recargar}>
						{T.volverAEntrar}
					</button>
				</div>
			) : onReintentar ? (
				<div className="rv-acciones">
					<button type="button" className="rv-btn" onClick={onReintentar}>
						{T.reintentar}
					</button>
				</div>
			) : null}
		</Aviso>
	);
}

// ─── Etiquetas ───────────────────────────────────────────────────────────────

export function EtiquetaRevision(props: {
	estado: EstadoRevision;
	aprobacion: Aprobacion | null;
	trabajo: TrabajoVista | null;
}) {
	const e = etiquetaRevision(props);
	return (
		<span className={`rv-etiqueta rv-etiqueta--${e.tono}`}>
			<Icono nombre={e.icono} tam={14} />
			{e.texto}
		</span>
	);
}

export function EtiquetaPublicacion({ publicacion }: { publicacion: Publicacion }) {
	const texto = T.publicacion(publicacion);
	if (!texto) return null;
	return (
		<span className="rv-etiqueta rv-etiqueta--pub">
			<Icono nombre="publicado" tam={14} />
			{texto}
		</span>
	);
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

export function fechaLarga(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function fechaCorta(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

// ─── Ancho del contenedor ────────────────────────────────────────────────────

/** true si el contenedor mide al menos `minimo` px (por defecto 900, el corte del panel lateral). */
export function useAnchoMinimo(ref: React.RefObject<HTMLElement | null>, minimo = 900): boolean {
	const [ancho, setAncho] = React.useState(true);
	// El contenedor puede montarse después (estado de carga): se vuelve a mirar en
	// cada render y se engancha el observador cuando aparece o cambia el elemento.
	const [el, setEl] = React.useState<HTMLElement | null>(null);
	React.useLayoutEffect(() => {
		if (ref.current !== el) setEl(ref.current);
	});
	React.useLayoutEffect(() => {
		if (!el || typeof ResizeObserver === "undefined") return;
		const medir = () => setAncho(el.getBoundingClientRect().width >= minimo);
		medir();
		const ro = new ResizeObserver(medir);
		ro.observe(el);
		return () => ro.disconnect();
	}, [el, minimo]);
	return ancho;
}
