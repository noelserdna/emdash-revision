# Contrato interno de `emdash-revision`

Documento de trabajo para quienes implementan el plugin en paralelo. Los tipos están en `src/lib/types.ts` y el storage en `src/lib/store.ts`: **no se cambian** sin avisar. El diseño de producto y de UX está resumido en el README.

Convenciones: TypeScript estricto (`noUncheckedIndexedAccess`), imports relativos con extensión `.js`, tabuladores, comentarios y nombres en español, ESM. Las librerías de `src/lib/` marcadas como **puras** no importan `emdash`, ni DOM, ni Node: solo Web APIs (`crypto.subtle`, `Intl`).

Reparto de ficheros (cada agente toca solo los suyos):

| Agente | Ficheros |
|---|---|
| Librerías | `src/lib/{bloques,anclas,ops,diff,sensibles,hash}.ts`, `test/{bloques,anclas,ops,diff,sensibles}.test.ts`, `test/fixtures/` |
| Motor IA | `src/lib/{prompt,prompt-aprendizaje,motor-api,costes}.ts`, `test/{prompt,motor-api}.test.ts` |
| Servidor | `src/plugin.ts`, `src/lib/{acceso,contenido,revisiones,comentarios,trabajos,preguntas,correo,ajustes,aprendizaje}.ts`, `test/helpers.ts`, `test/servidor-*.test.ts`, `skills/*/SKILL.md` |
| Panel | `src/admin.tsx`, `src/admin/**` |

## 1. Portable Text del sitio

Formas reales (las produce `menopausia/scripts/importar-articulos.mjs`):

- `block` con `style`: `normal`, `h2`, `h3` (pueden aparecer `h1`–`h6`), `blockquote`. Listas: `listItem: "bullet" | "number"` y `level` (1 por defecto). Marcas: `strong`, `em`, `code` y enlaces por `markDefs` (`{_type: "link", _key, href}`).
- Las citas con viñetas llegan como bloques `blockquote` cuyo texto empieza por `• ` literal. Se conserva tal cual.
- `table`: `{rows: [{_type: "tableRow", _key, cells: [{_type: "tableCell", _key, content: PTSpan[], markDefs, isHeader?}]}], hasHeaderRow}`.
- `image`: `{asset: {_ref, url}, alt, caption?, width, height, blurhash?, dominantColor?}`.
- El editor nativo puede añadir otras marcas (`underline`, `strike-through`) y otros tipos de bloque: se conservan y se tratan como no editables si no se conocen.

## 2. `src/lib/bloques.ts` (pura)

```ts
/** Texto plano de una unidad: concatenación exacta de span.text. `ruta` como en Ancla. */
export function textoDeBloque(node: PTNode, ruta?: string): string;
/** Texto plano de la unidad que señala un ancla dentro del documento, o null si no existe. */
export function textoDeUnidad(doc: DocRevisable, ancla: Pick<Ancla, "campo" | "blockKey" | "ruta">): string | null;
/** Líneas de referencias: [{ numero: "1", texto: "Maki PM…" }] a partir del campo de texto. */
export function referenciasDe(texto: string): Array<{ numero: string; texto: string }>;
/** parrafo | titulo | lista | cita | tabla | imagen | otro */
export function tipoDeBloque(node: PTNode): string;
/** Editable por operaciones: block de estilos conocidos y table. image y otros, no. */
export function esEditable(node: PTNode): boolean;
/** Markdown de UN bloque. Marcas: **strong**, *em*, `code`, [texto](href). Títulos con #, listas con "- " / "1. " (sangría de 2 espacios por nivel), citas con "> ", tablas GFM, imagen "![alt](url)" + línea "*caption*". Otros: "<!-- bloque:TIPO -->". Marcas desconocidas se conservan como <span data-mark="x">…</span>. */
export function bloqueAMarkdown(node: PTNode): string;
/** Markdown (uno o varios bloques separados por línea en blanco) → nodos PT con claves nuevas de `nuevaClave`. Solo nivel de bloque: párrafos, títulos, elementos de lista, citas, tablas. No genera imágenes. */
export function markdownABloques(md: string, nuevaClave: () => string): PTNode[];
/** Garantiza _key presentes y únicas en bloques, spans, markDefs, filas y celdas. Devuelve el mismo array si no hubo cambios. */
export function normalizarClaves(content: PTNode[], nuevaClave?: () => string): { content: PTNode[]; cambiado: boolean };
export function nuevaClave(): string; // 12 caracteres aleatorios [a-z0-9]
/** Documento completo a Markdown (para exportar y para la IA en modo completo). Incluye título como "# ", y las referencias al final bajo "## Fuentes". */
export function docAMarkdown(doc: DocRevisable): string;
/** Bloques etiquetados para la IA. */
export function bloquesParaIA(content: PTNode[]): BloqueParaIA[];
/** Palabras del documento / 220, redondeado hacia arriba, mínimo 1. */
export function minutosDeLectura(doc: DocRevisable): number;
```

