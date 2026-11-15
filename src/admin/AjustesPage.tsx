/**
 * Ajustes de revisión (solo administrador): todos los campos de `Ajustes`,
 * estado de la clave, gasto del mes y URL del MCP. Al final, las preferencias
 * personales de este dispositivo.
 */

import * as React from "react";

import { COPIAS_MAX, COPIAS_MIN, type Ajustes, type AjustesVista, type Esfuerzo, type ModeloId, type Motor } from "../lib/types.js";
import { api, esSinPermiso, urlInicio } from "./api.js";
import { Aviso, AvisoError, Raiz, useAnuncio } from "./comun.js";
import { Preferencias } from "./InicioPage.js";
import { T } from "./textos.js";

const ESFUERZOS: Esfuerzo[] = ["low", "medium", "high", "xhigh"];

export function AjustesPage() {
	return (
		<Raiz>
			<PaginaAjustes />
		</Raiz>
	);
}

function PaginaAjustes() {
	const { anunciar, alertar } = useAnuncio();
	const [vista, setVista] = React.useState<AjustesVista | null>(null);
	const [form, setForm] = React.useState<Ajustes | null>(null);
	const [error, setError] = React.useState<unknown>(null);
	const [errGuardar, setErrGuardar] = React.useState<unknown>(null);
	const [guardando, setGuardando] = React.useState(false);
	const [errCorreo, setErrCorreo] = React.useState(false);
	const [errNombreGuia, setErrNombreGuia] = React.useState(false);
	const id = React.useId();
	const f = (s: string) => `${id}-${s}`;

	const cargar = React.useCallback(async () => {
		try {
			const v = await api.ajustes();
			setVista(v);
			setForm(v.ajustes);
			setError(null);
		} catch (e) {
			setError(e);
		}
	}, []);

	React.useEffect(() => {
		void cargar();
	}, [cargar]);

	if (error && !vista) {
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
	if (!vista || !form) {
		return (
			<div className="rv-pagina" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}

	const poner = <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => setForm((a) => (a ? { ...a, [k]: v } : a));

	const guardar = async () => {
		if (form.avisarA && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.avisarA.trim())) {
			setErrCorreo(true);
			document.getElementById(f("avisar"))?.focus();
			return;
		}
		setErrCorreo(false);
		if (!form.nombreGuiaAprendida.trim()) {
			setErrNombreGuia(true);
			document.getElementById(f("nombre-guia"))?.focus();
			return;
		}
		setErrNombreGuia(false);
		setGuardando(true);
		setErrGuardar(null);
		try {
			const v = await api.guardarAjustes({
				...form,
				avisarA: form.avisarA.trim(),
				adminNombre: form.adminNombre.trim(),
				nombreGuiaAprendida: form.nombreGuiaAprendida.trim(),
			});
			setVista(v);
			setForm(v.ajustes);
			anunciar(T.ajGuardados);
		} catch (e) {
			setErrGuardar(e);
			alertar(e instanceof Error ? e.message : T.errorGenerico);
		} finally {
			setGuardando(false);
		}
	};

	const copiar = async () => {
		try {
			await navigator.clipboard.writeText(vista.mcpUrl);
			anunciar(T.ajCopiado);
		} catch {
			(document.getElementById(f("mcp")) as HTMLInputElement | null)?.select();
		}
	};

	return (
		<div className="rv-pagina">
			<div className="rv-cabecera">
				<h1>{T.ajustesTitulo}</h1>
				<a className="rv-btn rv-btn--plano" href={urlInicio()}>
					{T.volverAlInicio}
				</a>
			</div>
			<form
				noValidate
				style={{ display: "grid", gap: "1.5rem" }}
				onSubmit={(e) => {
					e.preventDefault();
					void guardar();
				}}
			>
				<section className="rv-tarjeta" aria-labelledby={f("t-ia")}>
					<h2 id={f("t-ia")}>{T.ajIA}</h2>
					<ClaveApi
						vista={vista}
						onCambio={(v) => {
							setVista(v);
							setForm((a) => (a ? { ...a } : a));
						}}
						anunciar={anunciar}
						alertar={alertar}
					/>
					<p style={{ margin: 0 }}>{T.ajGasto(vista.gastoMes, form.topeMensualUsd)}</p>
					<div className="rv-rejilla">
						<div className="rv-campo">
							<label htmlFor={f("modelo")}>{T.ajModelo}</label>
							<select id={f("modelo")} className="rv-input" value={form.modeloDefecto} onChange={(e) => poner("modeloDefecto", e.target.value as ModeloId)}>
								{vista.modelos.map((m) => (
									<option key={m.id} value={m.id}>
										{m.nombre} · {m.costeOrientativo}
									</option>
								))}
							</select>
						</div>
						<div className="rv-campo">
							<label htmlFor={f("esfuerzo")}>{T.ajEsfuerzo}</label>
							<select id={f("esfuerzo")} className="rv-input" value={form.esfuerzo} onChange={(e) => poner("esfuerzo", e.target.value as Esfuerzo)}>
								{ESFUERZOS.map((x) => (
									<option key={x} value={x}>
										{T.esfuerzo(x)}
									</option>
								))}
							</select>
						</div>
						<div className="rv-campo">
							<label htmlFor={f("tope")}>{T.ajTope}</label>
							<input
								id={f("tope")}
								type="number"
								min={0}
								step={1}
								inputMode="decimal"
								className="rv-input"
								value={form.topeMensualUsd}
								onChange={(e) => poner("topeMensualUsd", Math.max(0, Number(e.target.value) || 0))}
							/>
						</div>
					</div>
				</section>

				<section className="rv-tarjeta" aria-labelledby={f("t-flujo")}>
					<h2 id={f("t-flujo")}>{T.ajFlujo}</h2>
					<fieldset className="rv-radios">
						<legend>{T.ajMotor}</legend>
						{(["local", "api"] as Motor[]).map((m) => (
							<label key={m} className="rv-check">
								<input type="radio" name={f("motor")} value={m} checked={form.motorHeTerminado === m} onChange={() => poner("motorHeTerminado", m)} />
								<span>{m === "local" ? T.ajMotorLocal : T.ajMotorApi}</span>
							</label>
						))}
					</fieldset>
					<fieldset className="rv-radios">
						<legend>{T.ajRol}</legend>
						{[40, 50].map((r) => (
							<label key={r} className="rv-check">
								<input type="radio" name={f("rol")} value={r} checked={form.rolAprueba === r} onChange={() => poner("rolAprueba", r)} />
								<span>{r === 40 ? T.ajRolEditor : T.ajRolAdmin}</span>
							</label>
						))}
					</fieldset>
					<label className="rv-check">
						<input type="checkbox" checked={form.requiereAprobacion} onChange={(e) => poner("requiereAprobacion", e.target.checked)} />
						<span>{T.ajRequiere}</span>
					</label>
					<div className="rv-rejilla">
						<div className="rv-campo">
							<label htmlFor={f("admin")}>{T.ajAdminNombre}</label>
							<input id={f("admin")} type="text" className="rv-input" value={form.adminNombre} onChange={(e) => poner("adminNombre", e.target.value)} />
						</div>
						<div className="rv-campo">
							<label htmlFor={f("avisar")}>{T.ajAvisarA}</label>
							<input
								id={f("avisar")}
								type="email"
								autoComplete="email"
								className="rv-input"
								value={form.avisarA}
								aria-invalid={errCorreo ? true : undefined}
								aria-describedby={errCorreo ? f("avisar-err") : undefined}
								onChange={(e) => {
									poner("avisarA", e.target.value);
									setErrCorreo(false);
								}}
							/>
							{errCorreo ? (
								<p className="rv-error" id={f("avisar-err")}>
									Escribe un correo válido o deja el campo vacío.
								</p>
							) : null}
						</div>
					</div>
					<div className="rv-campo">
						<label htmlFor={f("terminos")}>{T.ajTerminos}</label>
						<textarea
							id={f("terminos")}
							className="rv-input"
							value={form.terminosSensibles}
							aria-describedby={f("terminos-ayuda")}
							onChange={(e) => poner("terminosSensibles", e.target.value)}
						/>
						<small id={f("terminos-ayuda")}>{T.ajTerminosAyuda}</small>
					</div>
				</section>

				<section className="rv-tarjeta" aria-labelledby={f("t-versiones")}>
					<h2 id={f("t-versiones")}>{T.ajVersiones}</h2>
					<p className="rv-ayuda" style={{ margin: 0 }}>
						{T.ajVersionesAyuda}
					</p>
					<div className="rv-rejilla">
						<div className="rv-campo">
							<label htmlFor={f("copias-cambios")}>{T.ajCopiasCambios}</label>
							<input
								id={f("copias-cambios")}
								type="number"
								min={COPIAS_MIN}
								max={COPIAS_MAX}
								step={1}
								inputMode="numeric"
								className="rv-input"
								aria-describedby={f("copias-cambios-ayuda")}
								value={form.copiasCambios}
								onChange={(e) => poner("copiasCambios", Math.min(COPIAS_MAX, Math.max(COPIAS_MIN, Math.round(Number(e.target.value) || COPIAS_MIN))))}
							/>
							<small id={f("copias-cambios-ayuda")}>{T.ajCopiasCambiosAyuda}</small>
						</div>
						<div className="rv-campo">
							<label htmlFor={f("copias-publicaciones")}>{T.ajCopiasPublicaciones}</label>
							<input
								id={f("copias-publicaciones")}
								type="number"
								min={COPIAS_MIN}
								max={COPIAS_MAX}
								step={1}
								inputMode="numeric"
								className="rv-input"
								aria-describedby={f("copias-publicaciones-ayuda")}
								value={form.copiasPublicaciones}
								onChange={(e) => poner("copiasPublicaciones", Math.min(COPIAS_MAX, Math.max(COPIAS_MIN, Math.round(Number(e.target.value) || COPIAS_MIN))))}
							/>
							<small id={f("copias-publicaciones-ayuda")}>{T.ajCopiasPublicacionesAyuda}</small>
						</div>
					</div>
				</section>

				<section className="rv-tarjeta" aria-labelledby={f("t-aprendizaje")}>
					<h2 id={f("t-aprendizaje")}>{T.ajAprendizaje}</h2>
					<p className="rv-ayuda" style={{ margin: 0 }}>
						{T.ajAprendizajeAyuda}
					</p>
					<label className="rv-check">
						<input type="checkbox" checked={form.aprenderAuto} onChange={(e) => poner("aprenderAuto", e.target.checked)} />
						<span>{T.ajAprenderAuto}</span>
					</label>
					<div style={{ display: "grid", gap: "0.125rem" }}>
						<label className="rv-check">
							<input
								type="checkbox"
								checked={form.aprenderDeAdministradores}
								aria-describedby={f("admins-ayuda")}
								onChange={(e) => poner("aprenderDeAdministradores", e.target.checked)}
							/>
							<span>{T.ajAprenderAdmins}</span>
						</label>
						<small className="rv-ayuda" id={f("admins-ayuda")} style={{ paddingLeft: "1.875rem" }}>
							{T.ajAprenderAdminsAyuda}
						</small>
					</div>
					<div className="rv-rejilla">
						<div className="rv-campo">
							<label htmlFor={f("hora")}>{T.ajHoraAprendizaje}</label>
							<select
								id={f("hora")}
								className="rv-input"
								value={form.horaAprendizaje}
								disabled={!form.aprenderAuto}
								aria-describedby={f("hora-ayuda")}
								onChange={(e) => poner("horaAprendizaje", Number(e.target.value))}
							>
								{Array.from({ length: 24 }, (_, h) => (
									<option key={h} value={h}>
										{`${String(h).padStart(2, "0")}:00`}
									</option>
								))}
							</select>
							<small id={f("hora-ayuda")}>{T.ajHoraAprendizajeAyuda}</small>
						</div>
						<div className="rv-campo">
							<label htmlFor={f("nombre-guia")}>{T.ajNombreGuia}</label>
							<input
								id={f("nombre-guia")}
								type="text"
								className="rv-input"
								value={form.nombreGuiaAprendida}
								aria-invalid={errNombreGuia ? true : undefined}
								aria-describedby={errNombreGuia ? f("nombre-guia-err") : undefined}
								onChange={(e) => {
									poner("nombreGuiaAprendida", e.target.value);
									if (e.target.value.trim()) setErrNombreGuia(false);
								}}
							/>
							{errNombreGuia ? (
								<p className="rv-error" id={f("nombre-guia-err")}>
									{T.ajNombreGuiaVacio}
								</p>
							) : null}
						</div>
					</div>
				</section>

				<section className="rv-tarjeta" aria-labelledby={f("t-mcp")}>
					<h2 id={f("t-mcp")}>{T.ajMcp}</h2>
					<p className="rv-ayuda" style={{ margin: 0 }} id={f("mcp-ayuda")}>
						{T.ajMcpAyuda}
					</p>
					<div className="rv-copiar">
						<input
							id={f("mcp")}
							type="text"
							readOnly
							className="rv-input rv-mono"
							value={vista.mcpUrl}
							aria-label="URL del servidor MCP"
							aria-describedby={f("mcp-ayuda")}
							onFocus={(e) => e.currentTarget.select()}
						/>
						<button type="button" className="rv-btn" onClick={() => void copiar()}>
							{T.ajCopiar}
						</button>
					</div>
				</section>

				{errGuardar ? <AvisoError error={errGuardar} /> : null}
				<div className="rv-acciones">
					<button type="submit" className="rv-btn rv-btn--principal" disabled={guardando}>
						{guardando ? T.guardando : T.guardar}
					</button>
				</div>
			</form>
			<Preferencias />
		</div>
	);
}

/**
 * Campo para pegar la clave de Anthropic. Nunca se muestra la clave guardada:
 * solo de dónde sale y sus últimos 4 caracteres. Va dentro del formulario de
 * ajustes, así que no es un <form> propio: Enter en el campo guarda la clave.
 */
function ClaveApi({
	vista,
	onCambio,
	anunciar,
	alertar,
}: {
	vista: AjustesVista;
	onCambio: (v: AjustesVista) => void;
	anunciar: (m: string) => void;
	alertar: (m: string) => void;
}) {
	const id = React.useId();
	const [valor, setValor] = React.useState("");
	const [error, setError] = React.useState<string | null>(null);
	const [ocupado, setOcupado] = React.useState(false);
	const [confirmarBorrar, setConfirmarBorrar] = React.useState(false);
	const [editando, setEditando] = React.useState(!vista.apiDisponible);
	const campo = React.useRef<HTMLInputElement>(null);

	const estado =
		vista.claveOrigen === "panel" && vista.claveFinal
			? T.ajClavePanel(vista.claveFinal)
			: vista.claveOrigen === "servidor" && vista.claveFinal
				? T.ajClaveServidor(vista.claveFinal)
				: T.ajClaveNo;

	const guardar = async () => {
		if (!valor.trim()) {
			setError(T.ajClaveVacia);
			campo.current?.focus();
			return;
		}
		setOcupado(true);
		setError(null);
		try {
			const v = await api.guardarClave(valor.trim());
			setValor("");
			setEditando(false);
			onCambio(v);
			anunciar(v.comprobacion === "valida" ? T.ajClaveGuardada : T.ajClaveGuardadaSinComprobar);
		} catch (e) {
			const msg = e instanceof Error ? e.message : T.errorGenerico;
			setError(msg);
			alertar(msg);
			campo.current?.focus();
		} finally {
			setOcupado(false);
		}
	};

	const borrar = async () => {
		setOcupado(true);
		try {
			const v = await api.borrarClave();
			setConfirmarBorrar(false);
			setEditando(!v.apiDisponible);
			onCambio(v);
			anunciar(T.ajClaveBorrada);
		} catch (e) {
			alertar(e instanceof Error ? e.message : T.errorGenerico);
		} finally {
			setOcupado(false);
		}
	};

	return (
		<div className="rv-clave" style={{ display: "grid", gap: "0.75rem" }}>
			<Aviso tono={vista.apiDisponible ? "ok" : "aviso"}>
				<p>{estado}</p>
			</Aviso>
			{editando ? (
				<div className="rv-campo">
					<label htmlFor={`${id}-clave`}>{vista.apiDisponible ? T.ajClaveCampoNueva : T.ajClaveCampo}</label>
					<input
						ref={campo}
						id={`${id}-clave`}
						type="password"
						className="rv-input"
						autoComplete="off"
						spellCheck={false}
						placeholder="sk-ant-…"
						value={valor}
						aria-invalid={error ? true : undefined}
						aria-describedby={`${id}-clave-ayuda${error ? ` ${id}-clave-err` : ""}`}
						onChange={(e) => {
							setValor(e.target.value);
							if (error) setError(null);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void guardar();
							}
						}}
					/>
					<small id={`${id}-clave-ayuda`}>{T.ajClaveAyuda}</small>
					{error ? (
						<p className="rv-error" id={`${id}-clave-err`}>
							{error}
						</p>
					) : null}
					<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
						<button type="button" className="rv-btn rv-btn--principal" disabled={ocupado} onClick={() => void guardar()}>
							{ocupado ? T.guardando : T.ajClaveGuardar}
						</button>
						{vista.apiDisponible ? (
							<button
								type="button"
								className="rv-btn rv-btn--plano"
								onClick={() => {
									setEditando(false);
									setValor("");
									setError(null);
								}}
							>
								{T.cancelar}
							</button>
						) : null}
					</div>
				</div>
			) : (
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
					<button
						type="button"
						className="rv-btn"
						onClick={() => {
							setEditando(true);
							setTimeout(() => campo.current?.focus(), 0);
						}}
					>
						{T.ajClaveCambiar}
					</button>
					{vista.claveOrigen === "panel" ? (
						confirmarBorrar ? (
							<>
								<span role="alert">{T.ajClaveBorrarConfirmar}</span>
								<button type="button" className="rv-btn rv-btn--peligro" disabled={ocupado} onClick={() => void borrar()}>
									{T.ajClaveBorrar}
								</button>
								<button type="button" className="rv-btn rv-btn--plano" onClick={() => setConfirmarBorrar(false)}>
									{T.cancelar}
								</button>
							</>
						) : (
							<button type="button" className="rv-btn rv-btn--plano rv-btn--peligro" onClick={() => setConfirmarBorrar(true)}>
								{T.ajClaveBorrar}
							</button>
						)
					) : null}
				</div>
			)}
		</div>
	);
}
