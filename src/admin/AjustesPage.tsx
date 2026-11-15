/**
 * Ajustes de revisión (solo administrador): todos los campos de `Ajustes`,
 * estado de la clave, gasto del mes y URL del MCP. Al final, las preferencias
 * personales de este dispositivo.
 */

import * as React from "react";

import type { Ajustes, AjustesVista, Esfuerzo, ModeloId, Motor } from "../lib/types.js";
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
		setGuardando(true);
		setErrGuardar(null);
		try {
			const v = await api.guardarAjustes({ ...form, avisarA: form.avisarA.trim(), adminNombre: form.adminNombre.trim() });
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
					<Aviso tono={vista.apiDisponible ? "ok" : "aviso"}>
						<p>{vista.apiDisponible ? T.ajClaveSi : T.ajClaveNo}</p>
					</Aviso>
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