Requisito de ida y vuelta: para todo bloque `b` de tipo `block` o `table` con marcas conocidas, `markdownABloques(bloqueAMarkdown(b))` produce un único bloque con el mismo `_type`, `style`, `listItem`, `level`, el mismo texto plano y las mismas marcas por rango (las `_key` cambian). Hay una **prueba dorada** con los artículos reales: `test/fixtures/` se genera convirtiendo con la función `toPT` del importador varios `menopausia/contenido/fase-*/NN-*/articulo.md` (copiar esa función al fixture o al test; no importar del sitio en tiempo de test: guardar el PT ya convertido como JSON, 6-8 artículos variados con tablas y citas).

## 3. `src/lib/anclas.ts` (pura)

```ts
/** Crea un ancla para una unidad entera (sin inicio/fin) o para un fragmento. Calcula cita, prefijo y sufijo (32 caracteres). */
export function crearAncla(doc: DocRevisable, pos: { campo: CampoAncla; blockKey?: string; ruta?: string; inicio?: number; fin?: number }, baseRevisionId?: string | null): Ancla | null;
/** Busca `fragmento` dentro de la unidad y devuelve el ancla afinada; null si no aparece o aparece más de una vez (ambiguo). Comparación normalizada. */
export function anclaDeFragmento(doc: DocRevisable, unidad: Pick<Ancla, "campo" | "blockKey" | "ruta">, fragmento: string, baseRevisionId?: string | null): Ancla | null;
/** Vuelve a localizar el ancla en el documento actual. Orden: offsets+cita → cita en la unidad (desempate por prefijo/sufijo y cercanía) → cita normalizada en todo el campo → huérfana. Si la unidad entera (sin offsets) sigue existiendo, es "exacta". */
export function resolverAncla(doc: DocRevisable, ancla: Ancla): AnclaResuelta;
/** NFKC, colapsa espacios (incluidos U+00A0 y U+202F), unifica comillas y guiones. Devuelve texto y mapa de índices normalizado→original. */
export function normalizar(texto: string): { texto: string; mapa: number[] };
```

Offsets en unidades UTF-16 sobre el texto de `textoDeUnidad`. Nunca se adivina: si la cita aparece varias veces y prefijo/sufijo no desempatan, `huerfana`.

## 4. `src/lib/sensibles.ts` y `src/lib/diff.ts` (puras)

```ts
/** Diff por palabras (conserva espacios y puntuación como parte de los segmentos). LCS sobre tokens. */
export function diffPalabras(antes: string, despues: string): SegmentoDiff[];
/** Avisos al comparar el texto de un bloque antes y después. `extra`: términos adicionales (fármacos). */
export function detectarSensibles(antes: string, despues: string, extra?: string[]): Aviso[];
```

`detectarSensibles` compara los multiconjuntos de: cifras con su unidad (`58,40`, `60 %`, `2 mg`, `1.000`, rangos), negaciones y cuantificadores (`no`, `nunca`, `ni`, `sin`, `siempre`, `jamás`, `más`, `menos`, `antes`, `después`, `mayor`, `menor`, `aumenta`, `reduce`, `todas`, `ninguna`), y términos de `extra`. Tipos `cifra`, `negacion`, `farmaco`. Mensajes en español listos para mostrar.

## 5. `src/lib/ops.ts` y `src/lib/hash.ts` (puras)

