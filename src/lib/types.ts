/**
 * Tipos compartidos por las librerías, el servidor (plugin.ts) y el panel (admin).
 * Este fichero es el CONTRATO: no cambiar nombres ni formas sin actualizar CONTRATO.md.
 */

// ─── Portable Text (formas que produce el sitio; ver CONTRATO.md §1) ─────────

export interface PTSpan {
	_type: "span";
	_key: string;
	text: string;
	marks?: string[];
}
export interface PTMarkDef {
	_type: string;
	_key: string;
	href?: string;
	[k: string]: unknown;
}
export interface PTBlock {
	_type: "block";
	_key: string;
	/** normal | h1..h6 | blockquote */
	style?: string;
	listItem?: "bullet" | "number";
	level?: number;
	children: PTSpan[];
	markDefs?: PTMarkDef[];
}
export interface PTTableCell {
	_type: "tableCell";
	_key: string;
	content: PTSpan[];
	markDefs?: PTMarkDef[];
	isHeader?: boolean;
}
export interface PTTableRow {
	_type: "tableRow";
	_key: string;
	cells: PTTableCell[];
}
export interface PTTable {
	_type: "table";
	_key: string;
	hasHeaderRow?: boolean;
	rows: PTTableRow[];
}
export interface PTImage {
	_type: "image";
	_key: string;
	asset?: { _ref?: string; url?: string };
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
	[k: string]: unknown;
}
/** Bloque de un tipo que el plugin no conoce: se conserva intacto y no es editable. */
export interface PTOtro {
	_type: string;
	_key: string;
	[k: string]: unknown;
}
export type PTNode = PTBlock | PTTable | PTImage | PTOtro;

// ─── Documento revisable ─────────────────────────────────────────────────────

export type CampoAncla = "content" | "title" | "excerpt" | "references";

/** Lo que se revisa de una entrada. `referencias` es texto, una referencia por línea ("1. …"). */
export interface DocRevisable {
	titulo: string;
	extracto: string;
	referencias: string;
	content: PTNode[];
}

/**
 * Posición de un comentario. Ver CONTRATO.md §3.
 * - campo "content": blockKey obligatorio; `ruta` = "rowKey/cellKey" (celda), "caption" o "alt" (imagen).
 * - campo "title" | "excerpt": sin blockKey.
 * - campo "references": `ruta` = número de la referencia ("3").
 * `inicio`/`fin` ausentes = el comentario es de la unidad entera (bloque, celda, título…).
 */
export interface Ancla {
	campo: CampoAncla;
	blockKey?: string;
	ruta?: string;
	inicio?: number;
	fin?: number;
	/** Texto exacto comentado (o un extracto de ≤ 200 caracteres si es la unidad entera). */
	cita: string;
	prefijo?: string;
	sufijo?: string;
	baseRevisionId?: string | null;
}

export interface AnclaResuelta {
	/** exacta: offsets válidos · recolocada: encontrada por cita · huerfana: no se encuentra o es ambigua */
	estado: "exacta" | "recolocada" | "huerfana";
	ancla: Ancla;
}

// ─── Estados ─────────────────────────────────────────────────────────────────

export type EstadoRevision = "por_revisar" | "con_comentarios" | "cambios_por_ver" | "aprobado";
export type EstadoComentario = "abierto" | "aplicado" | "descartado";
export type EstadoTrabajo = "cola" | "en_curso" | "hecho" | "error" | "conflicto" | "cancelado";
export type Motor = "api" | "local";
export type Veredicto = "pendiente" | "bien" | "deshecho" | "no_es_esto";
export type ModeloId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5" | "claude-fable-5-2";
export type Esfuerzo = "low" | "medium" | "high" | "xhigh";

// ─── Documentos del storage ──────────────────────────────────────────────────

export interface Aprobacion {
	draftRevisionId: string | null;
	hash: string;
	userId: string;
	nombre: string;
	fecha: string;
	/** true si el texto cambió después de aprobar. */
	cambiadoDespues?: boolean;
}

/** id = `${collection}:${entryId}` */
export interface RevisionDoc {
	collection: string;
	entryId: string;
	estado: EstadoRevision;
	vuelta: number;
	aprobacion: Aprobacion | null;
	abiertos: number;
	preguntasPendientes: number;
	/** Hash del contenido revisable visto por última vez (para detectar ediciones externas). */
	hash: string | null;
	actualizado: string;
}

