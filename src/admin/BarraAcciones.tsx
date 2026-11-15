/**
 * Barra de acciones fija abajo: una sola acción principal y el resto en «⋯».
 * Se oculta al bajar en pantallas estrechas (nunca con el foco dentro), deja
 * de ser fija con poca altura (CSS) y ajusta `scroll-padding` para no tapar
 * el foco.
 */

import * as React from "react";

import { Icono } from "./iconos.js";
import { T } from "./textos.js";

export interface ItemBarra {
	id: string;
	texto: string;
	/** Enlace en lugar de botón. */
	href?: string;
	externo?: boolean;
	deshabilitado?: boolean;
}

export interface PropsBarra {
	principal: ItemBarra | null;
	menu: ItemBarra[];
	info?: React.ReactNode;
	ocultable: boolean;
	onAccion: (id: string, origen: HTMLElement) => void;
}

function contenedorDeScroll(el: HTMLElement | null): HTMLElement {
	for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
		const oy = getComputedStyle(n).overflowY;
		if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
	}
	return document.documentElement;
}

export const BarraAcciones = React.forwardRef<HTMLDivElement, PropsBarra>(function BarraAcciones(p, refExterna) {
	const ref = React.useRef<HTMLDivElement>(null);
	React.useImperativeHandle(refExterna, () => ref.current as HTMLDivElement);
	const [menu, setMenu] = React.useState(false);
	const [oculta, setOculta] = React.useState(false);
	const botonMenu = React.useRef<HTMLButtonElement>(null);
	const idMenu = React.useId();

	// scroll-padding dinámico según la altura real de la barra.
	React.useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const scroll = contenedorDeScroll(el);
		const previo = scroll.style.scrollPaddingBottom;
		const ro = new ResizeObserver(() => {
			const alto = el.getBoundingClientRect().height;
			scroll.style.scrollPaddingBottom = `${Math.ceil(alto + 16)}px`;
			el.closest<HTMLElement>(".rv-root")?.style.setProperty("--rv-barra-alto", `${Math.ceil(alto)}px`);
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
			scroll.style.scrollPaddingBottom = previo;
		};
	}, []);

	// Ocultar al bajar, mostrar al subir.
	React.useEffect(() => {
		if (!p.ocultable) {
			setOculta(false);
			return;
		}
		const ultimos = new WeakMap<object, number>();
		const alDesplazar = (e: Event) => {
			const t = e.target === document ? document.documentElement : (e.target as HTMLElement);
			if (!(t instanceof HTMLElement)) return;
			const y = t.scrollTop;
			const antes = ultimos.get(t) ?? y;
			ultimos.set(t, y);
			if (ref.current?.contains(document.activeElement)) return;
			if (y - antes > 8) setOculta(true);
			else if (antes - y > 8) setOculta(false);
		};
		document.addEventListener("scroll", alDesplazar, { capture: true, passive: true });
		return () => document.removeEventListener("scroll", alDesplazar, { capture: true });
	}, [p.ocultable]);

	const cerrarMenu = (devolverFoco: boolean) => {
		setMenu(false);
		if (devolverFoco) botonMenu.current?.focus();
	};

	const boton = (it: ItemBarra, principal: boolean) => {
		const clase = `rv-btn${principal ? " rv-btn--principal" : ""}`;
		if (it.href) {
			return (
				<a
					className={clase}
					href={it.href}
					target={it.externo ? "_blank" : undefined}
					rel={it.externo ? "noopener noreferrer" : undefined}
					onClick={() => setMenu(false)}
				>
					{it.texto}
					{it.externo ? <Icono nombre="externo" tam={14} /> : null}
				</a>
			);
		}
		return (
			<button
				type="button"
				className={clase}
				disabled={it.deshabilitado}
				onClick={(e) => {
					setMenu(false);
					p.onAccion(it.id, principal ? e.currentTarget : (botonMenu.current ?? e.currentTarget));
				}}
			>
				{it.texto}
				{principal ? <Icono nombre="flecha" tam={16} /> : null}
			</button>
		);
	};

	return (
		<div
			ref={ref}
			id="rv-acciones"
			className={`rv-barra${oculta ? " rv-barra--oculta" : ""}`}
			role="region"
			aria-label={T.regionAcciones}
			tabIndex={-1}
			onFocus={() => setOculta(false)}
			onKeyDown={(e) => {
				if (e.key === "Escape" && menu) {
					e.stopPropagation();
					cerrarMenu(true);
				}
			}}
		>
			<div className="rv-barra__info">{p.info}</div>
			<div className="rv-barra__botones">
				{p.menu.length ? (
					<span className="rv-mas">
						<button
							ref={botonMenu}
							type="button"
							className="rv-btn"
							aria-expanded={menu}
							aria-controls={idMenu}
							aria-label={T.masAcciones}
							title={T.masAcciones}
							onClick={() => setMenu((m) => !m)}
						>
							<Icono nombre="mas" />
						</button>
						<ul
							id={idMenu}
							className="rv-menu"
							hidden={!menu}
							onBlur={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== botonMenu.current) setMenu(false);
							}}
						>
							{p.menu.map((it) => (
								<li key={it.id}>{boton(it, false)}</li>
							))}
						</ul>
					</span>
				) : null}
				{p.principal ? boton(p.principal, true) : null}
			</div>
		</div>
	);
});