```ts
export interface ContextoOps {
	/** Comentarios abiertos, para validar a qué responde cada operación. */
	comentarios: Array<{ id: string; ancla: Ancla | null }>;
	/** true = reescritura completa: no se marca "no pedido". */
	completa?: boolean;
	terminosSensibles?: string[];
	nuevaClave?: () => string;
}
/** Aplica las operaciones en orden. No lanza: lo inválido va a `rechazadas`. */
export function aplicarOps(doc: DocRevisable, ops: Op[], ctx: ContextoOps): ResultadoOps;
/** Sustitución literal del fragmento de un ancla por `texto` conservando las marcas de alrededor. Devuelve null si el ancla no se resuelve o no es un fragmento con offsets ni una unidad de texto. */
export function sustituirFragmento(doc: DocRevisable, ancla: Ancla, texto: string, ctx?: Pick<ContextoOps, "terminosSensibles" | "nuevaClave">): ResultadoOps | null;
/** Deshace un cambio sobre el documento actual: reemplazar → repone `antes`; insertar → quita el bloque; eliminar → reinserta `antes` tras `trasKey` (o al principio); campo → repone el texto. Devuelve null si ya no es aplicable. */
export function deshacerCambio(doc: DocRevisable, cambio: Pick<CambioDoc, "op" | "campo" | "blockKey" | "trasKey" | "antes" | "despues">): DocRevisable | null;
/** SHA-256 hex de la serialización canónica de { titulo, extracto, referencias, content sin _key }. */
export function hashDoc(doc: DocRevisable): Promise<string>;
```

Reglas de `aplicarOps`:
- `reemplazar`: el bloque debe existir y ser editable. El markdown debe producir exactamente un bloque; si produce varios, el primero reemplaza (conserva la `_key` original) y el resto se inserta detrás, cada uno como cambio `insertar`. El bloque nuevo conserva la `_key` del original.
- `insertar_tras`: el bloque de referencia debe existir. `eliminar`: debe existir (se permite eliminar imágenes solo si algún `comentarioIds` apunta a ese bloque).
- `campo`: reemplaza título o extracto.
- Aviso `no_pedido` si ningún `comentarioIds` corresponde a un comentario de `ctx.comentarios` cuya ancla apunte a ese bloque/campo, o a un comentario general (`ancla: null`); no se rechaza. Con `completa: true` no se marca.
- Avisos de `detectarSensibles` en cada reemplazo. Aviso `enlace_nuevo` si aparece un href que no estaba en el documento. Aviso `cita_nueva` si aparece `[n]` cuyo número no existe en `referenciasDe(doc.referencias)`.
- Una operación sobre una clave inexistente, sobre un bloque no editable o con markdown vacío se rechaza con motivo en español.
- Los bloques no tocados quedan **idénticos por referencia de contenido** (mismo JSON).

## 6. Motor IA: `src/lib/prompt.ts`, `motor-api.ts`, `costes.ts`

```ts
// prompt.ts (pura)
export function construirSystem(entrada: EntradaCorreccion): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
export function construirUsuario(entrada: EntradaCorreccion): string;
export const ESQUEMA_SALIDA: Record<string, unknown>; // JSON Schema de SalidaCorreccion, additionalProperties:false
/** Valida y normaliza una salida (del modelo o de MCP). Lanza Error con mensaje en español si no cumple. */
export function validarSalida(valor: unknown): SalidaCorreccion;
/** Texto de instrucciones para un agente externo (motor B): mismas reglas que el system, en Markdown. */
export function instruccionesParaAgente(): string;

// costes.ts (pura)
export const MODELOS: Array<{ id: ModeloId; nombre: string; entrada: number; salida: number; costeOrientativo: string }>; // USD por millón
export function costeDe(modelo: ModeloId, uso: UsoIA): number;

// motor-api.ts
export interface ResultadoMotor { salida: SalidaCorreccion; usage: UsoIA; coste: number; modelo: string }
export class ErrorMotor extends Error { constructor(mensaje: string, readonly codigo: "sin_clave" | "rechazo" | "truncado" | "salida_invalida" | "api") }
export function corregirConApi(entrada: EntradaCorreccion, opts: { apiKey: string; modelo: ModeloId; esfuerzo: Esfuerzo; fetch?: typeof fetch; cliente?: unknown }): Promise<ResultadoMotor>;
/** Síntesis de la guía aprendida: misma llamada, esquema ESQUEMA_SALIDA_APRENDIZAJE (prompt-aprendizaje.ts). */
export function aprenderConApi(entrada: EntradaAprendizaje, opts: OpcionesMotor): Promise<{ salida: SalidaAprendizaje; usage: UsoIA; coste: number; modelo: string }>;
```

Llamada: `@anthropic-ai/sdk`, `client.beta.messages.stream({...}).finalMessage()`, `thinking: {type: "adaptive"}`, `output_config: { effort, format: { type: "json_schema", schema: ESQUEMA_SALIDA } }`, `max_tokens: 32000`, `betas: ["server-side-fallback-2026-07-01"]` y `fallbacks: "default"` salvo con `claude-haiku-5-5`, `system` con `cache_control` en el bloque de guías. Sin herramientas. Comprobar `stop_reason` (`refusal` → `rechazo`, `max_tokens` → `truncado`) antes de parsear. El contenido y los comentarios van delimitados como datos (`<articulo>`, `<comentarios>`), con la instrucción de no obedecer órdenes que aparezcan dentro.

