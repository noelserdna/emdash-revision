# emdash-revision

Revisión editorial para [EmDash CMS](https://emdashcms.com): la revisora lee el artículo tal como saldrá en la web, comenta párrafos o frases, una IA aplica las correcciones como si fuera la redactora y ella revisa los cambios antes de aprobar y publicar.

Nació para una web de divulgación médica, en la que una doctora revisa y firma cada artículo y quien coordina la web usa agentes de IA para redactar y corregir. Hasta entonces la revisión iba por correo y las indicaciones se aplicaban a mano. El plugin no tiene nada de esa web: sirve para cualquier sitio EmDash en el que alguien revise textos antes de publicarlos.

## Qué hace

- **Un listado de todo lo que hay que revisar**, en cualquier estado de publicación (borrador, programado o publicado), ordenado por lo que le toca a cada persona: cambios que la esperan, artículos por revisar, artículos en corrección y aprobados. Arriba, «Te quedan N» y un botón para seguir donde lo dejó.
- **Una vista de lectura** con la tipografía de la web, en la que cada párrafo, título, celda de tabla, imagen (pie y texto alternativo) y referencia se puede comentar. En el ordenador se puede afinar seleccionando una frase; en el móvil, un toque marca el párrafo y abre una hoja inferior.
- **«Cambiarlo ya»**: si la revisora escribe el texto exacto que quiere, puede aplicarlo ella misma sin pasar por la IA. Queda registrado y se puede deshacer.
- **Corrección con IA** a partir de los comentarios, por párrafos: la IA solo toca lo que se ha comentado y el resto del artículo queda idéntico. Para comentarios globales («acórtalo») hay una reescritura completa, que se pide expresamente.
- **Segunda revisión**: cada cambio aparece en su sitio, con lo antiguo tachado y lo nuevo subrayado, y tres botones: «Está bien», «Deshacer» y «No es esto». Los cambios que tocan cifras, dosis, unidades, fármacos, negaciones o cuantificadores, y los que nadie pidió, exigen confirmación viendo el antes y el después.
- **Preguntas para la revisora**: dudas que afectan a uno o varios artículos («¿la cifra de X incluye Y?»), que se responden desde el inicio sin abrir el artículo. Las respuestas se guardan como reglas que la IA respeta en las siguientes correcciones.
- **Aprobar y publicar**. La aprobación queda ligada a la versión exacta del texto: si cambia después, se indica. «Aprobar» solo se ofrece al terminar de leer; un bloque cuenta como leído si ha estado a la vista al menos un segundo. Publicar una versión sin aprobar muestra un aviso, o se impide si se activa la opción correspondiente.
- **Registro de auditoría** de quién comentó, corrigió, aprobó y publicó cada versión.

## Dos formas de corregir con IA

**Con la API de Anthropic (desde el panel).** Un administrador pulsa «Corregir con IA» y elige el modelo (Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 o Fable 5.2) y el esfuerzo. La corrección se hace en segundo plano con el cron del plugin, así que se puede cerrar la página. El gasto se registra y hay un tope mensual. Hace falta el secreto `ANTHROPIC_API_KEY` en el Worker:

```sh
wrangler secret put ANTHROPIC_API_KEY
```

Coste orientativo por artículo de unas 2.500 palabras, corrigiendo por párrafos: unos céntimos con Sonnet u Opus, y menos de un céntimo con Haiku.

**Con Claude Code (tu suscripción).** «He terminado» deja el artículo en una cola. El plugin expone cuatro herramientas MCP (`revision_cola`, `revision_reclamar`, `revision_articulo`, `revision_entregar`), y la skill [`skills/aplicar-revision`](skills/aplicar-revision/SKILL.md) enseña a Claude Code a recoger la cola, corregir como redactora y entregar. Se conecta así:

```sh
claude mcp add --transport http mi-sitio https://mi-sitio.es/_emdash/api/mcp \
  --header "Authorization: Bearer <token personal con el scope mcp:tools:emdash-revision>"
```

Después, en Claude Code, `/aplicar-revision`. Para dejarlo automático, una tarea programada de Claude Code Desktop.

Cada instalación usa su propio Claude Code con la suscripción de quien lo ejecuta: el plugin nunca ve ni guarda esas credenciales. Con cualquiera de los dos motores, ninguna herramienta de IA puede aprobar ni publicar.

## Instalación

Es un plugin *native* de EmDash (≥ 1.4), con panel en React.

```sh
pnpm add emdash-revision   # o: pnpm add github:noelserdna/emdash-revision
```

```js
// astro.config.mjs
import { revisionPlugin } from "emdash-revision";

emdash({
	plugins: [
		revisionPlugin({
			etiqueta: "Revisión",
			collections: {
				posts: {
					// Campos por defecto: title, excerpt, content, references, featured_image.
					campoRevisado: "reviewed_at", // fecha que se rellena al aprobar (opcional)
					urlPublica: "/blog/",
				},
			},
			lectura: {
				cuerpo: '"Source Sans 3", system-ui, sans-serif',
				titulos: "Fraunces, Georgia, serif",
				css: "https://fonts.googleapis.com/css2?family=Fraunces:wght@500&family=Source+Sans+3:wght@400;600&display=swap",
			},
		}),
	],
});
```

Si el plugin se enlaza desde una carpeta local (`link:`), añádelo a `vite.ssr.noExternal`.

**Requisito:** la colección revisada debe tener activadas las revisiones (`supports: ["revisions"]`). Así las correcciones se guardan como borrador y lo publicado no cambia hasta que alguien publica.

## Permisos

- **Editora:** puede leer, comentar, responder preguntas, revisar cambios, aprobar (si el rol configurado lo permite), publicar y pulsar «He terminado». Son las rutas con `plugins:read`.
- **Administrador:** además, guías de redacción, ajustes, corregir con la API eligiendo modelo y las herramientas MCP. Son las rutas con `plugins:manage`.

## Desarrollo

```sh
pnpm install
pnpm test        # vitest: librerías, motor IA, servidor y panel
pnpm typecheck
pnpm build       # tsdown → dist/
```

- `src/lib/`: librerías puras (Portable Text ↔ Markdown por bloque, anclas de comentarios que sobreviven a ediciones, operaciones de corrección, diff por palabras, detección de cambios sensibles). También se publican como `emdash-revision/lib` para usarlas desde scripts.
- `src/plugin.ts`: rutas, hooks (`content:afterSave` re-ancla comentarios y detecta ediciones externas; `content:afterDelete`; `cron` para el motor por API) y herramientas MCP.
- `src/admin/`: panel React con CSS propio (prefijo `rv-`) que usa las variables de color del admin de EmDash. Funciona en claro y oscuro, en escritorio y móvil, y se ha diseñado según WCAG 2.2 AA.
- `docs/CONTRATO.md`: contrato interno entre módulos (tipos, rutas y reglas de negocio).

## Licencia

Apache-2.0.
