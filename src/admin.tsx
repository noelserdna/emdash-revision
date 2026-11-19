/**
 * Entrada del admin: páginas que EmDash monta en el panel.
 */

import type { PluginAdminExports } from "emdash";

import { AjustesPage } from "./admin/AjustesPage.js";
import { ArticuloPage } from "./admin/ArticuloPage.js";
import { GuiasPage } from "./admin/GuiasPage.js";
import { InicioPage } from "./admin/InicioPage.js";
import { PanelEditor } from "./admin/PanelEditor.js";

export const pages: PluginAdminExports["pages"] = {
	"/": InicioPage,
	"/articulo": ArticuloPage,
	"/guias": GuiasPage,
	"/ajustes": AjustesPage,
};

/**
 * Panel en la barra lateral del editor de artículos de EmDash (todas las
 * colecciones; el servidor rechaza las que no están en revisión).
 */
export const contentEditorPanels = [
	{ id: "revision-ia", title: "Revisión médica", component: PanelEditor, order: 0 },
];