/** id = `${userId}:${collection}:${entryId}` */
export interface LecturaDoc {
	userId: string;
	collection: string;
	entryId: string;
	/** Hash del contenido cuando se leyó. */
	hash: string | null;
	bloquesVistos: string[];
	posicion: string | null;
	completada: boolean;
	fecha: string;
}

export interface ComentarioDoc {
	collection: string;
	entryId: string;
	tipo: "comentario" | "pregunta";
	texto: string;
	textoPropuesto?: string | null;
	ancla: Ancla | null;
	/** Si el ancla ya no se encuentra en el texto actual. */
	huerfano?: boolean;
	estado: EstadoComentario;
	autorId: string;
	autorNombre: string;
	creado: string;
	parentId?: string | null;
	vuelta: number;
	/** Nota de quien corrigió (IA o persona) sobre cómo se resolvió. */
	respuestaIA?: string | null;
	reglaId?: string | null;
	/** Para preguntas: respuesta rápida elegida. */
	respuesta?: RespuestaPregunta | null;
}

export interface RespuestaPregunta {
	tipo: "correcto" | "quitar" | "cambiar" | "luego";
	texto?: string | null;
	userId: string;
	fecha: string;
}

/** Pregunta o decisión que afecta a uno o varios artículos. */
export interface ReglaDoc {
	pregunta: string;
	/** Entradas afectadas. */
	entradas: Array<{ collection: string; entryId: string }>;
	respuesta: RespuestaPregunta | null;
	creado: string;
}

