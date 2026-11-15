/**
 * Vista de revisión de un artículo: lectura, comentarios, segunda revisión,
 * trabajo en curso, aprobar y publicar. Lee `collection` e `id` de la URL.
 */

import * as React from "react";

import { resolverAncla } from "../lib/anclas.js";
import { referenciasDe, textoDeUnidad } from "../lib/bloques.js";
import type {
	AnclaResuelta,
	ArticuloVista,
	CambioVista,
	ComentarioVista,
	DocRevisable,
	PTNode,
	TrabajoVista,
	Veredicto,
} from "../lib/types.js";
import { api, mensajeDe, urlArticulo, urlInicio } from "./api.js";
import { BarraAcciones, type ItemBarra } from "./BarraAcciones.js";
import { NoAplicados, TarjetaCambio } from "./Cambios.js";
import { Compositor, type Objetivo } from "./Compositor.js";
import { Aviso, AvisoError, ESCALAS, EtiquetaPublicacion, EtiquetaRevision, fechaLarga, Raiz, TamanoLetra, useAnchoMinimo, useAnuncio, useEscala } from "./comun.js";
import { DialogoAprobar, DialogoIA, DialogoPublicar } from "./DialogosArticulo.js";
import { DialogoHistorial } from "./Historial.js";
import { useHojaFuentes } from "./estilos.js";
import { EditorParrafo } from "./EditorParrafo.js";
import { HojaInferior } from "./HojaInferior.js";
import { Icono } from "./iconos.js";
import { type BandejaLector, claveBandeja, esImagen, esTabla, Lector, type MarcasUnidad, nombreTipo, numerar, type SeleccionLector } from "./Lector.js";
import {
	type Accion,
	accionesBarra,
	familiaFuente,
	idUnidad,
	intervaloSondeo,
	porcentajeLeido,
	type RangoMarca,
	type RefUnidad,
	refDeId,
	trabajoActivo,
} from "./logica.js";
import {
	atajosActivos,
	borrarBorrador,
	desplazarA,
	leerBorrador,
	leerParametro,
	marcarNoAplicadoVisto,
	noAplicadosVistos,
} from "./navegacion.js";
import { PanelComentarios } from "./PanelComentarios.js";
import { T } from "./textos.js";

export function ArticuloPage() {
	return (
		<Raiz>
			<Articulo />
		</Raiz>
	);
}

// ─── Unidades: orden y descripción ───────────────────────────────────────────

function describirUnidades(doc: DocRevisable): Map<string, { orden: number; desc: string }> {
	const m = new Map<string, { orden: number; desc: string }>();
	let i = 0;
	const poner = (ref: RefUnidad, desc: string) => m.set(idUnidad(ref), { orden: i++, desc });
	poner({ campo: "title" }, T.tipoTituloArticulo);
	poner({ campo: "excerpt" }, T.tipoExtracto);
	const nums = numerar(doc.content);
	for (const n of doc.content as PTNode[]) {
		const num = nums.get(n._key);
		const base = `${nombreTipo(num?.tipo ?? "otro")} ${num?.n ?? ""}`.trim();
		poner({ campo: "content", blockKey: n._key }, base);
		if (esTabla(n)) {
			n.rows.forEach((f, fi) =>
				f.cells.forEach((c, ci) => poner({ campo: "content", blockKey: n._key, ruta: `${f._key}/${c._key}` }, `${T.tipoCelda(fi + 1, ci + 1)} (${base})`)),
			);
		} else if (esImagen(n)) {
			poner({ campo: "content", blockKey: n._key, ruta: "alt" }, `${T.tipoAlt} (${base})`);
			poner({ campo: "content", blockKey: n._key, ruta: "caption" }, `${T.tipoPie} (${base})`);
		}
	}
	try {
		for (const r of referenciasDe(doc.referencias ?? "")) poner({ campo: "references", ruta: r.numero }, `${T.tipoReferencia} ${r.numero}`);
	} catch {
		/* sin referencias */
	}
	return m;
}

function selectorUnidad(id: string): string {
	return `[data-rv-unidad="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')}"]`;
}

// ─── Página ──────────────────────────────────────────────────────────────────

interface EstadoCompositor {
	clave: number;
	objetivo: Objetivo;
	inicial?: { texto: string; propuesto: string; fragmento: string };
	recuperado?: boolean;
	aviso?: string | null;
	origen: HTMLElement | null;
}

type DialogoAbierto = null | "aprobar" | "publicar" | "ia" | "historial";

