# Contrato interno de `emdash-revision`

Documento de trabajo para quienes implementan el plugin en paralelo. Los tipos están en `src/lib/types.ts` y el storage en `src/lib/store.ts`: **no se cambian** sin avisar. El diseño de producto y de UX está resumido en el README.

Convenciones: TypeScript estricto (`noUncheckedIndexedAccess`), imports relativos con extensión `.js`, tabuladores, comentarios y nombres en español, ESM. Las librerías de `src/lib/` marcadas como **puras** no importan `emdash`, ni DOM, ni Node: solo Web APIs (`crypto.subtle`, `Intl`).

Reparto de ficheros (cada agente toca solo los suyos):

| Agente | Ficheros |
|---|---|
| Librerías | `src/lib/{bloques,anclas,ops,diff,sensibles,hash}.ts`, `test/{bloques,anclas,ops,diff,sensibles}.test.ts`, `test/fixtures/` |
| Motor IA | `src/lib/{prompt,motor-api,costes}.ts`, `test/{prompt,motor-api}.test.ts` |
| Servidor | `src/plugin.ts`, `src/lib/{acceso,contenido,revisiones,comentarios,trabajos,preguntas,correo,ajustes}.ts`, `test/helpers.ts`, `test/servidor-*.test.ts`, `skills/aplicar-revision/SKILL.md` |
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
| `comentarios/crear` | M | `{collection, id, texto, textoPropuesto?, ancla: Ancla\|null, fragmento?: string, parentId?}` | `{comentario: ComentarioVista, revision: RevisionDoc}` |
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

Herramientas MCP (`mcp.tools`): `revision_cola`, `revision_reclamar`, `revision_articulo`, `revision_entregar` (`destructive: true`), cada una sobre su ruta `mcp/*`.

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

- Llamadas con `apiFetch` y `parseApiResponse` de `emdash/plugin-utils` (como en emdash-buzon). Base `/_emdash/api/plugins/emdash-revision`. Navegación: `/_emdash/admin/plugins/emdash-revision/articulo?collection=posts&id=…` (ver cómo buzon lee parámetros y navega).
- Sin dependencias nuevas: React 19, CSS propio con prefijo `rv-` inyectado una vez (patrón `emdash-buzon/src/admin/styles.ts`), consumiendo las variables del admin `--color-kumo-*` y `--text-color-kumo-*` con valores de reserva. Iconos SVG en línea. Diálogos con `<dialog>` nativo.
- Textos en `src/admin/textos.ts`. Diseño, composición, textos y accesibilidad: plan, sección «Diseño de UX».
- El panel importa de `../lib/{types,bloques,anclas,diff}.js` (puras) lo que necesite para pintar, anclar selecciones y mostrar cambios.
