/**
 * Hoja inferior para comentar en pantallas estrechas. Es un `<dialog>` nativo:
 * Esc y «Cerrar» la cierran y el foco vuelve al botón que la abrió. El tirador
 * es un botón que amplía o reduce; no hace falta arrastrar.
 */

import * as React from "react";

import { Icono } from "./iconos.js";
import { T } from "./textos.js";

export function HojaInferior({
	abierta,
	onCerrar,
	titulo,
	children,
}: {
	abierta: boolean;
	onCerrar: () => void;
	titulo: string;
	children: React.ReactNode;
}) {
	const ref = React.useRef<HTMLDialogElement>(null);
	const origen = React.useRef<HTMLElement | null>(null);
	const [completa, setCompleta] = React.useState(false);
	const idTitulo = React.useId();

	React.useEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (abierta && !d.open) {
			origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			setCompleta(false);
			try {
				d.showModal();
			} catch {
				d.setAttribute("open", "");
			}
			// Foco en el primer campo si lo hay; si no, en el título.
			const campo = d.querySelector<HTMLElement>("textarea, input, [data-rv-foco]");
			(campo ?? d.querySelector<HTMLElement>("h2"))?.focus();
		} else if (!abierta && d.open) {
			d.close();
			const o = origen.current;
			if (o && o.isConnected) o.focus();
		}
	}, [abierta]);

	return (
		<dialog
			ref={ref}
			className={`rv-hoja${completa ? " rv-hoja--completa" : ""}`}
			aria-modal="true"
			aria-labelledby={idTitulo}
			onCancel={(e) => {
				e.preventDefault();
				onCerrar();
			}}
			onClick={(e) => {
				// Pulsar el fondo cierra la hoja.
				if (e.target === ref.current) onCerrar();
			}}
		>
			{abierta ? (
				<>
					<div className="rv-hoja__cab">
						<button
							type="button"
							className="rv-hoja__tirador"
							aria-expanded={completa}
							onClick={() => setCompleta((c) => !c)}
						>
							{completa ? "Reducir" : "Ampliar"}
						</button>
						<button type="button" className="rv-btn rv-btn--plano" onClick={onCerrar}>
							<Icono nombre="cerrar" />
							{T.cerrar}
						</button>
					</div>
					<div className="rv-hoja__cuerpo">
						<h2 id={idTitulo} tabIndex={-1} style={{ margin: 0, fontSize: "1.0625rem" }}>
							{titulo}
						</h2>
						{children}
					</div>
				</>
			) : null}
		</dialog>
	);
}
