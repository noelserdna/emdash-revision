/**
 * Iconos SVG en línea. Siempre decorativos: el texto acompaña al icono.
 */

import type { Icono as IconoEtiqueta } from "./logica.js";

export type NombreIcono =
	| IconoEtiqueta
	| "mas"
	| "cerrar"
	| "externo"
	| "publicado"
	| "libro"
	| "ajustes"
	| "flecha"
	| "deshacer"
	| "info";

const TRAZOS: Record<NombreIcono, string> = {
	circulo: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z",
	comentario: "M4 5h16v11H9l-5 4z",
	cambios: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
	check: "M4 12.5l5 5L20 6.5",
	alerta: "M12 3L2 20h20zM12 10v4M12 17v.5",
	reloj: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
	mas: "M5 12h.01M12 12h.01M19 12h.01",
	cerrar: "M6 6l12 12M18 6L6 18",
	externo: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
	publicado: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
	libro: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5",
	ajustes: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
	flecha: "M5 12h14M13 6l6 6-6 6",
	deshacer: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
	info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5",
};

export function Icono({ nombre, tam = 18 }: { nombre: NombreIcono; tam?: number }) {
	return (
		<svg
			width={tam}
			height={tam}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={nombre === "mas" ? 3 : 2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d={TRAZOS[nombre]} />
		</svg>
	);
}
