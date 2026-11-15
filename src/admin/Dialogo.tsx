/**
 * Diálogo modal con `<dialog>` nativo: trampa de foco del navegador, Esc,
 * foco inicial en la opción segura y retorno del foco al cerrar.
 */

import * as React from "react";

export interface PropsDialogo {
	abierto: boolean;
	onCerrar: () => void;
	titulo: string;
	/** alertdialog para confirmaciones (aprobar, publicar). */
	rol?: "dialog" | "alertdialog";
	/** Elemento que recibe el foco al abrir (la opción segura). */
	focoInicial?: React.RefObject<HTMLElement | null>;
	ancho?: boolean;
	children: React.ReactNode;
}

export function Dialogo({ abierto, onCerrar, titulo, rol = "dialog", focoInicial, ancho, children }: PropsDialogo) {
	const ref = React.useRef<HTMLDialogElement>(null);
	const origen = React.useRef<HTMLElement | null>(null);
	const idTitulo = React.useId();
	const idDesc = React.useId();

	React.useEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (abierto && !d.open) {
			origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			try {
				d.showModal();
			} catch {
				d.setAttribute("open", "");
			}
			const destino = focoInicial?.current;
			if (destino) destino.focus();
		} else if (!abierto && d.open) {
			d.close();
			const o = origen.current;
			if (o && o.isConnected) o.focus();
		}
	}, [abierto, focoInicial]);

	// Al desmontarse abierto, devolver el foco.
	React.useEffect(
		() => () => {
			const o = origen.current;
			if (ref.current?.open && o && o.isConnected) o.focus();
		},
		[],
	);

	return (
		<dialog
			ref={ref}
			className={`rv-dialogo${ancho ? " rv-dialogo--ancho" : ""}`}
			role={rol === "alertdialog" ? "alertdialog" : undefined}
			aria-modal="true"
			aria-labelledby={idTitulo}
			aria-describedby={idDesc}
			onCancel={(e) => {
				e.preventDefault();
				onCerrar();
			}}
		>
			{abierto ? (
				<div className="rv-dialogo__cuerpo">
					<h2 id={idTitulo}>{titulo}</h2>
					<div id={idDesc} style={{ display: "grid", gap: "1rem" }}>
						{children}
					</div>
				</div>
			) : null}
		</dialog>
	);
}
