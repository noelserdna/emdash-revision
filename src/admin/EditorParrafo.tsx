/**
 * La revisora reescribe ella un párrafo, el título o el extracto. Solo texto:
 * el servidor conserva las negritas y los enlaces de lo que no toca.
 */

import * as React from "react";

import { T } from "./textos.js";

export function EditorParrafo({
	descripcion,
	inicial,
	ocupado,
	onGuardar,
	onCancelar,
}: {
	descripcion: string;
	inicial: string;
	ocupado: boolean;
	onGuardar: (texto: string) => Promise<boolean>;
	onCancelar: () => void;
}) {
	const [texto, setTexto] = React.useState(inicial);
	const [vacio, setVacio] = React.useState(false);
	const ref = React.useRef<HTMLTextAreaElement>(null);
	const id = React.useId();
	React.useEffect(() => {
		const t = ref.current;
		if (!t) return;
		t.focus();
		t.setSelectionRange(t.value.length, t.value.length);
	}, []);
	return (
		<form
			style={{ display: "grid", gap: "0.5rem" }}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				if (!texto.trim()) {
					setVacio(true);
					return;
				}
				void onGuardar(texto);
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onCancelar();
			}}
		>
			<h3 style={{ margin: 0 }}>{T.editarTitulo}</h3>
			{descripcion ? (
				<p className="rv-ayuda" style={{ margin: 0 }}>
					{T.editarSobre} {descripcion}
				</p>
			) : null}
			<label htmlFor={id} className="rv-sr">
				{T.editarCambioEtq}
			</label>
			<textarea
				id={id}
				ref={ref}
				className="rv-input rv-input--redaccion"
				value={texto}
				aria-invalid={vacio ? true : undefined}
				aria-describedby={`${id}-ayuda`}
				onChange={(e) => {
					setTexto(e.target.value);
					if (e.target.value.trim()) setVacio(false);
				}}
			/>
			{vacio ? <p className="rv-error">{T.editarCambioVacio}</p> : null}
			<p className="rv-ayuda" id={`${id}-ayuda`} style={{ margin: 0 }}>
				{T.editarCambioAyuda}
			</p>
			<div className="rv-acciones">
				<button type="submit" className="rv-btn rv-btn--principal" disabled={ocupado || texto.trim() === inicial.trim()}>
					{T.editarCambioGuardar}
				</button>
				<button type="button" className="rv-btn rv-btn--plano" onClick={onCancelar}>
					{T.cancelar}
				</button>
			</div>
		</form>
	);
}