function Articulo() {
	const collection = leerParametro("collection");
	const id = leerParametro("id");
	const { anunciar, alertar } = useAnuncio();

	const [vista, setVista] = React.useState<ArticuloVista | null>(null);
	const [errorCarga, setErrorCarga] = React.useState<unknown>(null);
	const [errorAccion, setErrorAccion] = React.useState<unknown>(null);
	const [ocupado, setOcupado] = React.useState(false);
	const [activo, setActivo] = React.useState<string | null>(null);
	const [filtro, setFiltro] = React.useState<string[] | null>(null);
	const [compositor, setCompositor] = React.useState<EstadoCompositor | null>(null);
	const [hoja, setHoja] = React.useState(false);
	/** Unidad cuyos comentarios se muestran debajo de su párrafo (pantalla ancha). */
	const [hilo, setHilo] = React.useState<string | null>(null);
	const [escala, setEscala] = useEscala();
	/** Párrafo que la revisora está reescribiendo ella. */
	const [editor, setEditor] = React.useState<{ clave: number; ref: RefUnidad; texto: string; origen: HTMLElement | null } | null>(null);
	/** Comentarios que la IA está corrigiendo al momento (el primero) o que esperan turno. */
	const [colaIA, setColaIA] = React.useState<string[]>([]);
	const procesandoIA = React.useRef(false);
	const vistaRef = React.useRef<ArticuloVista | null>(null);
	const compositorRef = React.useRef(false);
	// Al abrirse, la bandeja se trae a la vista sin mover el párrafo de su sitio.
	const claveVisible = editor ? `e${editor.clave}` : compositor ? `c${compositor.clave}` : hilo;
	vistaRef.current = vista;
	compositorRef.current = !!compositor || !!editor;

	// Corrección al momento: de uno en uno, en el orden en que se comentó.
	const actual = colaIA[0];
	React.useEffect(() => {
		if (!actual || procesandoIA.current) return;
		procesandoIA.current = true;
		void (async () => {
			try {
				const antes = new Set((vistaRef.current?.cambios ?? []).map((c) => c.id));
				const v = await api.corregirComentario(actual);
				setVista(v);
				anunciar(T.corregidoYa);
				const nuevo = v.cambios.find((c) => !antes.has(c.id) && c.comentarioIds.includes(actual)) ?? v.cambios.find((c) => !antes.has(c.id));
				// No se le quita el sitio si está escribiendo otra cosa.
				if (nuevo && !compositorRef.current) {
					window.setTimeout(() => {
						const h = document.getElementById(`rv-cambio-h-${nuevo.id}`);
						h?.closest(".rv-cambio")?.scrollIntoView({ block: "center", behavior: "smooth" });
					}, 150);
				}
			} catch (e) {
				alertar(T.corregirYaError(mensajeDe(e)));
			} finally {
				procesandoIA.current = false;
				setColaIA((q) => q.filter((x) => x !== actual));
			}
		})();
	}, [actual, anunciar, alertar]);
	const corregirYa = (ids: string[]) => {
		const cfg = vistaRef.current?.config;
		if (!cfg?.corregirAlComentar || !cfg.apiDisponible || ids.length === 0) return;
		setColaIA((q) => [...q, ...ids.filter((x) => !q.includes(x))]);
	};

	React.useEffect(() => {
		if (!claveVisible) return;
		const id = window.requestAnimationFrame(() => {
			document.querySelector("[data-rv-bandeja]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
		return () => window.cancelAnimationFrame(id);
	}, [claveVisible]);
	const [marcada, setMarcada] = React.useState<string | null>(null);
	const [dialogo, setDialogo] = React.useState<DialogoAbierto>(null);
	/** Botón desde el que se abrió el historial, para devolverle el foco. */
	const origenHistorial = React.useRef<HTMLElement | null>(null);
	const [aprobadoListo, setAprobadoListo] = React.useState(false);
	const [publicadoUrl, setPublicadoUrl] = React.useState<string | null | undefined>(undefined);
	const [vistosNA, setVistosNA] = React.useState<string[]>(() => (collection && id ? noAplicadosVistos(collection, id) : []));
	const [progreso, setProgreso] = React.useState(0);
	const [completada, setCompletada] = React.useState(false);

	const contRef = React.useRef<HTMLDivElement>(null);
	const papelRef = React.useRef<HTMLDivElement>(null);
	const listoRef = React.useRef<HTMLAnchorElement>(null);
	const vistos = React.useRef<Set<string>>(new Set());
	const posicion = React.useRef<string | null>(null);
	const guardarT = React.useRef<number | null>(null);
	const restaurado = React.useRef(false);
	const contadorComp = React.useRef(0);
	const ancho = useAnchoMinimo(contRef);

	useHojaFuentes(vista?.config.lectura.css);

	const clave = React.useMemo(() => (collection && id ? { collection, id } : null), [collection, id]);

	// ── Carga ────────────────────────────────────────────────────────────────
	const cargar = React.useCallback(async () => {
		if (!clave) return;
		try {
			const v = await api.articulo(clave);
			setVista(v);
			setErrorCarga(null);
			return v;
		} catch (e) {
			setErrorCarga(e);
			return null;
		}
	}, [clave]);

	React.useEffect(() => {
		void cargar().then((v) => {
			if (!v) return;
			vistos.current = new Set(v.lectura?.bloquesVistos ?? []);
			posicion.current = v.lectura?.posicion ?? null;
			const comp = !!v.lectura?.completada;
			setCompletada(comp);
			setProgreso(porcentajeLeido(vistos.current.size, v.articulo.doc.content.length, comp));
		});
	}, [cargar]);

	const doc = vista?.articulo.doc ?? null;

	// ── Anclas y marcas ──────────────────────────────────────────────────────
	const unidades = React.useMemo(() => (doc ? describirUnidades(doc) : new Map<string, { orden: number; desc: string }>()), [doc]);

	const resueltas = React.useMemo(() => {
		const m = new Map<string, AnclaResuelta>();
		if (!doc || !vista) return m;
		for (const c of vista.comentarios) {
			if (!c.ancla) continue;
			try {
				m.set(c.id, resolverAncla(doc, c.ancla));
			} catch {
				m.set(c.id, { estado: "huerfana", ancla: c.ancla });
			}
		}
		return m;
	}, [doc, vista]);

	const huerfanos = React.useMemo(() => {
		const s = new Set<string>();
		for (const c of vista?.comentarios ?? []) {
			const r = resueltas.get(c.id);
			if (c.ancla && (c.huerfano || !r || r.estado === "huerfana")) s.add(c.id);
		}
		return s;
	}, [vista, resueltas]);

	const unidadDe = React.useCallback(
		(c: ComentarioVista): string | null => {
			const r = resueltas.get(c.id);
			if (!r || huerfanos.has(c.id)) return null;
			return idUnidad(r.ancla);
		},
		[resueltas, huerfanos],
	);

	const marcas = React.useMemo(() => {
		const m = new Map<string, MarcasUnidad>();
		for (const c of vista?.comentarios ?? []) {
			if (c.parentId || c.estado !== "abierto") continue;
			const u = unidadDe(c);
			const r = resueltas.get(c.id);
			if (!u || !r) continue;
			const e = m.get(u) ?? { comentarios: [], rangos: [] as RangoMarca[], activa: false, entera: false };
			e.comentarios.push(c);
			const { inicio, fin } = r.ancla;
			const esActivo = activo === c.id;
			if (inicio !== undefined && fin !== undefined && fin > inicio) {
				e.rangos.push({ inicio, fin, clase: "frag" });
				if (esActivo) e.rangos.push({ inicio, fin, clase: "activo" });
			} else if (esActivo) e.entera = true;
			if (esActivo) e.activa = true;
			m.set(u, e);
		}
		return m;
	}, [vista, unidadDe, resueltas, activo]);

	const ordenComentarios = React.useMemo(() => {
		const m = new Map<string, number>();
		for (const c of vista?.comentarios ?? []) {
			const u = unidadDe(c);
			const r = resueltas.get(c.id);
			m.set(c.id, (u ? (unidades.get(u)?.orden ?? 1e6) : 1e6) * 1e5 + (r?.ancla.inicio ?? 0));
		}
		return m;
	}, [vista, unidadDe, resueltas, unidades]);

	const descripcion = React.useCallback(
		(c: ComentarioVista) => {
			const u = unidadDe(c);
			return u ? (unidades.get(u)?.desc ?? null) : null;
		},
		[unidadDe, unidades],
	);

	// ── Cambios (segunda revisión) ───────────────────────────────────────────
	const cambios = React.useMemo(() => [...(vista?.cambios ?? [])].sort((a, b) => a.orden - b.orden), [vista]);
	const pendientes = cambios.filter((c) => c.veredicto === "pendiente");
	const mapasCambios = React.useMemo(() => {
		const porBloque = new Map<string, CambioVista>();
		const tras = new Map<string, CambioVista[]>();
		const campo = new Map<string, CambioVista>();
		for (const c of cambios) {
			if (c.op === "campo") campo.set(c.campo, c);
			else if (c.op === "eliminar") {
				const k = c.trasKey ?? "";
				tras.set(k, [...(tras.get(k) ?? []), c]);
			} else if (c.blockKey) porBloque.set(c.blockKey, c);
		}
		return { porBloque, tras, campo };
	}, [cambios]);

	// ── Progreso de lectura ──────────────────────────────────────────────────
	const completadaRef = React.useRef(false);
	completadaRef.current = completada;
	const guardarLectura = React.useCallback(
		(keepalive = false) => {
			if (!clave) return;
			if (guardarT.current) {
				window.clearTimeout(guardarT.current);
				guardarT.current = null;
			}
			void api
				.guardarLectura(
					{ ...clave, bloquesVistos: [...vistos.current], posicion: posicion.current, completada: completadaRef.current },
					keepalive,
				)
				.catch(() => {
					/* el progreso se reintenta en el siguiente guardado */
				});
		},
		[clave],
	);

	React.useEffect(() => {
		const papel = papelRef.current;
		if (!papel || !doc || typeof IntersectionObserver === "undefined") return;
		const orden = new Map(doc.content.map((n, i) => [n._key, i] as const));
		const total = doc.content.length;
		// Un bloque cuenta como leído si ha estado a la vista al menos un segundo:
		// desplazarse deprisa hasta el final no es leer.
		const PERMANENCIA_MS = 1000;
		const pendientes = new Map<Element, number>();
		const marcarVisto = (el: Element) => {
			pendientes.delete(el);
			let fin = false;
			let cambio = false;
			if (el.hasAttribute("data-rv-fin")) fin = true;
			const k = el.getAttribute("data-rv-bloque");
			if (k && !vistos.current.has(k)) {
				vistos.current.add(k);
				cambio = true;
				const pos = posicion.current;
				if (!pos || (orden.get(k) ?? 0) > (orden.get(pos) ?? -1)) posicion.current = k;
			}
			if (!cambio && !fin) return;
			// El final solo cuenta si además se ha visto la mayor parte del artículo.
			const casiTodo = vistos.current.size >= Math.ceil(total * 0.9);
			const nuevaComp = completadaRef.current || (fin && casiTodo) || vistos.current.size >= total;
			if (nuevaComp !== completadaRef.current) setCompletada(nuevaComp);
			setProgreso(porcentajeLeido(vistos.current.size, total, nuevaComp));
			if (guardarT.current) window.clearTimeout(guardarT.current);
			guardarT.current = window.setTimeout(() => guardarLectura(), 2500);
		};
		const io = new IntersectionObserver(
			(entradas) => {
				for (const e of entradas) {
					const el = e.target;
					if (e.isIntersecting) {
						if (!pendientes.has(el)) pendientes.set(el, window.setTimeout(() => marcarVisto(el), PERMANENCIA_MS));
					} else {
						const t = pendientes.get(el);
						if (t !== undefined) window.clearTimeout(t);
						pendientes.delete(el);
					}
				}
			},
			{ threshold: 0.4 },
		);
		papel.querySelectorAll("[data-rv-bloque], [data-rv-fin]").forEach((el) => io.observe(el));
		const alOcultar = () => {
			if (document.visibilityState === "hidden" && guardarT.current) guardarLectura(true);
		};
		document.addEventListener("visibilitychange", alOcultar);
		return () => {
			io.disconnect();
			for (const t of pendientes.values()) window.clearTimeout(t);
			document.removeEventListener("visibilitychange", alOcultar);
			if (guardarT.current) guardarLectura(true);
		};
	}, [doc, cambios, guardarLectura]);

	// Volver a donde lo dejó (una vez), y recuperar un borrador pendiente.
	React.useEffect(() => {
		if (!vista || restaurado.current || !clave) return;
		restaurado.current = true;
		const b = leerBorrador(clave.collection, clave.id);
		if (b) {
			const ref = b.unidad === "general" ? null : refDeId(b.unidad);
			if (b.unidad === "general" || ref) {
				let cita: string | undefined;
				if (ref && b.inicio !== undefined && b.fin !== undefined) {
					try {
						cita = textoDeUnidad(vista.articulo.doc, ref)?.slice(b.inicio, b.fin) ?? undefined;
					} catch {
						cita = undefined;
					}
				}
				abrirCompositor(
					{ ref, inicio: cita ? b.inicio : undefined, fin: cita ? b.fin : undefined, cita, descripcion: ref ? (unidades.get(b.unidad)?.desc ?? "") : "" },
					null,
					{ inicial: { texto: b.texto, propuesto: b.propuesto, fragmento: b.fragmento }, recuperado: true },
				);
				return;
			}
		}
		const pos = vista.lectura?.posicion;
		if (pos && !vista.lectura?.completada && vista.revision.estado !== "cambios_por_ver") {
			window.requestAnimationFrame(() => {
				const el = papelRef.current?.querySelector(`[data-rv-bloque="${CSS.escape(pos)}"]`);
				if (el) {
					desplazarA(el, "start");
					anunciar(T.irPosicion);
				}
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vista]);

	// ── Sondeo del trabajo en curso ──────────────────────────────────────────
	const trabajo = vista?.trabajo ?? null;
	const enCurso = trabajoActivo(trabajo);
	React.useEffect(() => {
		if (!clave || !trabajo || !enCurso) return;
		let vivo = true;
		let t: number | null = null;
		const inicio = Date.parse(trabajo.creado) || Date.now();
		const sondear = async () => {
			if (!vivo) return;
			if (document.visibilityState !== "hidden") {
				try {
					const res = await api.estadoTrabajo(clave);
					if (!vivo) return;
					const nuevo = res.trabajo;
					if (!nuevo || nuevo.estado !== trabajo.estado || nuevo.id !== trabajo.id) {
						if (nuevo?.estado === "hecho" || !nuevo) {
							const v = await cargar();
							if (v) anunciar(T.correccionLista(v.cambios.length));
						} else {
							setVista((prev) => (prev ? { ...prev, trabajo: nuevo, revision: res.revision } : prev));
							if (nuevo.estado === "conflicto") alertar(T.franjaConflicto);
							else if (nuevo.estado === "error") alertar(T.franjaError);
							else anunciar(T.trabajoEtiqueta(nuevo.estado));
						}
						return;
					}
				} catch {
					/* se reintenta */
				}
			}
			t = window.setTimeout(() => void sondear(), intervaloSondeo(Date.now() - inicio));
		};
		t = window.setTimeout(() => void sondear(), intervaloSondeo(Date.now() - inicio));
		return () => {
			vivo = false;
			if (t) window.clearTimeout(t);
		};
	}, [clave, trabajo, enCurso, cargar, anunciar, alertar]);

	// ── Acciones comunes ─────────────────────────────────────────────────────
	const ejecutar = async <R,>(fn: () => Promise<R>): Promise<R | null> => {
		setOcupado(true);
		setErrorAccion(null);
		try {
			return await fn();
		} catch (e) {
			setErrorAccion(e);
			alertar(mensajeDe(e));
			return null;
		} finally {
			setOcupado(false);
		}
	};

	const actualizarComentario = (c: ComentarioVista) =>
		setVista((v) =>
			v
				? {
						...v,
						comentarios: v.comentarios.some((x) => x.id === c.id) ? v.comentarios.map((x) => (x.id === c.id ? c : x)) : [...v.comentarios, c],
						noAplicados: v.noAplicados.map((x) => (x.id === c.id ? c : x)),
					}
				: v,
		);

	function abrirCompositor(objetivo: Objetivo, origen: HTMLElement | null, extra: Partial<EstadoCompositor> = {}) {
		contadorComp.current += 1;
		setMarcada(null);
		setCompositor({ clave: contadorComp.current, objetivo, origen, ...extra });
		setEditor(null);
		setHilo(null);
		// En pantalla ancha el formulario se abre debajo del párrafo; en estrecha, en la hoja.
		setHoja(!ancho);
	}

	const cerrarCompositor = React.useCallback(() => {
		const origen = compositor?.origen;
		setCompositor(null);
		if (!ancho) setHoja(false);
		else if (origen && origen.isConnected) origen.focus();
	}, [compositor, ancho]);

	const onComentar = React.useCallback(
		(ref: RefUnidad, origen: HTMLElement) => {
			const u = idUnidad(ref);
			abrirCompositor({ ref, descripcion: unidades.get(u)?.desc ?? "" }, origen);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[unidades, ancho],
	);

	const onEditar = React.useCallback(
		(ref: RefUnidad, origen: HTMLElement) => {
			const doc = vistaRef.current?.articulo.doc;
			if (!doc) return;
			contadorComp.current += 1;
			setCompositor(null);
			setHilo(null);
			setMarcada(null);
			setEditor({ clave: contadorComp.current, ref, texto: textoDeUnidad(doc, ref) ?? "", origen });
		},
		[],
	);
	const cerrarEditor = () => {
		const o = editor?.origen;
		setEditor(null);
		if (o && o.isConnected) o.focus();
	};

	const onComentarSeleccion = React.useCallback(
		(s: SeleccionLector, origen: HTMLElement) => {
			const u = idUnidad(s.ref);
			abrirCompositor({ ref: s.ref, inicio: s.inicio, fin: s.fin, cita: s.cita, descripcion: unidades.get(u)?.desc ?? "" }, origen, {
				aviso: s.recortada ? T.seleccionRecortada : null,
			});
			window.getSelection()?.removeAllRanges();
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[unidades, ancho],
	);

	const onVerComentarios = React.useCallback(
		(unidad: string, _origen: HTMLElement) => {
			const cs = marcas.get(unidad)?.comentarios ?? [];
			const primero = cs[0];
			if (!primero) return;
			if (ancho && hilo === unidad && !compositor) {
				setActivo(null);
				setFiltro(null);
				setHilo(null);
				return;
			}
			setActivo(primero.id);
			setFiltro(cs.map((c) => c.id));
			anunciar(T.contador(cs.length, unidades.get(unidad)?.desc ?? ""));
			if (ancho) {
				setCompositor(null);
				setHilo(unidad);
			} else setHoja(true);
		},
		[marcas, ancho, anunciar, unidades, hilo, compositor],
	);

	const irAComentario = (c: ComentarioVista) => {
		setActivo(c.id);
		const u = unidadDe(c);
		setHoja(false);
		if (!u) return;
		if (ancho) {
			setCompositor(null);
			setFiltro((marcas.get(u)?.comentarios ?? [c]).map((x) => x.id));
			setHilo(u);
		}
		window.requestAnimationFrame(() => desplazarA(papelRef.current?.querySelector(selectorUnidad(u)) ?? null));
	};

	const onVeredicto = async (c: CambioVista, veredicto: Veredicto, nota?: string, confirmado?: boolean): Promise<boolean> => {
		const res = await ejecutar(() => api.veredicto({ id: c.id, veredicto, nota, confirmado }));
		if (!res) return false;
		let siguientePendiente: CambioVista | undefined;
		setVista((v) => {
			if (!v) return v;
			const lista = v.cambios.map((x) => (x.id === res.cambio.id ? res.cambio : x));
			const ord = [...lista].sort((a, b) => a.orden - b.orden);
			const i = ord.findIndex((x) => x.id === c.id);
			siguientePendiente = [...ord.slice(i + 1), ...ord.slice(0, i)].find((x) => x.veredicto === "pendiente");
			return {
				...v,
				cambios: lista,
				revision: res.revision,
				articulo: res.doc ? { ...v.articulo, doc: res.doc } : v.articulo,
			};
		});
		if (veredicto !== "bien" && !res.doc) void cargar();
		// «No es esto» con explicación: la IA lo reintenta al momento.
		if (veredicto === "no_es_esto") corregirYa(c.comentarioIds);
		window.requestAnimationFrame(() => {
			if (veredicto === "bien" && siguientePendiente) {
				irACambio(siguientePendiente);
			} else {
				anunciar(T.veredictoActual(T.veredictoNombre[veredicto]));
			}
		});
		return true;
	};

	const irACambio = (c: CambioVista) => {
		const i = cambios.findIndex((x) => x.id === c.id);
		const h = document.getElementById(`rv-cambio-h-${c.id}`);
		if (h) {
			desplazarA(h.closest(".rv-cambio"), "center");
			h.focus({ preventScroll: true });
		}
		anunciar(T.cambioN(i + 1, cambios.length));
	};

	const renderCambio = React.useCallback(
		(c: CambioVista) => (
			<TarjetaCambio
				key={c.id}
				cambio={c}
				indice={cambios.findIndex((x) => x.id === c.id) + 1}
				total={cambios.length}
				comentarios={[...(vista?.comentarios ?? []), ...(vista?.noAplicados ?? [])]}
				ocupado={ocupado}
				onVeredicto={onVeredicto}
				onEditar={async (cc, texto) => {
					const res = await ejecutar(() => api.editarCambio({ id: cc.id, texto }));
					if (!res) return false;
					setVista((v) =>
						v
							? {
									...v,
									cambios: v.cambios.map((x) => (x.id === res.cambio.id ? res.cambio : x)),
									revision: res.revision,
									articulo: { ...v.articulo, doc: res.doc },
								}
							: v,
					);
					anunciar(T.cambioEditado);
					return true;
				}}
				onComentar={(cc, origen) => {
					if (cc.op === "campo") onComentar({ campo: cc.campo }, origen);
					else if (cc.blockKey) onComentar({ campo: "content", blockKey: cc.blockKey }, origen);
				}}
			/>
		),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[cambios, vista, ocupado, onComentar],
	);

	// ── Atajos (desactivados por defecto) ────────────────────────────────────
	const atajos = React.useMemo(() => atajosActivos(), []);
	const onTecla = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (!atajos || e.altKey || e.ctrlKey || e.metaKey) return;
		const t = e.target as HTMLElement;
		if (t.closest("input, textarea, select, [contenteditable]")) return;
		const k = e.key.toLowerCase();
		if (k === "c") {
			const u = t.closest("[data-rv-unidad]");
			const ref = u ? refDeId(u.getAttribute("data-rv-unidad") ?? "") : null;
			if (ref) {
				e.preventDefault();
				onComentar(ref, u?.querySelector<HTMLElement>(".rv-comentar") ?? t);
			}
		} else if (k === "n" && pendientes[0]) {
			e.preventDefault();
			irACambio(pendientes[0]);
		} else if (k === "b") {
			const tarjeta = t.closest("[data-rv-cambio]");
			const c = cambios.find((x) => x.id === tarjeta?.getAttribute("data-rv-cambio"));
			// Nunca con cambios sensibles o no pedidos.
			if (c && c.veredicto === "pendiente" && c.avisos.length === 0) {
				e.preventDefault();
				void onVeredicto(c, "bien");
			}
		}
	};

	// ── Render ───────────────────────────────────────────────────────────────
	if (!clave) {
		return (
			<div className="rv-pagina">
				<Aviso tono="error">
					<p>{T.errorCarga}</p>
					<p>
						<a href={urlInicio()}>{T.volverAlInicio}</a>
					</p>
				</Aviso>
			</div>
		);
	}
	if (errorCarga && !vista) {
		return (
			<div className="rv-pagina">
				<AvisoError error={errorCarga} onReintentar={() => void cargar()} />
				<p>
					<a href={urlInicio()}>{T.volverAlInicio}</a>
				</p>
			</div>
		);
	}
	if (!vista || !doc) {
		return (
			<div className="rv-pagina" aria-busy="true">
				<p>{T.cargando}</p>
			</div>
		);
	}

	const { articulo, revision, usuario, config } = vista;
	const enSegunda = revision.estado === "cambios_por_ver" && cambios.length > 0;
	const abiertos = vista.comentarios.filter((c) => !c.parentId && c.estado === "abierto").length;
	const noEsEsto = cambios.filter((c) => c.veredicto === "no_es_esto").length;
	const { principal, menu } = accionesBarra({
		estado: revision.estado,
		abiertos: Math.max(revision.abiertos, abiertos),
		completada,
		cambiosPendientes: pendientes.length,
		hayNoEsEsto: noEsEsto > 0,
		trabajoActivo: enCurso,
		puedeAprobar: usuario.puedeAprobar,
		esAdmin: usuario.esAdmin,
		haySiguiente: !!vista.siguiente,
	});

	const item = (a: Accion): ItemBarra => {
		const n = Math.max(revision.abiertos, abiertos);
		switch (a) {
			case "seguir_leyendo":
				return { id: a, texto: T.seguirLeyendo(progreso) };
			case "aprobar":
				return { id: a, texto: T.aprobar };
			case "aprobar_igualmente":
				return { id: a, texto: T.aprobarIgualmente };
			case "he_terminado":
				return { id: a, texto: T.heTerminado(n) };
			case "enviar_otra_vez":
				return { id: a, texto: T.enviarOtraVez(n + noEsEsto) };
			case "cambio_siguiente":
				return { id: a, texto: T.cambioSiguiente };
			case "siguiente":
				return vista.siguiente
					? { id: a, texto: T.siguiente(vista.siguiente.titulo), href: urlArticulo(vista.siguiente) }
					: { id: a, texto: T.volverAlInicio, href: urlInicio() };
			case "inicio":
				return { id: a, texto: T.volverAlInicio, href: urlInicio() };
			case "dejar_luego":
				return { id: a, texto: T.dejarloLuego, href: urlInicio() };
			case "publicar":
				return { id: a, texto: T.publicarAhora };
			case "retirar":
				return { id: a, texto: T.retirarAprobacion };
			case "abrir_editor":
				return { id: a, texto: T.abrirEditor, href: articulo.urlEditor };
			case "corregir_ia":
				return { id: a, texto: T.corregirConIA };
			case "claude_code":
				return { id: a, texto: T.enviarClaudeCode, deshabilitado: n === 0 };
		}
	};

	const itemsMenu: ItemBarra[] = [
		{ id: "ver_comentarios", texto: T.verComentarios(abiertos) },
		...menu.map(item),
		{ id: "historial", texto: T.historial },
	];

	const onAccion = async (accionId: string, origen: HTMLElement) => {
		switch (accionId as Accion | "ver_comentarios" | "historial") {
			case "ver_comentarios":
				setFiltro(null);
				setHilo(null);
				setCompositor(null);
				setHoja(true);
				return;
			case "historial":
				origenHistorial.current = origen;
				setDialogo("historial");
				return;
			case "seguir_leyendo": {
				const sig = doc.content.find((n) => !vistos.current.has(n._key));
				const el = sig ? papelRef.current?.querySelector(`[data-rv-bloque="${CSS.escape(sig._key)}"]`) : papelRef.current?.querySelector("[data-rv-fin]");
				desplazarA(el ?? null, "start");
				el?.querySelector<HTMLElement>(":scope > .rv-margen > .rv-comentar")?.focus({ preventScroll: true });
				return;
			}
			case "aprobar":
			case "aprobar_igualmente":
				setDialogo("aprobar");
				return;
			case "publicar":
				setDialogo("publicar");
				return;
			case "corregir_ia":
				setDialogo("ia");
				return;
			case "he_terminado":
			case "enviar_otra_vez": {
				const res = await ejecutar(() => api.terminar(clave));
				if (res) {
					setVista((v) => (v ? { ...v, trabajo: res.trabajo } : v));
					anunciar(T.enviadoACorregir);
				}
				return;
			}
			case "claude_code": {
				const res = await ejecutar(() => api.crearTrabajo({ ...clave, motor: "local" }));
				if (res) {
					setVista((v) => (v ? { ...v, trabajo: res.trabajo } : v));
					anunciar(T.enviadoACorregir);
				}
				return;
			}
			case "cambio_siguiente": {
				const sig = pendientes[0];
				if (sig) irACambio(sig);
				return;
			}
			case "retirar": {
				const res = await ejecutar(() => api.retirar(clave));
				if (res) {
					setVista((v) => (v ? { ...v, revision: res.revision } : v));
					setAprobadoListo(false);
					anunciar(T.aprobacionRetirada);
					origen.focus();
				}
				return;
			}
			default:
				return;
		}
	};

	const reintentarTrabajo = async () => {
		const res = await ejecutar(() =>
			usuario.esAdmin && trabajo ? api.crearTrabajo({ ...clave, motor: trabajo.motor }) : api.terminar(clave),
		);
		if (res) {
			setVista((v) => (v ? { ...v, trabajo: res.trabajo } : v));
			anunciar(T.enviadoACorregir);
		}
	};

	const estiloPapel = {
		"--rv-fuente-cuerpo": familiaFuente(config.lectura.cuerpo, "system-ui, sans-serif") ?? undefined,
		"--rv-fuente-titulos": familiaFuente(config.lectura.titulos, "var(--rv-fuente-cuerpo)") ?? undefined,
	} as React.CSSProperties;

	const formulario = compositor ? (
					<Compositor
						key={compositor.clave}
						nivel={3}
						collection={clave.collection}
						id={clave.id}
						doc={doc}
						draftRevisionId={articulo.draftRevisionId}
						objetivo={compositor.objetivo}
						inicial={compositor.inicial}
						recuperado={compositor.recuperado}
						aviso={compositor.aviso}
						onCancelar={cerrarCompositor}
						onGuardado={(c, r, yaAplicado) => {
							actualizarComentario(c);
							setVista((v) => (v ? { ...v, revision: r } : v));
							setActivo(c.id);
							anunciar(T.comentarioGuardado);
							cerrarCompositor();
							if (!yaAplicado && c.tipo !== "pregunta") corregirYa([c.parentId ?? c.id]);
						}}
						onAplicado={(v) => {
							setVista(v);
							borrarBorrador(clave.collection, clave.id);
							anunciar(T.cambioAplicado);
						}}
					/>
	) : null;

	const panel = (nivel: 2 | 3, incluirCompositor: boolean, compacto = false) => (
		<PanelComentarios
			nivel={nivel}
			compacto={compacto}
			comentarios={vista.comentarios}
			activo={activo}
			orden={ordenComentarios}
			descripcion={descripcion}
			huerfanos={huerfanos}
			filtro={compositor && incluirCompositor ? null : filtro}
			onQuitarFiltro={() => setFiltro(null)}
			onComentarGeneral={(origen) => abrirCompositor({ ref: null, descripcion: "" }, origen)}
			ocupado={ocupado}
			onActivar={irAComentario}
			onEstado={async (c, estado) => {
				const res = await ejecutar(() => api.estadoComentario({ id: c.id, estado }));
				if (res) {
					actualizarComentario(res.comentario);
					setVista((v) => (v ? { ...v, revision: res.revision } : v));
					anunciar(estado === "abierto" ? T.comentarioReabierto : T.comentarioResuelto);
				}
			}}
			onBorrar={async (c) => {
				const res = await ejecutar(() => api.borrarComentario(c.id));
				if (res) {
					setVista((v) => (v ? { ...v, revision: res.revision, comentarios: v.comentarios.filter((x) => x.id !== c.id) } : v));
					if (activo === c.id) setActivo(null);
					anunciar(T.comentarioBorrado);
				}
			}}
			onEditar={async (c, texto, propuesto) => {
				const res = await ejecutar(() => api.editarComentario({ id: c.id, texto, textoPropuesto: propuesto || null }));
				if (res) {
					actualizarComentario(res.comentario);
					anunciar(T.comentarioGuardado);
				}
			}}
			onAplicar={async (c) => {
				const res = await ejecutar(() => api.aplicarComentario(c.id));
				if (res) {
					setVista(res);
					anunciar(T.cambioAplicado);
				}
			}}
			compositor={incluirCompositor ? formulario : null}
		/>
	);

	const cerrarHilo = () => {
		setHilo(null);
		setFiltro(null);
		setActivo(null);
	};
	const refBandeja = compositor?.objetivo.ref ?? null;
	const anclaHilo = hilo ? resueltas.get(marcas.get(hilo)?.comentarios[0]?.id ?? "")?.ancla : undefined;
	const bandeja: BandejaLector | null = !ancho
		? null
		: editor
			? {
					clave: claveBandeja(editor.ref),
					nodo: (
						<EditorParrafo
							key={editor.clave}
							descripcion={unidades.get(idUnidad(editor.ref))?.desc ?? ""}
							inicial={editor.texto}
							ocupado={ocupado}
							onCancelar={cerrarEditor}
							onGuardar={async (texto) => {
								const res = await ejecutar(() =>
									api.editarBloque({
										...clave,
										campo: editor.ref.campo as "content" | "title" | "excerpt",
										blockKey: editor.ref.blockKey,
										texto,
									}),
								);
								if (!res) return false;
								setVista(res);
								setEditor(null);
								anunciar(T.cambioEditado);
								return true;
							}}
						/>
					),
				}
			: compositor && refBandeja
			? { clave: claveBandeja(refBandeja), nodo: formulario }
			: hilo && anclaHilo && !compositor
				? {
						clave: claveBandeja(anclaHilo),
						nodo: (
							<>
								<div className="rv-cabecera">
									<h3 style={{ margin: 0 }}>{T.comentariosDe(unidades.get(hilo)?.desc ?? "")}</h3>
									<button type="button" className="rv-btn rv-btn--plano rv-btn--peque" onClick={cerrarHilo}>
										<Icono nombre="cerrar" tam={16} />
										{T.cerrar}
									</button>
								</div>
								{panel(3, false, true)}
							</>
						),
					}
				: null;

	const franja = (() => {
		if (!trabajo) return null;
		if (enCurso) {
			const texto =
				trabajo.motor === "api" ? T.franjaApi : trabajo.estado === "en_curso" ? T.franjaEnCurso : T.franjaLocal(config.adminNombre);
			return (
				<Aviso tono="info" icono="reloj">
					<p>{texto}</p>
					<p className="rv-ayuda">{T.comentarParaSiguiente}</p>
				</Aviso>
			);
		}
		if (trabajo.estado === "conflicto") {
			return (
				<Aviso tono="aviso">
					<p>{T.franjaConflicto}</p>
					<div className="rv-acciones">
						{usuario.esAdmin ? (
							<button
								type="button"
								className="rv-btn"
								disabled={ocupado}
								onClick={async () => {
									const res = await ejecutar(() => api.aplicarPendiente(trabajo.id));
									if (res) {
										const v = await cargar();
										if (v) anunciar(T.correccionLista(v.cambios.length));
									}
								}}
							>
								{T.aplicarGuardada}
							</button>
						) : null}
						<button type="button" className="rv-btn" disabled={ocupado} onClick={() => void reintentarTrabajo()}>
							{T.corregirDeNuevo}
						</button>
					</div>
				</Aviso>
			);
		}
		if (trabajo.estado === "error") {
			return (
				<Aviso tono="error">
					<p>{T.franjaError}</p>
					{usuario.esAdmin && trabajo.error ? <p className="rv-ayuda">{trabajo.error}</p> : null}
					<div className="rv-acciones">
						<button type="button" className="rv-btn" disabled={ocupado} onClick={() => void reintentarTrabajo()}>
							{T.reintentar}
						</button>
					</div>
				</Aviso>
			);
		}
		return null;
	})();

	const saltar = (e: React.MouseEvent<HTMLAnchorElement>, destino: string) => {
		e.preventDefault();
		if (destino === "rv-comentarios") {
			setFiltro(null);
			setHilo(null);
			setCompositor(null);
			setHoja(true);
			return;
		}
		const el = document.getElementById(destino);
		el?.focus();
		desplazarA(el, "start");
	};

	const revisados = cambios.length - pendientes.length;
	const infoBarra = enSegunda ? T.progresoCambios(revisados, cambios.length) : `${T.leido(progreso)} · ${T.minutos(articulo.minutosLectura)}`;

	return (
		<>
			<nav className="rv-saltos" aria-label="Saltos">
				<a href="#rv-lectura" onClick={(e) => saltar(e, "rv-lectura")}>
					{T.saltoArticulo}
				</a>
				<a href="#rv-comentarios" onClick={(e) => saltar(e, "rv-comentarios")}>
					{T.saltoComentarios}
				</a>
				<a href="#rv-acciones" onClick={(e) => saltar(e, "rv-acciones")}>
					{T.saltoAcciones}
				</a>
			</nav>
			<div className="rv-articulo" ref={contRef} style={{ "--rv-escala": String(ESCALAS[escala]) } as React.CSSProperties}>
				<div className="rv-cabecera" style={{ marginBottom: "1rem" }}>
					<a href={urlInicio()} className="rv-btn rv-btn--plano">
						{T.volverAlInicio}
					</a>
					<div className="rv-acciones">
						<EtiquetaRevision estado={revision.estado} aprobacion={revision.aprobacion} trabajo={trabajo} />
						<EtiquetaPublicacion publicacion={articulo.publicacion} />
						{revision.vuelta > 0 ? <span className="rv-etiqueta">{T.vuelta(revision.vuelta)}</span> : null}
						<button
							type="button"
							className="rv-btn rv-btn--peque"
							onClick={() => {
								setFiltro(null);
								setHilo(null);
								setCompositor(null);
								setHoja(true);
							}}
						>
							<Icono nombre="comentario" tam={16} />
							{T.verComentarios(abiertos)}
						</button>
						<TamanoLetra escala={escala} onCambio={setEscala} />
					</div>
				</div>

				{franja ? <div className="rv-franja">{franja}</div> : null}
				{colaIA.length ? (
					<div className="rv-franja">
						<Aviso tono="info">
							<p className="rv-franja--ia">
								<span className="rv-giro" aria-hidden="true" />
								{T.corrigiendoYa(colaIA.length)}
							</p>
						</Aviso>
					</div>
				) : null}

				{aprobadoListo ? (
					<div style={{ marginBottom: "1rem" }}>
						<Aviso tono="ok">
							<p>
								<strong>{T.aprobadoListo(vista.pendientesTotal)}</strong>
							</p>
							{vista.siguiente ? (
								<p>
									<a ref={listoRef} className="rv-btn rv-btn--principal" href={urlArticulo(vista.siguiente)}>
										{T.siguiente(vista.siguiente.titulo)}
									</a>
								</p>
							) : null}
						</Aviso>
					</div>
				) : null}

				{publicadoUrl !== undefined ? (
					<div style={{ marginBottom: "1rem" }}>
						<Aviso tono="ok" icono="publicado">
							<p>{T.publicado}</p>
							{publicadoUrl && /^(https?:\/\/|\/(?!\/))/i.test(publicadoUrl) ? (
								<p>
									<a href={publicadoUrl} target="_blank" rel="noopener noreferrer">
										{T.verEnLaWeb}
									</a>
								</p>
							) : null}
						</Aviso>
					</div>
				) : null}

				{errorAccion ? (
					<div style={{ marginBottom: "1rem" }}>
						<AvisoError error={errorAccion} />
					</div>
				) : null}

				<div className="rv-composicion">
					<section id="rv-lectura" aria-label={T.regionArticulo} tabIndex={-1} style={{ minWidth: 0 }}>
						{enSegunda ? (
							<NoAplicados
								comentarios={vista.noAplicados}
								vistos={vistosNA}
								ocupado={ocupado}
								onDeAcuerdo={(c) => {
									marcarNoAplicadoVisto(clave.collection, clave.id, c.id);
									setVistosNA((v) => [...v, c.id]);
								}}
								onInsistir={async (c) => {
									const res = await ejecutar(() => api.estadoComentario({ id: c.id, estado: "abierto" }));
									if (res) {
										actualizarComentario(res.comentario);
										setVista((v) => (v ? { ...v, revision: res.revision } : v));
										anunciar(T.insistido);
									}
								}}
							/>
						) : null}
						{ancho && compositor && !refBandeja ? (
							<div className="rv-bandeja rv-bandeja--general" data-rv-bandeja="">
								{formulario}
							</div>
						) : null}
						<Lector
							papelRef={papelRef}
							bandeja={bandeja}
							doc={doc}
							portada={articulo.portada}
							marcas={marcas}
							marcada={marcada}
							onMarcar={setMarcada}
							onComentar={onComentar}
							onEditar={ancho ? onEditar : undefined}
							onComentarSeleccion={onComentarSeleccion}
							onVerComentarios={onVerComentarios}
							cambiosPorBloque={enSegunda ? mapasCambios.porBloque : VACIO_CAMBIOS}
							eliminadosTras={enSegunda ? mapasCambios.tras : VACIO_TRAS}
							cambiosCampo={enSegunda ? mapasCambios.campo : VACIO_CAMBIOS}
							renderCambio={renderCambio}
							onTecla={onTecla}
							estilo={estiloPapel}
							className={enSegunda && vista.leyoVersionAnterior ? "rv-atenuar" : undefined}
							antes={
								enSegunda ? (
									<p className="rv-nota-cambios">
										<Icono nombre="info" tam={16} />{" "}
										{vista.leyoVersionAnterior ? T.atenuadoNota(fechaLarga(vista.lectura?.fecha)) : T.releerNota}
									</p>
								) : null
							}
						/>
					</section>
				</div>

				<BarraAcciones
					principal={item(principal)}
					menu={itemsMenu}
					info={infoBarra}
					ocultable={!ancho}
					onAccion={(a, o) => void onAccion(a, o)}
				/>

				{
					<HojaInferior
						abierta={hoja}
						onCerrar={() => {
							setHoja(false);
							setCompositor(null);
							setFiltro(null);
						}}
						titulo={compositor && !ancho ? (compositor.objetivo.ref ? T.formTitulo : T.comentarioGeneral) : T.comentariosTitulo}
					>
						{panel(3, !ancho)}
					</HojaInferior>
				}

				<DialogoAprobar
					abierto={dialogo === "aprobar"}
					onCerrar={() => setDialogo(null)}
					vista={vista}
					leido={progreso}
					pendientes={pendientes.length}
					onAprobado={(r) => {
						setDialogo(null);
						setVista((v) => (v ? { ...v, revision: r } : v));
						setAprobadoListo(true);
						void cargar().then((v) => {
							anunciar(T.aprobadoListo(v?.pendientesTotal ?? 0));
							window.requestAnimationFrame(() => listoRef.current?.focus());
						});
					}}
				/>
				<DialogoPublicar
					abierto={dialogo === "publicar"}
					onCerrar={() => setDialogo(null)}
					vista={vista}
					onPublicado={(url) => {
						setDialogo(null);
						setPublicadoUrl(url);
						anunciar(T.publicado);
						void cargar();
					}}
				/>
				<DialogoHistorial
					abierto={dialogo === "historial"}
					onCerrar={() => {
						setDialogo(null);
						window.requestAnimationFrame(() => origenHistorial.current?.focus());
					}}
					vista={vista}
					onRestaurado={(v, publicado) => {
						setDialogo(null);
						setVista(v);
						if (publicado) setPublicadoUrl(v.articulo.urlPublica);
						anunciar(publicado ? T.restauradaYPublicada : T.restaurada);
						window.requestAnimationFrame(() => origenHistorial.current?.focus());
					}}
				/>
				{usuario.esAdmin ? (
					<DialogoIA
						abierto={dialogo === "ia"}
						onCerrar={() => setDialogo(null)}
						vista={vista}
						onCreado={(t: TrabajoVista) => {
							setDialogo(null);
							setVista((v) => (v ? { ...v, trabajo: t } : v));
							anunciar(T.enviadoACorregir);
						}}
					/>
				) : null}
			</div>
		</>
	);
}

const VACIO_CAMBIOS = new Map<string, CambioVista>();
const VACIO_TRAS = new Map<string, CambioVista[]>();