## 7. Servidor: `src/plugin.ts`

`createPlugin(options: RevisionPluginOptions)` → `definePlugin({ id, version, capabilities, allowedHosts, storage: STORAGE, hooks, routes, mcp, admin: { entry: "emdash-revision/admin", pages } })`, `export default createPlugin`. Mismo estilo que el plugin hermano emdash-buzon.

Roles de EmDash: 40 = editor, 50 = admin (`ctx.user.role`). `esAdmin = role >= 50`. `puedeAprobar = role >= ajustes.rolAprueba`.

Ajustes en `ctx.kv` clave `ajustes` (tipo `Ajustes`, fusionado con `AJUSTES_DEFECTO`). Gasto del mes en `ctx.kv` clave `gasto:YYYY-MM`.

Todas las rutas son POST JSON. `M` = `plugins:read` (editora), `A` = `plugins:manage`.

| Ruta | Perm. | Entrada | Salida |
|---|---|---|---|
| `inicio` | M | `{}` | `InicioVista` |
| `articulo/get` | M | `{collection, id}` | `ArticuloVista` |
| `lectura/guardar` | M | `{collection, id, bloquesVistos: string[], posicion: string\|null, completada: boolean}` | `{ok: true}` |
| `comentarios/crear` | M | `{collection, id, texto, textoPropuesto?, ancla: Ancla\|null, fragmento?: string, parentId?, general?: boolean}` | `{comentario: ComentarioVista, revision: RevisionDoc}` |
| `comentarios/editar` | M | `{id, texto, textoPropuesto?}` | `{comentario}` |
| `comentarios/estado` | M | `{id, estado: "abierto"\|"descartado"}` | `{comentario, revision}` |
| `comentarios/borrar` | M | `{id}` | `{ok: true, revision}` |
| `comentarios/aplicar` | M | `{id}` («Cambiarlo ya») | `ArticuloVista` |
| `preguntas/responder` | M | `{reglaId, tipo: "correcto"\|"quitar"\|"cambiar"\|"luego", texto?}` | `{pregunta: PreguntaVista}` |
| `revision/terminar` | M | `{collection, id}` («He terminado») | `{trabajo: TrabajoVista}` |
| `revision/aprobar` | M | `{collection, id, confirmar?: boolean}` | `{revision}` o `{requiereConfirmacion: true, leido: number, cambiosPendientes: number}` |
| `revision/retirar` | M | `{collection, id}` | `{revision}` |
| `revision/publicar` | M | `{collection, id, confirmar?: boolean}` | `{ok: true, urlPublica}` o `{requiereConfirmacion: true, motivo: string, aprobacion: Aprobacion\|null}` |
| `cambios/veredicto` | M | `{id, veredicto: Veredicto, nota?, confirmado?: boolean}` | `{cambio: CambioVista, revision, doc?: DocRevisable}` |
| `trabajo/estado` | M | `{collection, id}` | `{trabajo: TrabajoVista\|null, revision}` |
| `trabajo/crear` | A | `{collection, id, motor, modelo?, esfuerzo?, completa?}` | `{trabajo}` |
| `trabajo/cancelar` | A | `{id}` | `{ok: true}` |
| `trabajo/aplicar-pendiente` | A | `{id}` (reintenta aplicar la salida de un conflicto sobre el texto actual) | `{trabajo}` |
| `guias/listar` | A | `{}` | `{guias: Array<GuiaDoc & {id}>}` |
| `guias/guardar` | A | `{id?, nombre, markdown, orden?}` | `{guia}` |
| `guias/borrar` | A | `{id}` | `{ok: true}` |
| `ajustes/get` | A | `{}` | `AjustesVista` |
| `ajustes/guardar` | A | `Partial<Ajustes>` | `AjustesVista` |
| `preguntas/importar` | A | `{preguntas: Array<{pregunta, entradas: Array<{collection, slug?, id?, cita?}>}>}` | `{creadas: number, sinColocar: number}` |
| `mcp/cola` | A | `{}` | `{trabajos: Array<TrabajoVista & {collection, entryId, titulo, comentarios: number}>}` |
| `mcp/reclamar` | A | `{trabajoId?}` (sin id: el más antiguo en cola) | `{entrada: EntradaCorreccion, instrucciones: string}` o `{vacio: true}` |
| `mcp/articulo` | A | `{trabajoId}` | `{entrada: EntradaCorreccion, instrucciones}` |
| `mcp/entregar` | A | `{trabajoId, ops, resoluciones}` | `{estado: EstadoTrabajo, cambios: number, rechazadas: OpRechazada[]}` |

