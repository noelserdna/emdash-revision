/**
 * Estilos del panel, inyectados una sola vez. Prefijo `rv-` (el admin ya usa
 * `emdash-revision-`). Consumen las variables de Kumo del admin con valores de
 * reserva, y `light-dark()` sigue el conmutador del admin (`data-mode` fija
 * `color-scheme`). Medidas en rem; cortes por ancho del contenedor.
 */

import * as React from "react";

const CSS = String.raw`
.rv-root{
  --rv-bg: var(--color-kumo-base, light-dark(#ffffff,#1b1b1d));
  --rv-surface: var(--color-kumo-elevated, light-dark(#f6f6f7,#232326));
  --rv-recessed: var(--color-kumo-recessed, light-dark(#f0f0f2,#18181a));
  --rv-text: var(--text-color-kumo-default, light-dark(#1c1c1f,#f2f2f3));
  --rv-strong: var(--text-color-kumo-strong, light-dark(#0b0b0c,#ffffff));
  --rv-muted: var(--text-color-kumo-subtle, light-dark(#56565e,#b1b1b8));
  --rv-line: var(--color-kumo-line, light-dark(#dcdce0,#3a3a40));
  --rv-hairline: var(--color-kumo-hairline, light-dark(#ececef,#2c2c31));
  --rv-brand: var(--color-kumo-brand, light-dark(#2357d9,#4d7ff0));
  --rv-brand-hover: var(--color-kumo-brand-hover, light-dark(#1b47b8,#3a6de0));
  --rv-on-brand: #ffffff;
  --rv-link: var(--text-color-kumo-link, light-dark(#1f4fc7,#8db0ff));
  --rv-focus: var(--color-kumo-focus, light-dark(#2357d9,#8db0ff));
  --rv-danger: var(--text-color-kumo-danger, light-dark(#b42318,#ff8a80));
  --rv-ok: var(--text-color-kumo-success, light-dark(#17703a,#6fd99a));
  --rv-ok-bg: var(--color-kumo-success-tint, light-dark(#e8f6ee,#13321f));
  --rv-info-bg: var(--color-kumo-info-tint, light-dark(#eaf0fd,#172645));
  --rv-warn: var(--text-color-kumo-warning, light-dark(#8a4b00,#ffc66b));
  --rv-warn-bg: var(--color-kumo-warning-tint, light-dark(#fff5e0,#3a2a0c));
  --rv-amber-bg: light-dark(#ffe08a,#6b4c00);
  --rv-amber-line: light-dark(#a15c00,#ffcc4d);
  --rv-marca: light-dark(#7a5af5,#b39dff);
  --rv-ins-bg: light-dark(#ddf4e4,#123b22);
  --rv-ins-text: light-dark(#0f5a2a,#a8f0c0);
  --rv-del-bg: light-dark(#fde4e1,#4a1712);
  --rv-del-text: light-dark(#8f1d12,#ffb4ab);
  --rv-atenuado: light-dark(#5a5a62,#a8a8b0);
  --rv-radio: 0.625rem;
  --rv-barra-alto: 4.5rem;
  --rv-fuente-cuerpo: inherit;
  --rv-fuente-titulos: var(--rv-fuente-cuerpo);
  color: var(--rv-text);
  font-size: 0.9375rem;
  line-height: 1.5;
}
.rv-root *, .rv-root *::before, .rv-root *::after{ box-sizing: border-box; }
.rv-root button, .rv-root input, .rv-root textarea, .rv-root select{ font: inherit; color: inherit; }
.rv-root input, .rv-root textarea, .rv-root select{ font-size: 1rem; }
.rv-root button{ cursor: pointer; }
.rv-root a:not(.rv-btn){ color: var(--rv-link); }
.rv-root :focus-visible{ outline: 2px solid var(--rv-focus); outline-offset: 2px; }
.rv-root [hidden]{ display: none !important; }
.rv-sr{ position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

/* Enlaces de salto */
.rv-saltos{ position: relative; height: 0; }
.rv-saltos a{ position: absolute; left: 0.5rem; top: 0.5rem; z-index: 50; padding: 0.625rem 0.875rem; background: var(--rv-bg); color: var(--rv-link); border: 2px solid var(--rv-focus); border-radius: var(--rv-radio); transform: translateY(-200%); }
.rv-saltos a:focus{ transform: none; }

/* Botones */
.rv-btn{ display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; min-width: 2.75rem; padding: 0.5rem 1rem; border-radius: var(--rv-radio); border: 1px solid var(--rv-line); background: var(--rv-bg); color: var(--rv-text); text-decoration: none; font-weight: 500; transition: background-color 150ms, border-color 150ms; }
.rv-btn:hover{ background: var(--rv-surface); }
.rv-btn--principal{ background: var(--rv-brand); border-color: var(--rv-brand); color: var(--rv-on-brand); font-weight: 600; }
.rv-btn--principal:hover{ background: var(--rv-brand-hover); }
.rv-btn--peligro{ color: var(--rv-danger); }
.rv-btn--plano{ border-color: transparent; background: transparent; }
.rv-btn--plano:hover{ background: var(--rv-surface); }
.rv-btn--peque{ min-height: 2.25rem; padding: 0.25rem 0.75rem; font-size: 0.875rem; }
.rv-btn:disabled, .rv-btn[aria-disabled="true"]{ opacity: 0.6; cursor: default; }
.rv-btn svg{ flex: none; }
.rv-acciones{ display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }

/* Campos */
.rv-campo{ display: grid; gap: 0.375rem; }
.rv-campo > label, .rv-campo > .rv-etq{ font-weight: 600; font-size: 0.9375rem; }
.rv-campo small, .rv-ayuda{ color: var(--rv-muted); font-size: 0.875rem; }
.rv-input{ width: 100%; min-height: 2.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--rv-line); border-radius: 0.5rem; background: var(--rv-bg); }
textarea.rv-input{ min-height: 6rem; resize: vertical; line-height: 1.5; }
.rv-input[aria-invalid="true"]{ border-color: var(--rv-danger); border-width: 2px; }
.rv-error{ color: var(--rv-danger); font-size: 0.875rem; display: flex; gap: 0.375rem; align-items: flex-start; }
.rv-check{ display: flex; gap: 0.625rem; align-items: flex-start; min-height: 2.75rem; padding-top: 0.5rem; }
.rv-check input{ width: 1.25rem; height: 1.25rem; margin-top: 0.125rem; flex: none; }
.rv-mono{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875rem; }

/* Avisos */
.rv-aviso{ display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.75rem 1rem; border-radius: var(--rv-radio); border: 1px solid var(--rv-line); background: var(--rv-surface); }
.rv-aviso--info{ background: var(--rv-info-bg); }
.rv-aviso--ok{ background: var(--rv-ok-bg); }
.rv-aviso--aviso{ background: var(--rv-warn-bg); border-color: var(--rv-amber-line); border-width: 2px; }
.rv-aviso--error{ border-color: var(--rv-danger); border-width: 2px; }
.rv-aviso > svg{ margin-top: 0.125rem; flex: none; }
.rv-aviso__cuerpo{ display: grid; gap: 0.5rem; flex: 1; min-width: 0; }
.rv-aviso p{ margin: 0; }

/* Etiquetas */
.rv-etiqueta{ display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.125rem 0.625rem; border-radius: 999px; border: 1px solid var(--rv-line); font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.rv-etiqueta--info{ background: var(--rv-info-bg); }
.rv-etiqueta--aviso{ background: var(--rv-warn-bg); color: var(--rv-warn); border-color: var(--rv-amber-line); }
.rv-etiqueta--ok{ background: var(--rv-ok-bg); color: var(--rv-ok); }
.rv-etiqueta--pub{ background: transparent; color: var(--rv-muted); }

/* Página */
.rv-pagina{ display: grid; gap: 1.5rem; padding-bottom: 2rem; max-width: 72rem; }
.rv-pagina h1{ margin: 0; font-size: 1.625rem; line-height: 1.25; }
.rv-pagina h2{ margin: 0; font-size: 1.1875rem; }
.rv-tarjeta{ border: 1px solid var(--rv-line); border-radius: var(--rv-radio); padding: 1rem 1.125rem; background: var(--rv-bg); display: grid; gap: 0.875rem; }
.rv-cabecera{ display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }

/* Inicio */
.rv-inicio{ container: rv-ini / inline-size; }
.rv-resumen{ display: grid; gap: 0.75rem; }
.rv-resumen p{ margin: 0; font-size: 1.0625rem; }
.rv-progreso{ display: grid; gap: 0.375rem; max-width: 28rem; }
.rv-progreso progress{ width: 100%; height: 0.75rem; accent-color: var(--rv-brand); }
.rv-grupo{ display: grid; gap: 0.5rem; }
.rv-grupo--atenuado .rv-fila__titulo{ color: var(--rv-muted); }
.rv-grupo summary{ cursor: pointer; min-height: 2.75rem; display: flex; align-items: center; gap: 0.5rem; }
.rv-grupo h2, .rv-grupo summary h2{ display: inline; }
.rv-lista{ list-style: none; margin: 0; padding: 0; border: 1px solid var(--rv-line); border-radius: var(--rv-radio); background: var(--rv-bg); }
.rv-fila{ display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 0.25rem 1rem; align-items: center; padding: 0.75rem 1rem; border-top: 1px solid var(--rv-hairline); }
.rv-fila:first-child{ border-top: 0; }
.rv-fila__titulo{ font-weight: 600; color: var(--rv-text); text-decoration: none; display: inline-block; padding: 0.375rem 0; }
.rv-fila__titulo:hover{ text-decoration: underline; }
.rv-fila__meta{ display: flex; flex-wrap: wrap; gap: 0.25rem 0.875rem; color: var(--rv-muted); font-size: 0.8125rem; grid-column: 1 / -1; }
.rv-fila__etiquetas{ display: flex; flex-wrap: wrap; gap: 0.375rem; justify-content: flex-end; }
.rv-fila__admin{ display: flex; flex-wrap: wrap; gap: 0.25rem 0.875rem; font-size: 0.8125rem; grid-column: 1 / -1; color: var(--rv-text); }
@container rv-ini (max-width: 56.24em){
  .rv-fila{ grid-template-columns: 1fr; }
  .rv-fila__etiquetas{ justify-content: flex-start; }
}

.rv-preguntas{ list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.rv-pregunta{ border: 1px solid var(--rv-line); border-left: 4px solid var(--rv-marca); border-radius: var(--rv-radio); padding: 1rem; display: grid; gap: 0.75rem; background: var(--rv-bg); }
.rv-pregunta p{ margin: 0; }
.rv-pregunta__texto{ font-weight: 600; font-size: 1.0625rem; }
.rv-pregunta ul{ margin: 0; padding-left: 1.25rem; display: grid; gap: 0.25rem; }
.rv-cita{ margin: 0; padding: 0.25rem 0 0.25rem 0.75rem; border-left: 3px solid var(--rv-line); color: var(--rv-muted); font-style: italic; overflow-wrap: anywhere; }

/* Vista de revisión */
.rv-articulo{ container: rv-art / inline-size; position: relative; }
.rv-composicion{ display: grid; grid-template-columns: minmax(0,1fr); gap: 1.5rem; align-items: start; }
@container rv-art (min-width: 56.25em){
  .rv-composicion{ grid-template-columns: minmax(0,1fr) 21.25rem; }
  .rv-panel{ position: sticky; top: 1rem; max-height: calc(100vh - 2rem - var(--rv-barra-alto)); overflow: auto; }
}
.rv-franja{ position: sticky; top: 0; z-index: 20; margin-bottom: 1rem; }

.rv-paper{ background: var(--rv-bg); border: 1px solid var(--rv-hairline); border-radius: var(--rv-radio); padding: 2rem 2.75rem 2.5rem 3.5rem; font-family: var(--rv-fuente-cuerpo); font-size: 1.125rem; line-height: 1.75; color: var(--rv-text); position: relative; }
.rv-paper__col{ max-width: 43.75rem; margin: 0 auto; }
@container rv-art (max-width: 37.5em){
  .rv-paper{ font-size: 1.0625rem; padding: 1.25rem 1rem 1.5rem 1.75rem; border-radius: 0; border-left: 0; border-right: 0; }
}
.rv-paper h1, .rv-paper h2, .rv-paper h3, .rv-paper h4, .rv-paper h5, .rv-paper h6{ font-family: var(--rv-fuente-titulos); line-height: 1.3; color: var(--rv-strong); }
.rv-paper h1{ font-size: 2em; margin: 0 0 0.5em; }
.rv-paper h2{ font-size: 1.5em; margin: 1.75em 0 0.5em; }
.rv-paper h3{ font-size: 1.25em; margin: 1.5em 0 0.5em; }
.rv-paper h4, .rv-paper h5, .rv-paper h6{ font-size: 1.05em; margin: 1.25em 0 0.5em; }
.rv-paper p{ margin: 0 0 1em; }
.rv-paper ul, .rv-paper ol{ margin: 0 0 1em; padding-left: 1.5em; }
.rv-paper li{ margin: 0 0 0.35em; }
.rv-paper blockquote{ margin: 0 0 1em; padding: 0.25em 0 0.25em 1em; border-left: 4px solid var(--rv-line); }
.rv-paper code{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: var(--rv-recessed); padding: 0.05em 0.3em; border-radius: 0.25em; }
.rv-paper .rv-extracto{ font-size: 1.125em; color: var(--rv-muted); }
.rv-paper .rv-etq-campo{ display: block; font-family: var(--rv-fuente-cuerpo); font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--rv-muted); margin-bottom: 0.25rem; }
.rv-portada{ margin: 0 0 1.5em; }
.rv-portada img, .rv-figura img{ max-width: 100%; height: auto; border-radius: 0.375rem; display: block; }
.rv-figura{ margin: 0 0 1.25em; }
.rv-figura__textos{ display: grid; gap: 0.25rem; margin-top: 0.5rem; font-size: 0.9em; color: var(--rv-muted); }
.rv-figura__textos > *{ margin: 0; }
.rv-tabla{ overflow-x: auto; margin: 0 0 1.25em; border: 1px solid var(--rv-line); border-radius: 0.375rem; position: relative; }
.rv-tabla table{ border-collapse: collapse; width: 100%; font-size: 0.9em; line-height: 1.5; }
.rv-tabla th, .rv-tabla td{ border: 1px solid var(--rv-hairline); padding: 0.5em 0.75em; text-align: left; vertical-align: top; min-width: 8rem; }
.rv-tabla th{ background: var(--rv-surface); }
.rv-desconocido{ padding: 0.75rem 1rem; background: var(--rv-recessed); border: 1px dashed var(--rv-line); border-radius: 0.375rem; color: var(--rv-muted); font-size: 0.9em; margin: 0 0 1em; }
.rv-referencias{ margin-top: 2.5em; padding-top: 1em; border-top: 1px solid var(--rv-line); font-size: 0.9em; }
.rv-referencias ol{ padding-left: 2em; }
.rv-referencias li{ overflow-wrap: anywhere; }
.rv-fin{ margin-top: 2em; text-align: center; color: var(--rv-muted); font-size: 0.875rem; }

/* Unidades comentables */
.rv-u{ position: relative; scroll-margin-top: 5rem; scroll-margin-bottom: calc(var(--rv-barra-alto) + 1rem); }
.rv-u--comentada::before, .rv-u--activa::before{ content: ""; position: absolute; left: -0.75rem; top: 0.15em; bottom: 0.15em; width: 3px; border-radius: 2px; background: var(--rv-marca); }
.rv-u--activa::before{ background: var(--rv-amber-line); }
td.rv-u--comentada::before, th.rv-u--comentada::before, td.rv-u--activa::before, th.rv-u--activa::before{ left: 0; top: 0; bottom: 0; border-radius: 0; }
.rv-u--marcada{ background: var(--rv-surface); border-radius: 0.25rem; }
.rv-u--activa.rv-u--entera{ background: var(--rv-amber-bg); border-radius: 0.25rem; }
.rv-margen{ position: absolute; left: -3rem; top: 0; display: flex; flex-direction: column; gap: 0.25rem; align-items: center; font-family: system-ui, sans-serif; font-size: 0.8125rem; line-height: 1; }
td > .rv-margen, th > .rv-margen, .rv-figura__textos .rv-margen{ position: static; flex-direction: row; display: inline-flex; margin-left: 0.375rem; vertical-align: middle; }
.rv-comentar{ width: 2.75rem; height: 2.75rem; border-radius: 999px; border: 1px solid var(--rv-line); background: var(--rv-bg); color: var(--rv-muted); display: inline-grid; place-items: center; opacity: 0; transition: opacity 150ms, background-color 150ms; }
.rv-comentar:hover{ background: var(--rv-surface); color: var(--rv-text); }
.rv-comentar:focus-visible, .rv-u--marcada > .rv-margen .rv-comentar, .rv-u--marcada > * > .rv-margen .rv-comentar{ opacity: 1; }
@media (hover: hover){
  .rv-u:hover > .rv-margen .rv-comentar, .rv-u:hover > * > .rv-margen .rv-comentar{ opacity: 1; }
}
@media (hover: none){
  .rv-comentar{ width: 2.75rem; height: 2.75rem; }
}
.rv-contador{ min-width: 1.5rem; min-height: 1.5rem; padding: 0.125rem 0.4rem; border-radius: 999px; border: 0; background: var(--rv-marca); color: #fff; font-weight: 700; font-size: 0.75rem; display: inline-flex; gap: 0.125rem; align-items: center; justify-content: center; }
.rv-contador[aria-pressed="true"]{ background: var(--rv-amber-line); color: light-dark(#fff,#1b1b1d); }
.rv-frag{ text-decoration: underline dotted var(--rv-marca); text-decoration-thickness: 0.15em; text-underline-offset: 0.2em; }
.rv-frag--activo{ background: var(--rv-amber-bg); text-decoration-color: var(--rv-amber-line); border-radius: 0.125rem; }
.rv-enlace{ color: var(--rv-link); text-decoration: underline; text-underline-offset: 0.15em; }
.rv-abrir-enlace{ display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem; vertical-align: middle; margin-left: 0.125rem; border-radius: 0.25rem; color: var(--rv-link); }
.rv-pildora{ position: absolute; z-index: 30; transform: translate(-50%, calc(-100% - 0.5rem)); box-shadow: 0 6px 20px rgba(0,0,0,.2); }

/* Segunda revisión */
.rv-atenuar .rv-paper__col > .rv-u:not(.rv-cambio), .rv-atenuar .rv-paper__col > ul > .rv-u, .rv-atenuar .rv-paper__col > ol > .rv-u{ color: var(--rv-atenuado); }
.rv-nota-cambios{ margin: 0 0 1.25rem; font-family: system-ui, sans-serif; font-size: 0.9375rem; }
.rv-cambio{ border: 2px solid var(--rv-line); border-radius: var(--rv-radio); padding: 0.875rem 1rem 1rem; margin: 0 -1rem 1.25em; background: var(--rv-bg); color: var(--rv-text); scroll-margin-bottom: calc(var(--rv-barra-alto) + 1rem); scroll-margin-top: 4rem; }
.rv-cambio--pendiente{ border-color: var(--rv-brand); }
.rv-cambio--aviso{ border-color: var(--rv-amber-line); }
.rv-cambio__cab{ display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: baseline; font-family: system-ui, sans-serif; font-size: 0.875rem; margin-bottom: 0.5rem; }
.rv-cambio__cab h3{ font-family: inherit; font-size: 0.9375rem; margin: 0; color: var(--rv-text); }
.rv-cambio__cab h3:focus{ outline: 2px solid var(--rv-focus); outline-offset: 2px; }
.rv-cambio__texto{ margin: 0 0 0.75rem; }
.rv-cambio__pie{ font-family: system-ui, sans-serif; font-size: 0.9375rem; display: grid; gap: 0.625rem; }
.rv-cambio del{ background: var(--rv-del-bg); color: var(--rv-del-text); text-decoration: line-through; text-decoration-thickness: 0.1em; }
.rv-cambio ins{ background: var(--rv-ins-bg); color: var(--rv-ins-text); text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.18em; }
.rv-cambio details summary{ cursor: pointer; min-height: 2.75rem; display: inline-flex; align-items: center; color: var(--rv-link); }
.rv-cambio__original{ padding: 0.5rem 0.75rem; background: var(--rv-recessed); border-radius: 0.375rem; margin-top: 0.25rem; }
.rv-veredicto{ font-weight: 600; display: inline-flex; gap: 0.375rem; align-items: center; }
.rv-antesdespues{ display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.rv-antesdespues > div{ padding: 0.75rem; border: 1px solid var(--rv-line); border-radius: 0.5rem; }
.rv-antesdespues h3{ margin: 0 0 0.375rem; font-size: 0.875rem; color: var(--rv-muted); }

/* Panel de comentarios */
.rv-panel{ display: grid; gap: 1rem; align-content: start; }
.rv-panel h2{ margin: 0; font-size: 1.0625rem; }
.rv-comentarios{ list-style: none; margin: 0; padding: 0; display: grid; gap: 0.625rem; }
.rv-comentario{ border: 1px solid var(--rv-line); border-radius: var(--rv-radio); padding: 0.75rem; display: grid; gap: 0.5rem; background: var(--rv-bg); }
.rv-comentario--activo{ border-color: var(--rv-amber-line); border-width: 2px; background: var(--rv-warn-bg); }
.rv-comentario p{ margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.rv-comentario__meta{ color: var(--rv-muted); font-size: 0.8125rem; display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: center; }
.rv-comentario__ir{ text-align: left; background: none; border: 0; padding: 0; color: inherit; }
.rv-respuestas{ list-style: none; margin: 0; padding: 0 0 0 0.75rem; border-left: 2px solid var(--rv-line); display: grid; gap: 0.375rem; }
.rv-compositor{ border: 2px solid var(--rv-brand); border-radius: var(--rv-radio); padding: 1rem; display: grid; gap: 0.875rem; background: var(--rv-bg); }
.rv-compositor h2, .rv-compositor h3{ margin: 0; font-size: 1rem; }
/* Dentro de la hoja, la hoja ya pone el título: el del formulario queda solo para el lector de pantalla. */
.rv-hoja .rv-compositor{ border: 0; padding: 0; }
.rv-hoja .rv-compositor > h2, .rv-hoja .rv-compositor > h3{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Barra de acciones */
.rv-barra{ position: sticky; bottom: 0; z-index: 25; margin-top: 1.5rem; padding: 0.75rem 1rem; background: color-mix(in srgb, var(--rv-bg) 94%, transparent); border: 1px solid var(--rv-line); border-radius: var(--rv-radio) var(--rv-radio) 0 0; box-shadow: 0 -4px 18px rgba(0,0,0,.08); display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; justify-content: space-between; transition: transform 250ms; }
.rv-barra--oculta{ transform: translateY(110%); }
.rv-barra__info{ color: var(--rv-muted); font-size: 0.875rem; min-width: 0; }
.rv-barra__botones{ display: flex; gap: 0.5rem; align-items: center; margin-left: auto; position: relative; }
.rv-mas{ position: relative; display: inline-flex; }
.rv-menu{ position: absolute; left: 0; bottom: calc(100% + 0.5rem); min-width: 16rem; display: grid; gap: 0.125rem; padding: 0.375rem; background: var(--rv-bg); border: 1px solid var(--rv-line); border-radius: var(--rv-radio); box-shadow: 0 10px 30px rgba(0,0,0,.18); list-style: none; margin: 0; }
.rv-menu .rv-btn{ width: 100%; justify-content: flex-start; border-color: transparent; }
@media (max-height: 30em){
  .rv-barra{ position: static; }
}

/* Diálogos y hoja inferior */
.rv-dialogo{ margin: auto; position: fixed; inset: 0; height: fit-content; border: 1px solid var(--rv-line); border-radius: 0.875rem; padding: 0; width: min(34rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); background: var(--rv-bg); color: var(--rv-text); box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.rv-dialogo::backdrop{ background: rgba(0,0,0,.45); }
.rv-dialogo__cuerpo{ padding: 1.25rem; display: grid; gap: 1rem; }
.rv-dialogo h2{ margin: 0; font-size: 1.1875rem; }
.rv-dialogo p{ margin: 0; }
.rv-dialogo--ancho{ width: min(48rem, calc(100vw - 2rem)); overflow: auto; }
.rv-historial{ display: grid; gap: 1.25rem; }
.rv-historial__cab{ display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-start; justify-content: space-between; }
.rv-historial__cab p{ flex: 1 1 16rem; }
.rv-historial__seccion{ display: grid; gap: 0.5rem; }
.rv-historial__seccion h3{ margin: 0; font-size: 1.0625rem; }
.rv-historial__lista, .rv-version__bloques{ list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.rv-version{ border: 1px solid var(--rv-line); border-radius: var(--rv-radio); padding: 0.875rem 1rem; display: grid; gap: 0.375rem; background: var(--rv-bg); min-width: 0; }
.rv-version__meta{ color: var(--rv-muted); font-size: 0.9375rem; }
.rv-version__dif{ border-top: 1px solid var(--rv-hairline); margin-top: 0.5rem; padding-top: 0.75rem; display: grid; gap: 0.75rem; }
.rv-version__bloques li{ display: grid; gap: 0.25rem; padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: var(--rv-surface); }
.rv-version__etiqueta{ font-size: 0.8125rem; font-weight: 600; color: var(--rv-muted); }
.rv-version__texto{ white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
.rv-version__texto del{ background: var(--rv-del-bg); color: var(--rv-del-text); text-decoration: line-through; text-decoration-thickness: 0.1em; }
.rv-version__texto ins{ background: var(--rv-ins-bg); color: var(--rv-ins-text); text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.18em; }
.rv-version .rv-acciones .rv-btn{ flex: 1 1 auto; }
.rv-hoja{ position: fixed; inset: auto 0 0 0; margin: 0; max-width: 100vw; width: 100vw; border: 0; border-radius: 1rem 1rem 0 0; padding: 0; background: var(--rv-bg); color: var(--rv-text); max-height: 60vh; height: 60vh; transition: height 250ms, max-height 250ms; box-shadow: 0 -10px 40px rgba(0,0,0,.3); }
.rv-hoja--completa{ max-height: calc(100vh - 1rem); height: calc(100vh - 1rem); }
.rv-hoja::backdrop{ background: rgba(0,0,0,.35); }
.rv-hoja__cab{ position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.25rem 0.75rem; background: var(--rv-bg); border-bottom: 1px solid var(--rv-hairline); }
.rv-hoja__tirador{ flex: 1; min-height: 2.75rem; display: grid; place-items: center; background: none; border: 0; color: var(--rv-muted); font-size: 0.8125rem; }
.rv-hoja__tirador::before{ content: ""; display: block; width: 2.5rem; height: 0.3rem; border-radius: 999px; background: var(--rv-line); margin-bottom: 0.25rem; }
.rv-hoja__cuerpo{ padding: 1rem; display: grid; gap: 1rem; }

/* Guías y ajustes */
.rv-dos{ display: grid; gap: 1.5rem; grid-template-columns: minmax(0, 1fr); }
.rv-guias{ container: rv-gui / inline-size; }
@container rv-gui (min-width: 50em){ .rv-dos{ grid-template-columns: 16rem minmax(0, 1fr); } }
.rv-guias-lista{ list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
.rv-guias-lista .rv-btn{ width: 100%; justify-content: flex-start; }
.rv-guias-lista .rv-btn[aria-current="true"]{ background: var(--rv-surface); border-color: var(--rv-brand); }
textarea.rv-markdown{ min-height: 28rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9375rem; }
.rv-rejilla{ display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.rv-radios{ display: grid; gap: 0.25rem; border: 0; padding: 0; margin: 0; }
.rv-radios legend{ font-weight: 600; margin-bottom: 0.25rem; padding: 0; }
.rv-copiar{ display: flex; gap: 0.5rem; }
.rv-copiar input{ flex: 1; }

/* Movimiento y colores forzados */
@media (prefers-reduced-motion: reduce){
  .rv-root *, .rv-root *::before, .rv-root *::after{ transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active){
  .rv-btn, .rv-comentar, .rv-contador, .rv-etiqueta{ border: 1px solid ButtonText; }
  .rv-btn--principal{ background: Highlight; color: HighlightText; forced-color-adjust: none; }
  .rv-u--comentada::before, .rv-u--activa::before{ forced-color-adjust: none; background: CanvasText; }
  .rv-u--activa::before{ background: Highlight; }
  .rv-u--activa.rv-u--entera, .rv-frag--activo{ outline: 2px solid Highlight; forced-color-adjust: none; background: Mark; color: MarkText; }
  .rv-frag{ text-decoration-color: CanvasText; }
  .rv-cambio, .rv-comentario--activo, .rv-aviso--aviso, .rv-compositor{ border: 2px solid CanvasText; }
  .rv-cambio del, .rv-cambio ins{ forced-color-adjust: none; background: Canvas; color: CanvasText; }
  .rv-comentar{ opacity: 1; }
  .rv-hoja, .rv-dialogo{ border: 2px solid CanvasText; }
}
`;

let inyectado = false;
const fuentesCargadas = new Set<string>();

export function useEstilos(): void {
	React.useEffect(() => {
		if (inyectado || typeof document === "undefined") return;
		const style = document.createElement("style");
		style.setAttribute("data-rv-estilos", "");
		style.textContent = CSS;
		document.head.appendChild(style);
		inyectado = true;
	}, []);
}

/** Carga una sola vez la hoja de fuentes de lectura configurada (solo https o relativa). */
export function useHojaFuentes(url: string | null | undefined): void {
	React.useEffect(() => {
		if (!url || typeof document === "undefined" || fuentesCargadas.has(url)) return;
		if (!/^https:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return;
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		link.setAttribute("data-rv-fuentes", "");
		document.head.appendChild(link);
		fuentesCargadas.add(url);
	}, [url]);
}
