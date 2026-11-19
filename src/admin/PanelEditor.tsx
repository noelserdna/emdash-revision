/**
 * Panel «Revisión médica» en la barra lateral del editor de artículos de EmDash
 * (`contentEditorPanels`). La revisora pide un cambio a la IA sin salir del
 * editor; la IA lo aplica sobre el texto guardado como «cambios por ver», el
 * editor se recarga para mostrarlo y aquí mismo se da el visto bueno o se deshace.
 *
 * EmDash no deja a un panel React leer ni tocar lo que hay sin guardar: por eso
 * se pide guardar antes y se recarga después.
 */

import * as React from "react";

import { textoDeBloque } from "../lib/bloques.js";
import type { ArticuloVista, CambioVista, PTNode, Veredicto } from "../lib/types.js";
import { api, llamar, mensajeDe, urlArticulo } from "./api.js";
import { Marcado } from "./Cambios.js";

interface Props {
	collection: string;
	entry: { id: string; updatedAt?: string | null };
}

const ESTADO: Record<string, string> = {
	por_revisar: "Por revisar",
	con_comentarios: "Con comentarios abiertos",
	cambios_por_ver: "Con cambios de la IA por ver",
	aprobado: "Aprobado",
};

const fuente = "system-ui, -apple-system, sans-serif";
const s = {
	caja: { fontFamily: fuente, fontSize: "0.875rem", lineHeight: 1.5, display: "grid", gap: "0.875rem" } as React.CSSProperties,
	tenue: { margin: 0, opacity: 0.75, fontSize: "0.8125rem" } as React.CSSProperties,
	cambio: { border: "1px solid rgba(127,127,127,0.35)", borderRadius: 8, padding: "0.625rem", display: "grid", gap: "0.5rem" } as React.CSSProperties,
	botones: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } as React.CSSProperties,
	boton: { font: "inherit", padding: "0.375rem 0.75rem", borderRadius: 6, border: "1px solid rgba(127,127,127,0.5)", background: "transparent", cursor: "pointer" } as React.CSSProperties,
	principal: { font: "inherit", padding: "0.5rem 0.875rem", borderRadius: 6, border: "none", background: "#a8483b", color: "#fff", cursor: "pointer", fontWeight: 600 } as React.CSSProperties,
	area: { font: "inherit", width: "100%", boxSizing: "border-box", minHeight: "6rem", padding: "0.5rem", borderRadius: 6, border: "1px solid rgba(127,127,127,0.5)", background: "transparent", color: "inherit", resize: "vertical" } as React.CSSProperties,
	error: { margin: 0, padding: "0.5rem", borderRadius: 6, background: "rgba(200,40,40,0.12)" } as React.CSSProperties,
	ok: { margin: 0, padding: "0.5rem", borderRadius: 6, background: "rgba(40,140,80,0.12)" } as React.CSSProperties,
};

/** Los estilos del plugin no se cargan dentro del editor de EmDash: lo mínimo, acotado al panel. */
const CSS = `
.rv-panel .rv-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.rv-panel del{background:light-dark(#fde4e1,#4a1712);color:light-dark(#8f1d12,#ffb4ab);text-decoration:line-through}
.rv-panel ins{background:light-dark(#ddf4e4,#123b22);color:light-dark(#0f5a2a,#a8f0c0);text-decoration:underline;text-underline-offset:0.18em}
.rv-panel button:disabled{opacity:0.5;cursor:default}
`;

function texto(x: PTNode | string | null): string {
	if (x === null || x === undefined) return "";
	if (typeof x === "string") return x;
	try {
		return textoDeBloque(x);
	} catch {
		return "";
	}
}

function recargarPronto(): void {
	window.setTimeout(() => window.location.reload(), 1200);
}

function Cambio({ c, ocupado, onVeredicto }: { c: CambioVista; ocupado: boolean; onVeredicto: (v: Veredicto) => void }) {
	const antes = texto(c.antes);
	const despues = texto(c.despues);
	return (
		<div style={s.cambio}>
			<p style={{ margin: 0 }}>
				{c.op === "insertar" ? (
					<>
						<strong>Añade:</strong> {despues}
					</>
				) : c.op === "eliminar" ? (
					<>
						<strong>Quita:</strong> <del>{antes}</del>
					</>
				) : (
					<Marcado antes={antes} despues={despues} />
				)}
			</p>
			{c.avisos.map((a, i) => (
				<p key={i} style={s.tenue}>
					⚠️ {a.mensaje}
				</p>
			))}
			<div style={s.botones}>
				<button type="button" style={s.boton} disabled={ocupado} onClick={() => onVeredicto("bien")}>
					Vale
				</button>
				<button type="button" style={s.boton} disabled={ocupado} onClick={() => onVeredicto("deshecho")}>
					Deshacer
				</button>
			</div>
		</div>
	);
}