### Versiones

| Ruta | Perm. | Entrada | Salida |
|---|---|---|---|
| `versiones/listar` | M | `{collection, id}` | `HistorialVista`: `{cambios: VersionVista[], publicaciones: VersionVista[], actual: {hash}, publicada: {hash}\|null}` (sin el `doc` de cada copia) |
| `versiones/ver` | M | `{id}` | `VersionDetalle`: `{version: VersionVista & {doc}, comparacion: BloqueComparado[]}` (solo lo que difiere del texto actual, alineado por `_key`) |
| `versiones/restaurar` | M | `{id, publicar?: boolean, confirmar?: boolean}` | `ArticuloVista`, o `{requiereConfirmacion: true, motivo, aprobacion}` (con `publicar` y sin aprobación vigente para el texto restaurado; no se toca nada hasta `confirmar: true`) |

Reglas del historial (colección `versiones`, tipo `VersionDoc`, lógica en `src/lib/versiones.ts` y `src/lib/historial.ts`):
- **Copia de cambio** (`tipo: "cambio"`): `escribirDoc(env, entrada, nuevo, motivo)` guarda el `entrada.doc` anterior antes de escribir si el hash cambia. `motivo: null` no guarda (normalizar claves). `escribirCampos` (`campoRevisado` al aprobar) no guarda. Motivos: «Antes de «Cambiarlo ya»», «Antes de deshacer un cambio», «Antes de la corrección de la IA (vuelta N)», «Antes de restaurar una versión».
- **Edición externa** (`content:afterSave`, escritura que no es del plugin y hash distinto del último visto): copia «Antes de una edición en el editor» con la revisión de EmDash anterior a la actual (`ctx.content.listRevisions`; se prefiere la que coincide con el último hash visto). Si no se puede obtener, no guarda nada.
- **Copia de publicación** (`tipo: "publicacion"`): hook `content:beforePublish` (capacidad `hooks.content-policy:register`, `errorPolicy: "continue"`, 5 s). Si la entrada ya estaba publicada y el borrador que se publica es distinto, guarda las columnas vivas (`ctx.content.get`) con el motivo «Versión publicada hasta el 15 nov». Nunca cancela; los errores solo se registran. Cubre también lo publicado desde el editor nativo.
- **Rotación:** por artículo y por tipo, `copiasCambios` (20 por defecto) y `copiasPublicaciones` (5 por defecto), configurables en Ajustes o con `revisionPlugin({ versiones })` (entre 1 y 100); al superar el límite se borra la más antigua de ese tipo. No se guarda una copia con el mismo hash que la más reciente de su tipo.
- **Restaurar:** copia del texto actual (rotando), escribe el `doc` de la versión en el borrador, re-ancla los comentarios abiertos (huérfanos si ya no encajan), marca la aprobación «cambiado después» si el hash difiere, auditoría `restaurar`. Con `publicar`, después llama a `publicar()` con las mismas reglas de rol y `requiereAprobacion`.
- **Purga:** `content:afterDelete` permanente y `plugin:uninstall` con `deleteData` borran también las versiones.

### Aprendizaje

La guía de redacción aprende sola de lo que corrige la revisora, sin paso de aprobación. Lógica en `src/lib/aprendizaje.ts` (servidor) y `src/lib/prompt-aprendizaje.ts` (pura: prompt, esquema y `validarSalidaAprendizaje`). Tipos `SenalDoc`, `AprendizajeDoc`, `GuiaHistorialDoc`, `SalidaAprendizaje`, `EntradaAprendizaje` y `EstadoAprendizajeVista` en `types.ts`.

