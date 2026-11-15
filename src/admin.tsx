/**
 * Entrada del admin: páginas que EmDash monta en el panel.
 */

import type { PluginAdminExports } from "emdash";

import { AjustesPage } from "./admin/AjustesPage.js";
import { ArticuloPage } from "./admin/ArticuloPage.js";
import { GuiasPage } from "./admin/GuiasPage.js";
import { InicioPage } from "./admin/InicioPage.js";

export const pages: PluginAdminExports["pages"] = {
	"/": InicioPage,
	"/articulo": ArticuloPage,
	"/guias": GuiasPage,
	"/ajustes": AjustesPage,
};