export function PanelEditor({ collection, entry }: Props) {
	const clave = React.useMemo(() => ({ collection, id: entry.id }), [collection, entry.id]);
	const [vista, setVista] = React.useState<ArticuloVista | null>(null);
	const [pedido, setPedido] = React.useState("");
	const [ocupado, setOcupado] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [hecho, setHecho] = React.useState<string | null>(null);

	const cargar = React.useCallback(() => {
		api
			.articulo(clave)
			.then((v) => setVista(v))
			.catch((e: unknown) => setError(mensajeDe(e)));
	}, [clave]);

	React.useEffect(() => {
		cargar();
	}, [cargar, entry.updatedAt]);

	const pendientes = (vista?.cambios ?? []).filter((c) => c.veredicto === "pendiente").sort((a, b) => a.orden - b.orden);

	const pedir = async (e: React.FormEvent) => {
		e.preventDefault();
		const t = pedido.trim();
		if (!t || ocupado) return;
		setOcupado(true);
		setError(null);
		setHecho(null);
		try {
			const antes = pendientes.length;
			const v = await llamar<ArticuloVista>("editor/pedir", { ...clave, texto: t });
			const nuevos = v.cambios.filter((c) => c.veredicto === "pendiente").length - antes;
			setVista(v);
			setPedido("");
			if (nuevos > 0) {
				setHecho(`La IA ha preparado ${nuevos} cambio${nuevos === 1 ? "" : "s"}. Recargando el editor para que lo veas…`);
				recargarPronto();
			} else {
				setHecho("La IA no ha cambiado nada con esa indicación.");
			}
		} catch (err) {
			setError(mensajeDe(err));
		} finally {
			setOcupado(false);
		}
	};

	const veredicto = async (c: CambioVista, v: Veredicto) => {
		setOcupado(true);
		setError(null);
		try {
			await api.veredicto({ id: c.id, veredicto: v });
			if (v === "deshecho") {
				setHecho("Deshecho. Recargando el editor…");
				recargarPronto();
			} else {
				cargar();
			}
		} catch (err) {
			setError(mensajeDe(err));
		} finally {
			setOcupado(false);
		}
	};

	const estado = vista ? (ESTADO[vista.revision.estado] ?? vista.revision.estado) : "…";
	const aprobacion = vista?.revision.estado === "aprobado" ? vista.revision.aprobacion : null;

	return (
		<div className="rv-panel" style={s.caja}>
			<style>{CSS}</style>
			<p style={s.tenue}>
				{aprobacion
					? `Aprobado por ${aprobacion.nombre} el ${new Date(aprobacion.fecha).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`
					: estado}
			</p>

			{error ? (
				<p role="alert" style={s.error}>
					{error}
				</p>
			) : null}
			{hecho ? (
				<p role="status" style={s.ok}>
					{hecho}
				</p>
			) : null}

			{pendientes.length > 0 ? (
				<section style={{ display: "grid", gap: "0.5rem" }}>
					<p style={{ margin: 0, fontWeight: 600 }}>
						Cambios de la IA por revisar ({pendientes.length})
					</p>
					{pendientes.map((c) => (
						<Cambio key={c.id} c={c} ocupado={ocupado} onVeredicto={(v) => void veredicto(c, v)} />
					))}
				</section>
			) : null}

			<form onSubmit={(e) => void pedir(e)} style={{ display: "grid", gap: "0.5rem" }}>
				<label htmlFor={`rv-pedido-${entry.id}`} style={{ fontWeight: 600 }}>
					¿Qué quieres que cambie la IA?
				</label>
				<textarea
					id={`rv-pedido-${entry.id}`}
					style={s.area}
					value={pedido}
					disabled={ocupado}
					placeholder="Por ejemplo: «simplifica el apartado de tratamientos» o «usa la cifra española en vez de la de EE. UU.»"
					onChange={(e) => setPedido(e.target.value)}
				/>
				<div>
					<button type="submit" style={s.principal} disabled={ocupado || !pedido.trim()}>
						{ocupado ? "La IA está trabajando…" : "Proponer el cambio"}
					</button>
				</div>
				<p style={s.tenue}>
					Guarda antes de pedirlo: la IA trabaja sobre el texto guardado y tarda entre 10 segundos y un minuto. Al terminar, el editor se recarga y verás el cambio marcado aquí para darle el visto bueno o deshacerlo.
				</p>
			</form>

			<p style={{ margin: 0 }}>
				<a href={urlArticulo(clave)}>Abrir en Revisión médica →</a>
			</p>
		</div>
	);
}