| Ruta | Perm. | Entrada | Salida |
|---|---|---|---|
| `aprendizaje/estado` | A | `{}` | `EstadoAprendizajeVista`: guía, señales pendientes, última actualización y resumen, `parado` (`sin_clave`, `tope`, `desactivado` o null), error, `enCurso`, criterios activos y retirados |
| `aprendizaje/actualizar` | A | `{}` («Actualizar ahora») | `{programado: boolean, motivo: "sin_clave"\|"tope"\|"sin_senales"\|null, estado}`; programa la síntesis por cron a 2 s |
| `aprendizaje/retirar` | A | `{id}` | `EstadoAprendizajeVista` |
| `aprendizaje/historial` | A | `{}` | `{versiones: GuiaHistorialVista[]}` (de la más reciente a la más antigua) |
| `aprendizaje/restaurar` | A | `{id}` | `EstadoAprendizajeVista` |
| `mcp/aprendizaje-pendiente` | A | `{}` | `{entrada: EntradaAprendizaje, lote: string[], pendientes, instrucciones}` o `{vacio: true, pendientes: 0}` |
| `mcp/aprendizaje-aplicar` | A | `{operaciones, resumen, lote?}` | `{añadidos, modificados, retirados, procesadas, resumen}` |

Reglas:
- **Señales** (colección `senales`, índices `fecha`, `procesada`, `entryId`, `[procesada, fecha]`): una por acción de una **revisora** = usuario con `role >= ajustes.rolAprueba` que no es administrador (o también administradores con `aprenderDeAdministradores`). Tipos: `comentario` (texto, texto propuesto en `despues`, `cita` y `campo` del ancla, `general`), `cambiar_ya` (completa la señal del mismo comentario, `ref` = id del comentario: `antes` = cita, `despues` = propuesto), `no_es_esto` y `deshacer` (solo sobre cambios de la IA, `trabajoId` no nulo: `antes`/`despues` en texto plano y la nota), `respuesta` (pregunta en `texto`, respuesta en `despues`, «Afecta a N artículos» en `nota`; `luego` no cuenta) y `edicion` (`content:afterSave` externo; la revisora se reconoce por `event.actor.role`, confirmado con `ctx.users.get`; resumen por bloque frente a la revisión anterior que encuentra `copiaDeEdicionExterna`, como mucho 3 bloques y 1.500 caracteres). Textos recortados (1.000 caracteres; cita 500; título 300). `registrarSenal` nunca lanza.
- **Casilla** «Esto vale para todos los artículos» en el formulario de comentario: `general: true` en el comentario y en la señal.
- **Guía automática**: id fijo `aprendido` en `guias`, `automatica: true`, nombre `ajustes.nombreGuiaAprendida`, `orden` = el de la primera guía + 0,5 (las demás son enteras, así que queda justo detrás). Su Markdown se genera siempre desde los `aprendizajes` activos, agrupados por tema: `- {texto} (desde el {fecha}; visto en: «título», …)`. `guias/guardar` y `guias/borrar` la rechazan. Como está en `guias`, llega a `EntradaCorreccion.guias` (motor A y B) sin más cambios.
- **Síntesis** (`sintetizarConApi`): cron diario `aprendizaje` (`0 {horaAprendizaje} * * *`, UTC, 3 por defecto) y tarea única `aprendizaje-pronto` a los 10 minutos de cada «Aprobar» y de cada señal `general` (antirrebote: no se programa otra si ya hay una pendiente en `kv` `aprendizaje:pronto`). El cron diario se registra en `plugin:install`/`plugin:activate` y, para sitios ya instalados, de forma perezosa en `inicio`, `ajustes/get`, `ajustes/guardar` (si cambian `aprenderAuto` u `horaAprendizaje`) y `aprendizaje/estado`. Sin `aprenderAuto` (salvo «Actualizar ahora»), sin clave o con el tope alcanzado no hace nada: las señales se acumulan. Bloqueo en `kv` `aprendizaje:bloqueo` (15 min). Toma hasta 80 señales no procesadas (por fecha), todas las guías y los aprendizajes activos y retirados, y llama a `aprenderConApi` (mismo cliente, modelo y esfuerzo de los ajustes, `fallbacks`, `stop_reason` y coste que el motor A; el gasto se suma aunque la salida no valga).
- **Salida**: `{operaciones: Array<{op: "añadir"|"modificar"|"retirar", id?, texto?, tema?, senales: string[]}>, resumen}`. Validación: forma y textos (no vacíos, < 600 caracteres) en `validarSalidaAprendizaje`; en el servidor, ids existentes en `modificar`/`retirar`, señales existentes, y un criterio retirado por una persona solo se reactiva con una señal `general`. Si falla, no se aplica nada, las señales siguen pendientes y el error queda en el estado.
- **Aplicar** (`aplicarAprendizaje`, común a API y MCP): guarda la versión anterior en `guias_historial` (markdown + conjunto de aprendizajes; últimas 20), aplica, regenera la guía, marca procesadas todas las señales del lote (se usen o no), auditoría `aprender`, correo a `ajustes.avisarA` con los criterios añadidos, modificados y retirados y el enlace a la página de guías.
- **Retirar a mano**: `estado: "retirado"`, `retiradoPor` = nombre; se guarda versión antes. **Restaurar**: guarda la actual y repone el markdown y los aprendizajes de la versión.
- **Ajustes nuevos**: `aprenderAuto` (true), `horaAprendizaje` (3), `aprenderDeAdministradores` (false), `nombreGuiaAprendida` («Aprendido de las correcciones de la revisora»).

