/**
 * Parámetros de la URL, navegación dentro del admin y almacenamiento local.
 *
 * El admin de EmDash monta cada página del plugin por su ruta; la navegación
 * entre páginas del plugin es una carga normal (como en emdash-buzon).
 * Todo acceso a localStorage va en try/catch: puede fallar en ventanas
 * privadas o con el almacenamiento bloqueado, y el panel debe seguir igual.
 */

export function leerParametro(nombre: string): string | null {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get(nombre);
}

export function irA(url: string): void {
	if (typeof window === "undefined") return;
	window.location.assign(url);
}

export function recargar(): void {
	if (typeof window === "undefined") return;
	window.location.reload();
}

// ─── localStorage ────────────────────────────────────────────────────────────

const PREFIJO = "rv:";

export function leerLocal<T>(clave: string): T | null {
	try {
		const crudo = window.localStorage.getItem(PREFIJO + clave);
		return crudo === null ? null : (JSON.parse(crudo) as T);
	} catch {
		return null;
	}
}

export function guardarLocal(clave: string, valor: unknown): void {
	try {
		window.localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
	} catch {
		/* sin almacenamiento: no pasa nada */
	}
}

export function borrarLocal(clave: string): void {
	try {
		window.localStorage.removeItem(PREFIJO + clave);
	} catch {
		/* sin almacenamiento */
	}
}

// ─── Preferencias personales ────────────────────────────────────────────────

export function atajosActivos(): boolean {
	return leerLocal<boolean>("atajos") === true;
}

export function activarAtajos(si: boolean): void {
	guardarLocal("atajos", si);
}

export function bienvenidaVista(): boolean {
	return leerLocal<boolean>("bienvenida") === true;
}

export function marcarBienvenidaVista(): void {
	guardarLocal("bienvenida", true);
}

// ─── Borrador del comentario ────────────────────────────────────────────────

export interface Borrador {
	/** Unidad comentada (ver `idUnidad`). */
	unidad: string;
	inicio?: number;
	fin?: number;
	texto: string;
	propuesto: string;
	fragmento: string;
	fecha: string;
}

const claveBorrador = (collection: string, id: string) => `borrador:${collection}:${id}`;

export function leerBorrador(collection: string, id: string): Borrador | null {
	const b = leerLocal<Borrador>(claveBorrador(collection, id));
	return b && typeof b.unidad === "string" ? b : null;
}

export function guardarBorrador(collection: string, id: string, b: Borrador): void {
	guardarLocal(claveBorrador(collection, id), b);
}

export function borrarBorrador(collection: string, id: string): void {
	borrarLocal(claveBorrador(collection, id));
}

// ─── Comentarios no aplicados ya vistos («De acuerdo») ──────────────────────

export function noAplicadosVistos(collection: string, id: string): string[] {
	return leerLocal<string[]>(`vistos:${collection}:${id}`) ?? [];
}

export function marcarNoAplicadoVisto(collection: string, id: string, comentarioId: string): void {
	const actuales = noAplicadosVistos(collection, id);
	if (!actuales.includes(comentarioId)) guardarLocal(`vistos:${collection}:${id}`, [...actuales, comentarioId]);
}

// ─── Movimiento reducido ────────────────────────────────────────────────────

export function movimientoReducido(): boolean {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

export function desplazarA(el: Element | null, bloque: ScrollLogicalPosition = "center"): void {
	el?.scrollIntoView({ behavior: movimientoReducido() ? "auto" : "smooth", block: bloque });
}