export interface UsoIA {
	input_tokens: number;
	output_tokens: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

export interface TrabajoDoc {
	collection: string;
	entryId: string;
	motor: Motor;
	estado: EstadoTrabajo;
	modelo: ModeloId | null;
	esfuerzo: Esfuerzo | null;
	/** Reescritura completa (solo administrador). */
	completa: boolean;
	vuelta: number;
	baseDraftRevisionId: string | null;
	baseHash: string | null;
	creadoPor: string;
	creado: string;
	latido: string;
	/** Hasta cuándo está reclamado (motor local). */
	reclamadoHasta?: string | null;
	terminado?: string | null;
	error?: string | null;
	usage?: UsoIA | null;
	costeEstimado?: number | null;
	/** Salida guardada sin aplicar cuando hay conflicto. */
	salidaPendiente?: SalidaCorreccion | null;
}

export interface GuiaDoc {
	nombre: string;
	markdown: string;
	orden: number;
	actualizado: string;
}

export interface AuditoriaDoc {
	accion:
		| "comentar"
		| "cambiar_ya"
		| "terminar"
		| "entregar"
		| "veredicto"
		| "aprobar"
		| "retirar_aprobacion"
		| "publicar"
		| "publicar_sin_aprobar"
		| "restaurar";
	userId: string | null;
	collection: string;
	entryId: string;
	revisionId: string | null;
	hash: string | null;
	detalle?: string | null;
	fecha: string;
}

// ─── Versiones (historial de copias) ─────────────────────────────────────────

/** «cambio»: copia del texto antes de cada escritura; «publicacion»: lo que estaba publicado antes de publicar otra cosa. */
export type TipoVersion = "cambio" | "publicacion";

/** Copia guardada de un documento revisable. Máximo 5 por artículo y por tipo (rotan). */
export interface VersionDoc {
	collection: string;
	entryId: string;
	tipo: TipoVersion;
	/** Texto llano para la revisora: «Antes de «Cambiarlo ya»», «Versión publicada hasta el 15 nov»… */
	motivo: string;
	doc: DocRevisable;
	hash: string;
	/** Quién hizo el cambio que provocó la copia (null si no se sabe). */
	userId: string | null;
	nombre: string | null;
	fecha: string;
}

// ─── Corrección (motor A, motor B y «Cambiarlo ya» comparten formato) ────────

export interface BloqueParaIA {
	key: string;
	/** parrafo | titulo | lista | cita | tabla | imagen | otro */
	tipo: string;
	editable: boolean;
	markdown: string;
}

export interface ComentarioParaIA {
	id: string;
	campo: CampoAncla | "general";
	blockKey?: string;
	ruta?: string;
	cita?: string;
	texto: string;
	textoPropuesto?: string | null;
}

export interface EntradaCorreccion {
	trabajoId: string;
	collection: string;
	entryId: string;
	titulo: string;
	extracto: string;
	referencias: string;
	bloques: BloqueParaIA[];
	comentarios: ComentarioParaIA[];
	guias: Array<{ nombre: string; markdown: string }>;
	reglas: Array<{ pregunta: string; respuesta: string }>;
	completa: boolean;
}

export type Op =
	| { op: "reemplazar"; blockKey: string; markdown: string; comentarioIds: string[] }
	| { op: "insertar_tras"; blockKey: string; markdown: string; comentarioIds: string[] }
	| { op: "eliminar"; blockKey: string; comentarioIds: string[] }
	| { op: "campo"; campo: "title" | "excerpt"; texto: string; comentarioIds: string[] };

export interface Resolucion {
	comentarioId: string;
	accion: "aplicado" | "descartado";
	nota: string;
}

export interface SalidaCorreccion {
	ops: Op[];
	resoluciones: Resolucion[];
}

export type TipoAviso = "cifra" | "negacion" | "farmaco" | "cita_nueva" | "enlace_nuevo" | "no_pedido";

export interface Aviso {
	tipo: TipoAviso;
	/** Texto listo para mostrar: «Ha cambiado una cifra: de «60» a «58,40».» */
	mensaje: string;
	antes?: string;
	despues?: string;
}

/** Un cambio aplicado al documento, tal como se guarda para la segunda revisión. */
export interface CambioDoc {
	collection: string;
	entryId: string;
	vuelta: number;
	trabajoId: string | null;
	orden: number;
	op: "reemplazar" | "insertar" | "eliminar" | "campo";
	campo: CampoAncla;
	/** Clave del bloque afectado (el nuevo, en inserciones). */
	blockKey: string | null;
	/** Clave del bloque anterior al afectado, para poder reinsertar al deshacer una eliminación. */
	trasKey: string | null;
	antes: PTNode | string | null;
	despues: PTNode | string | null;
	comentarioIds: string[];
	avisos: Aviso[];
	veredicto: Veredicto;
	nota?: string | null;
	veredictoPor?: string | null;
	creado: string;
}

export interface OpRechazada {
	op: Op;
	motivo: string;
}

export interface ResultadoOps {
	doc: DocRevisable;
	cambios: Array<Omit<CambioDoc, "collection" | "entryId" | "vuelta" | "trabajoId" | "veredicto" | "creado">>;
	rechazadas: OpRechazada[];
}

export interface SegmentoDiff {
	tipo: "igual" | "añadido" | "eliminado";
	texto: string;
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────

export interface Ajustes {
	modeloDefecto: ModeloId;
	esfuerzo: Esfuerzo;
	/** USD; 0 = sin tope. */
	topeMensualUsd: number;
	/** Rol mínimo de EmDash que puede aprobar (40 = editor, 50 = admin). */
	rolAprueba: number;
	requiereAprobacion: boolean;
	/** Qué hace «He terminado»: dejar en cola para Claude Code o lanzar la API. */
	motorHeTerminado: Motor;
	/** Nombre que se muestra a la revisora como responsable técnico. */
	adminNombre: string;
	/** Correo al que avisar cuando la revisora termina un artículo. */
	avisarA: string;
	/** Farmacos u otros términos sensibles extra, separados por comas. */
	terminosSensibles: string;
	/** Copias del texto que se guardan por artículo antes de cada cambio (historial). */
	copiasCambios: number;
	/** Copias de lo publicado que se guardan por artículo antes de cada publicación. */
	copiasPublicaciones: number;
}

/** Límites admitidos para las copias del historial. */
export const COPIAS_MIN = 1;
export const COPIAS_MAX = 100;

export const AJUSTES_DEFECTO: Ajustes = {
	modeloDefecto: "claude-opus-5-5",
	esfuerzo: "high",
	topeMensualUsd: 20,
	rolAprueba: 40,
	requiereAprobacion: false,
	motorHeTerminado: "local",
	adminNombre: "El administrador",
	avisarA: "",
	terminosSensibles: "",
	copiasCambios: 20,
	copiasPublicaciones: 5,
};

// ─── Vistas (respuestas de las rutas; las consume el panel) ──────────────────

export type Publicacion = "sin_publicar" | "programado" | "publicado" | "publicado_con_cambios";

export interface UsuarioVista {
	id: string;
	nombre: string;
	esAdmin: boolean;
	puedeAprobar: boolean;
}

export interface ConfigVista {
	etiqueta: string;
	lectura: { cuerpo: string | null; titulos: string | null; css: string | null };
	adminNombre: string;
	motorHeTerminado: Motor;
	apiDisponible: boolean;
	requiereAprobacion: boolean;
}

export interface TrabajoVista {
	id: string;
	motor: Motor;
	estado: EstadoTrabajo;
	modelo: ModeloId | null;
	creado: string;
	terminado: string | null;
	error: string | null;
	costeEstimado: number | null;
}

export interface ArticuloFila {
	collection: string;
	id: string;
	slug: string | null;
	titulo: string;
	publicacion: Publicacion;
	estado: EstadoRevision;
	vuelta: number;
	abiertos: number;
	preguntasPendientes: number;
	cambiosPendientes: number;
	aprobacion: Aprobacion | null;
	trabajo: TrabajoVista | null;
	minutosLectura: number;
	actualizado: string;
	/** Progreso de lectura del usuario actual, 0-100. */
	leido: number;
}

export interface PreguntaVista {
	reglaId: string;
	pregunta: string;
	entradas: Array<{ collection: string; id: string; titulo: string; cita: string | null; comentarioId: string }>;
	respuesta: RespuestaPregunta | null;
}

export interface InicioVista {
	usuario: UsuarioVista;
	config: ConfigVista;
	resumen: { total: number; aprobados: number; porRevisar: number; cambiosQueEsperan: number };
	seguirCon: { collection: string; id: string; titulo: string; empezado: boolean } | null;
	preguntas: PreguntaVista[];
	articulos: ArticuloFila[];
}

export interface ComentarioVista extends ComentarioDoc {
	id: string;
	/** Puede editar o borrar (autor o administrador, y solo si está abierto). */
	editable: boolean;
}

export interface CambioVista extends CambioDoc {
	id: string;
}

export interface ArticuloVista {
	usuario: UsuarioVista;
	config: ConfigVista;
	articulo: {
		collection: string;
		id: string;
		slug: string | null;
		doc: DocRevisable;
		portada: { url: string; alt: string } | null;
		publicacion: Publicacion;
		urlPublica: string | null;
		urlEditor: string;
		draftRevisionId: string | null;
		hash: string;
		minutosLectura: number;
	};
	revision: RevisionDoc;
	comentarios: ComentarioVista[];
	/** Cambios de la vuelta actual (vacío si no está en «cambios por ver»). */
	cambios: CambioVista[];
	/** Comentarios que la corrección no aplicó, con su motivo. */
	noAplicados: ComentarioVista[];
	trabajo: TrabajoVista | null;
	lectura: LecturaDoc | null;
	/** true si el usuario completó la lectura de la versión anterior a los cambios. */
	leyoVersionAnterior: boolean;
	siguiente: { collection: string; id: string; titulo: string } | null;
	pendientesTotal: number;
}

export interface AjustesVista {
	ajustes: Ajustes;
	apiDisponible: boolean;
	gastoMes: number;
	mcpUrl: string;
	modelos: Array<{ id: ModeloId; nombre: string; costeOrientativo: string }>;
}

// ─── Historial de versiones ──────────────────────────────────────────────────

export interface ResumenVersion {
	/** Párrafos (y título, extracto o fuentes) que difieren del texto actual. */
	bloquesDistintos: number;
	/** Palabras añadidas o quitadas respecto al texto actual. */
	palabrasDistintas?: number;
}

export interface VersionVista {
	id: string;
	tipo: TipoVersion;
	motivo: string;
	fecha: string;
	nombre: string | null;
	resumen: ResumenVersion;
	/** true si la copia es igual que el texto actual. */
	igualQueActual: boolean;
}

/**
 * Una unidad que difiere entre una copia y el texto actual. Los segmentos van
 * de la copia (`eliminado`: estaba en la copia y ya no está) al texto actual
 * (`añadido`: está ahora y no estaba en la copia).
 */
export interface BloqueComparado {
	campo: CampoAncla;
	blockKey: string | null;
	/** parrafo | titulo | lista | cita | tabla | imagen | otro (o el campo). */
	tipoBloque: string;
	estado: "cambiado" | "añadido" | "eliminado";
	segmentos: SegmentoDiff[];
	/** El texto es el mismo y solo cambia el formato (negritas, enlaces, estilo…). */
	soloFormato: boolean;
}

export interface HistorialVista {
	cambios: VersionVista[];
	publicaciones: VersionVista[];
	actual: { hash: string };
	publicada: { hash: string } | null;
	/** Cuántas copias se guardan de cada tipo (ajustes). */
	limites: { cambios: number; publicaciones: number };
}

export interface VersionDetalle {
	version: VersionVista & { doc: DocRevisable };
	comparacion: BloqueComparado[];
}