Herramientas MCP (`mcp.tools`): `revision_cola`, `revision_reclamar`, `revision_articulo`, `revision_entregar` (`destructive: true`), `revision_aprendizaje_pendiente` y `revision_aprendizaje_aplicar` (`destructive: true`), cada una sobre su ruta `mcp/*`. Skills: `skills/aplicar-revision` y `skills/aprender-de-la-revisora`.

Reglas de negocio:
- **Leer** con `ctx.content.getVersioned` (borrador fusionado). El documento revisable se arma con los campos de `options.collections[collection]`. Antes de usar `content` se pasa por `normalizarClaves`; si cambió y hay que anclar, se guarda.
- **Escribir** con `ctx.content.update(collection, id, { data: {campos cambiados} })` — comprobar la firma real de `ContentWriteInput` en `node_modules/emdash`. El plugin marca sus propias escrituras (p. ej. un `Set` en memoria con `collection:id:hash` esperado) para que el hook `content:afterSave` no las trate como edición externa.
- **Hook `content:afterSave`** (colecciones configuradas): recalcula el hash; si difiere del guardado y la escritura no es del plugin → re-ancla comentarios abiertos (marca `huerfano`), y si hay aprobación con hash distinto pone `aprobacion.cambiadoDespues = true` (el estado sigue `aprobado`; la vista lo muestra degradado).
- **Hook `content:afterDelete`**: purga todo lo de esa entrada si el borrado es permanente.
- **Estado**: `por_revisar` → al crear el primer comentario abierto, `con_comentarios`; al quedar 0 abiertos sin cambios pendientes, vuelve a `por_revisar`; al entregar una corrección, `cambios_por_ver` y `vuelta + 1`; al aprobar, `aprobado`. Un comentario nuevo sobre un artículo aprobado lo devuelve a `con_comentarios` y anula la aprobación.
- **Aprobar**: requiere `puedeAprobar`. Si la lectura no está completa o quedan cambios con veredicto `pendiente`, devuelve `requiereConfirmacion` salvo `confirmar: true`. Guarda `Aprobacion` con hash y `draftRevisionId`, escribe `campoRevisado` con la fecha ISO si está configurado (esa escritura no invalida la aprobación: el hash no incluye ese campo), y registra auditoría.
- **Publicar**: si no hay aprobación vigente (hash actual ≠ hash aprobado o `cambiadoDespues`), devuelve `requiereConfirmacion` salvo `confirmar: true`; con `ajustes.requiereAprobacion`, solo un admin puede confirmar. `getVersioned` → `publish({_rev})`. Auditoría `publicar` o `publicar_sin_aprobar`.
- **«He terminado»**: crea el trabajo con `ajustes.motorHeTerminado` (si es `api` y no hay clave o se alcanzó el tope, cae a `local`), envía correo a `ajustes.avisarA` si hay transporte (`ctx.email?.send`; tolerar su ausencia), auditoría `terminar`. Un solo trabajo activo (`cola`/`en_curso`) por entrada.
- **Motor A**: `trabajo/crear` con `motor: "api"` → `ctx.cron.schedule("trabajo:<id>", { schedule: <ISO dentro de 5 s>, data: {trabajoId} })`. Hook `cron` (`timeout` alto si `HookConfig` lo admite): carga el trabajo, lo pasa a `en_curso`, llama a `corregirConApi`, y entrega con la misma función que `mcp/entregar`. Errores → `estado: "error"` con mensaje. La clave se lee del env del Worker (`import("./env.js")`, como `emdash-buzon/src/lib/transport.ts::loadWorkerEnv`) con nombre `options.claveApi ?? "ANTHROPIC_API_KEY"`; en Node (dev) probar también `process.env`.
- **Entrega** (común): valida con `validarSalida`; idempotente (si el trabajo ya está `hecho`, devuelve el resultado guardado); compara `baseHash` con el hash actual → si difiere, `estado: "conflicto"` y guarda `salidaPendiente`; si no, `aplicarOps`, `update`, crea un `CambioDoc` por cambio, marca comentarios `aplicado`/`descartado` con `respuestaIA` según `resoluciones`, estado `cambios_por_ver`, `vuelta + 1`, correo a quien pidió la corrección (si es editora), auditoría `entregar`.
- **Veredicto**: `bien`; `deshecho` (aplica `deshacerCambio`, guarda, reabre los comentarios del cambio); `no_es_esto` (nota obligatoria; reabre comentarios añadiendo la nota como respuesta hija). Los cambios con avisos exigen `confirmado: true` para `bien`. Cuando no quedan pendientes: si todos `bien`/`deshecho` sin comentarios abiertos → sigue `cambios_por_ver` hasta que se apruebe; si hay comentarios abiertos → `con_comentarios`.
- **«Cambiarlo ya»** (`comentarios/aplicar`): requiere `textoPropuesto` y ancla; `sustituirFragmento`; guarda; crea `CambioDoc` con veredicto `bien`; comentario `aplicado`; auditoría `cambiar_ya`. No cambia de vuelta.
- **Preguntas**: `preguntas/importar` crea una `ReglaDoc` y un `ComentarioDoc` de tipo `pregunta` por entrada (ancla por `anclaDeFragmento` sobre todo el campo `content` si se da `cita`; si no se coloca, comentario general). `preguntas/responder`: guarda la respuesta en la regla y en sus comentarios; `correcto` → comentarios `descartado` con nota «Es correcto»; `quitar`/`cambiar` → se convierten en comentarios abiertos normales con el texto de la respuesta (y `textoPropuesto` si `cambiar`), lo que pasa esas entradas a `con_comentarios`; `luego` → sin cambios. Las reglas respondidas (salvo `luego`) se incluyen en `EntradaCorreccion.reglas`.
- **Auditoría**: toda acción de la lista `AuditoriaDoc.accion`.

`inicio`: lista todas las entradas de las colecciones configuradas (`ctx.content.list` con cursor, hasta 500), cruza con `revisiones`, trabajos activos y lecturas del usuario. `seguirCon`: la lectura sin completar más reciente del usuario; si no hay, el primer artículo con cambios por ver; si no, el primero por revisar (publicados primero).

Tests del servidor con fakes en memoria (`test/helpers.ts`; hay una copia de referencia del de buzon en `test/helpers.buzon-ref.ts.txt`): `MemoryCollection` que respeta índices y el límite de 100, un `ctx.content` falso con revisiones, y `ctx.kv`.

## 8. Panel: `src/admin.tsx` y `src/admin/**`

```ts
export const pages: PluginAdminExports["pages"] = { "/": InicioPage, "/articulo": ArticuloPage, "/guias": GuiasPage, "/ajustes": AjustesPage };
```

- `GuiasPage` muestra la guía `aprendido` (marcada «Se actualiza sola», `?guia=aprendido` la abre) con `GuiaAprendida.tsx`: de solo lectura, criterios por tema con fecha y «Visto en» (enlaces a los artículos), «Retirar» con confirmación, «Actualizar ahora» (sondea el estado cada 4 s mientras la IA trabaja; sin clave, explica cómo hacerlo con Claude Code) e «Historial de la guía» con «Restaurar».
- `AjustesPage`, sección «Aprendizaje»: automático, hora diaria (UTC), incluir administradores y nombre de la guía. `Compositor`: casilla «Esto vale para todos los artículos».

- Llamadas con `apiFetch` y `parseApiResponse` de `emdash/plugin-utils` (como en emdash-buzon). Base `/_emdash/api/plugins/emdash-revision`. Navegación: `/_emdash/admin/plugins/emdash-revision/articulo?collection=posts&id=…` (ver cómo buzon lee parámetros y navega).
- Sin dependencias nuevas: React 19, CSS propio con prefijo `rv-` inyectado una vez (patrón `emdash-buzon/src/admin/styles.ts`), consumiendo las variables del admin `--color-kumo-*` y `--text-color-kumo-*` con valores de reserva. Iconos SVG en línea. Diálogos con `<dialog>` nativo.
- Textos en `src/admin/textos.ts`. Diseño, composición, textos y accesibilidad: plan, sección «Diseño de UX».
- El panel importa de `../lib/{types,bloques,anclas,diff}.js` (puras) lo que necesite para pintar, anclar selecciones y mostrar cambios.
