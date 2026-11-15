import { beforeEach, describe, expect, it } from "vitest";

import { fijarDefectos, guardarAjustes, leerAjustes } from "../src/lib/ajustes.js";
import { compararDocs, guardarVersion } from "../src/lib/versiones.js";
import type { ArticuloVista, DocRevisable, HistorialVista, PTNode, VersionDetalle, VersionDoc } from "../src/lib/types.js";
import {
	ADMIN,
	asPluginCtx,
	EDITORA,
	datosEjemplo,
	makeCtx,
	makeMundo,
	makePlugin,
	type MemoryCollection,
	type Mundo,
} from "./helpers.js";

const { llamar, hook, eventoPublicar, plugin } = makePlugin();
const ART = { collection: "posts", id: "p1" };
const B1 = "La menopausia llega de media a los 51 años en España.";
const B1_NUEVO = "La menopausia llega de media a los 51,4 años en España.";

function textoBloque(doc: DocRevisable, key: string): string {
	const b = doc.content.find((n) => n._key === key) as { children?: Array<{ text: string }> } | undefined;
	return (b?.children ?? []).map((s) => s.text).join("");
}

async function versiones(mundo: Mundo, tipo?: "cambio" | "publicacion"): Promise<VersionDoc[]> {
	const col = mundo.storage.versiones as MemoryCollection<VersionDoc>;
	const items = (await col.query({ limit: 100 })).items.map((i) => i.data);
	return items.filter((v) => !tipo || v.tipo === tipo).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

/** «Cambiarlo ya» de 51 → 51,4 en b1. */
async function cambiarYa(mundo: Mundo) {
	const { comentario } = await llamar(mundo, EDITORA, "comentarios/crear", {
		...ART,
		texto: "Precisa la edad",
		ancla: { campo: "content", blockKey: "b1", inicio: 37, fin: 39, cita: "51" },
		textoPropuesto: "51,4",
	});
	return llamar<ArticuloVista>(mundo, EDITORA, "comentarios/aplicar", { id: comentario.id });
}

async function leerTodo(mundo: Mundo) {
	const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
	await llamar(mundo, EDITORA, "lectura/guardar", {
		...ART,
		bloquesVistos: v.articulo.doc.content.map((b) => b._key),
		posicion: null,
		completada: true,
	});
}

describe("historial de versiones", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es", status: "published" });
		mundo.content.add("posts", "p2", { ...datosEjemplo(), title: "Sofocos" }, { slug: "sofocos" });
	});

	it("declara la capacidad de política de contenido y un beforePublish que no aborta", () => {
		expect(plugin.capabilities).toContain("hooks.content-policy:register");
		const h = plugin.hooks["content:beforePublish"];
		expect(h?.errorPolicy).toBe("continue");
		expect(h?.timeout).toBeLessThanOrEqual(5000);
	});

	it("cada escritura del plugin guarda una copia «antes de» con el texto anterior", async () => {
		const v = await cambiarYa(mundo);
		expect(textoBloque(v.articulo.doc, "b1")).toBe(B1_NUEVO);
		let cs = await versiones(mundo, "cambio");
		expect(cs).toHaveLength(1);
		expect(cs[0]!.motivo).toBe("Antes de «Cambiarlo ya»");
		expect(cs[0]!.nombre).toBe("Isabel");
		expect(textoBloque(cs[0]!.doc, "b1")).toBe(B1);

		// Deshacer el cambio también guarda copia (con el texto ya cambiado)
		const cambio = (await (mundo.storage.cambios as MemoryCollection<unknown>).query({ limit: 10 })).items[0]!;
		await llamar(mundo, EDITORA, "cambios/veredicto", { id: cambio.id, veredicto: "deshecho" });
		cs = await versiones(mundo, "cambio");
		expect(cs).toHaveLength(2);
		expect(cs[1]!.motivo).toBe("Antes de deshacer un cambio");
		expect(textoBloque(cs[1]!.doc, "b1")).toBe(B1_NUEVO);

		// Entrega de la IA
		const { comentario } = await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "Tono", ancla: null });
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		await llamar(mundo, ADMIN, "mcp/entregar", {
			trabajoId: trabajo.id,
			ops: [{ op: "reemplazar", blockKey: "b4", markdown: "Pide cita con tu médica.", comentarioIds: [comentario.id] }],
			resoluciones: [{ comentarioId: comentario.id, accion: "aplicado", nota: "ok" }],
		});
		cs = await versiones(mundo, "cambio");
		expect(cs.at(-1)!.motivo).toBe("Antes de la corrección de la IA (vuelta 1)");
		expect(textoBloque(cs.at(-1)!.doc, "b4")).toBe("Consulta con tu médica si los síntomas te impiden dormir.");
	});

	it("aprobar (campo de fecha) y normalizar claves no guardan copia", async () => {
		await leerTodo(mundo);
		const n0 = mundo.content.updates.length;
		await llamar(mundo, EDITORA, "revision/aprobar", ART);
		expect(mundo.content.updates.length).toBe(n0 + 1);
		expect(await versiones(mundo)).toHaveLength(0);

		// Claves repetidas: anclar un comentario obliga a normalizarlas y guardarlas
		const datos = datosEjemplo();
		const contenido = datos.content as PTNode[];
		contenido[2] = { ...contenido[2]!, _key: "b1" };
		mundo.content.add("posts", "p3", datos);
		const antes = mundo.content.updates.length;
		await llamar(mundo, EDITORA, "comentarios/crear", {
			collection: "posts",
			id: "p3",
			texto: "Ojo",
			ancla: { campo: "content", blockKey: "b4", cita: "Consulta con tu médica si los síntomas te impiden dormir." },
		});
		expect(mundo.content.updates.length).toBe(antes + 1);
		expect(await versiones(mundo)).toHaveLength(0);
	});

	it("rota según el límite de los ajustes y no duplica la misma", async () => {
		const ctx = asPluginCtx(makeCtx(mundo, ADMIN));
		await guardarAjustes(ctx, { copiasCambios: 5 });
		const base = { titulo: "", extracto: "", referencias: "", content: [] as PTNode[] };
		for (let i = 1; i <= 7; i++) {
			await guardarVersion(ctx, { collection: "posts", entryId: "p1", tipo: "cambio", motivo: `m${i}`, doc: { ...base, titulo: `T${i}` } });
		}
		// Otro tipo no cuenta para la rotación
		await guardarVersion(ctx, { collection: "posts", entryId: "p1", tipo: "publicacion", motivo: "p", doc: base });
		const cs = await versiones(mundo, "cambio");
		expect(cs).toHaveLength(5);
		expect(cs.map((v) => v.doc.titulo)).toEqual(["T3", "T4", "T5", "T6", "T7"]);
		expect(await versiones(mundo, "publicacion")).toHaveLength(1);
		// Igual que la más reciente: no se guarda
		const id = await guardarVersion(ctx, { collection: "posts", entryId: "p1", tipo: "cambio", motivo: "x", doc: { ...base, titulo: "T7" } });
		expect(id).toBeNull();
		expect(await versiones(mundo, "cambio")).toHaveLength(5);
		// Bajar el límite: lo que sobra se borra al guardar la siguiente copia
		await guardarAjustes(ctx, { copiasCambios: 2 });
		await guardarVersion(ctx, { collection: "posts", entryId: "p1", tipo: "cambio", motivo: "m8", doc: { ...base, titulo: "T8" } });
		expect((await versiones(mundo, "cambio")).map((v) => v.doc.titulo)).toEqual(["T7", "T8"]);
	});

	it("por defecto guarda 20 copias de cambios y 5 de publicaciones; las opciones del plugin cambian los valores por defecto", async () => {
		const ctx = asPluginCtx(makeCtx(mundo, ADMIN));
		const a = await leerAjustes(ctx);
		expect([a.copiasCambios, a.copiasPublicaciones]).toEqual([20, 5]);
		const base = { titulo: "", extracto: "", referencias: "", content: [] as PTNode[] };
		for (let i = 1; i <= 22; i++) {
			await guardarVersion(ctx, { collection: "posts", entryId: "p1", tipo: "cambio", motivo: `m${i}`, doc: { ...base, titulo: `T${i}` } });
		}
		expect(await versiones(mundo, "cambio")).toHaveLength(20);

		fijarDefectos({ versiones: { cambios: 30, publicaciones: 999 } });
		try {
			const b = await leerAjustes(ctx);
			expect([b.copiasCambios, b.copiasPublicaciones]).toEqual([30, 100]);
			// Lo guardado en ajustes manda sobre las opciones
			await guardarAjustes(ctx, { copiasPublicaciones: 3 });
			expect((await leerAjustes(ctx)).copiasPublicaciones).toBe(3);
		} finally {
			fijarDefectos(undefined);
		}
	});

	it("la ruta de ajustes valida los límites de copias", async () => {
		await expect(llamar(mundo, ADMIN, "ajustes/guardar", { copiasCambios: 0 })).rejects.toThrow();
		await expect(llamar(mundo, ADMIN, "ajustes/guardar", { copiasPublicaciones: 101 })).rejects.toThrow();
		await llamar(mundo, ADMIN, "ajustes/guardar", { copiasCambios: 40, copiasPublicaciones: 8 });
		const l = await llamar<{ limites: unknown }>(mundo, ADMIN, "versiones/listar", ART);
		expect(l.limites).toEqual({ cambios: 40, publicaciones: 8 });
	});

	it("al publicar guarda la versión publicada anterior (no el borrador), rota a 5 y nunca cancela", async () => {
		await cambiarYa(mundo);
		const r = await llamar(mundo, ADMIN, "revision/publicar", { ...ART, confirmar: true });
		expect(r.ok).toBe(true);
		let ps = await versiones(mundo, "publicacion");
		expect(ps).toHaveLength(1);
		expect(textoBloque(ps[0]!.doc, "b1")).toBe(B1);
		expect(ps[0]!.motivo).toMatch(/^Versión publicada hasta el \d+ \S+$/);
		const vivo = mundo.content.fila("posts", "p1")!.live;
		expect(textoBloque({ titulo: "", extracto: "", referencias: "", content: vivo.content as PTNode[] }, "b1")).toBe(B1_NUEVO);

		// Publicar sin cambios no guarda nada
		expect(await eventoPublicar(mundo, "posts", "p1")).toBeUndefined();
		expect(await versiones(mundo, "publicacion")).toHaveLength(1);

		for (let i = 1; i <= 6; i++) {
			mundo.content.editar("posts", "p1", { title: `T${i}` });
			await llamar(mundo, ADMIN, "revision/publicar", { ...ART, confirmar: true });
		}
		ps = await versiones(mundo, "publicacion");
		expect(ps).toHaveLength(5);
		expect(ps.map((v) => v.doc.titulo)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
	});

	it("no guarda copia de publicación si no estaba publicada, y un fallo no cancela", async () => {
		await llamar(mundo, ADMIN, "revision/publicar", { collection: "posts", id: "p2", confirmar: true });
		expect(await versiones(mundo, "publicacion")).toHaveLength(0);

		mundo.content.editar("posts", "p1", { title: "Otro" });
		const original = mundo.content.access.bind(mundo.content);
		mundo.content.access = () => ({
			...original(),
			get: async () => {
				throw new Error("boom");
			},
		});
		expect(await eventoPublicar(mundo, "posts", "p1", { id: ADMIN.id })).toBeUndefined();
		expect(mundo.logs.some((l) => l.startsWith("error [historial]"))).toBe(true);
		expect(await versiones(mundo)).toHaveLength(0);
	});

	it("una edición en el editor nativo guarda la revisión anterior", async () => {
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "General", ancla: null });
		await llamar(mundo, EDITORA, "articulo/get", ART); // fija el último texto visto
		mundo.content.editar("posts", "p1", { title: "Título a mano" });
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false, actor: { id: ADMIN.id } });
		const cs = await versiones(mundo, "cambio");
		expect(cs).toHaveLength(1);
		expect(cs[0]!.motivo).toBe("Antes de una edición en el editor");
		expect(cs[0]!.doc.titulo).toBe("Qué es la menopausia");
		expect(cs[0]!.nombre).toBe("Andrés");
		// Repetir el hook sin cambios no guarda otra
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false });
		expect(await versiones(mundo, "cambio")).toHaveLength(1);
	});

	it("listar y ver: resumen frente al texto actual y diferencias por bloque", async () => {
		await cambiarYa(mundo);
		const h = await llamar<HistorialVista>(mundo, EDITORA, "versiones/listar", ART);
		expect(h.cambios).toHaveLength(1);
		expect(h.publicaciones).toHaveLength(0);
		expect(h.publicada).not.toBeNull();
		expect(h.publicada!.hash).not.toBe(h.actual.hash);
		const v = h.cambios[0]!;
		expect(v).not.toHaveProperty("doc");
		expect(v.igualQueActual).toBe(false);
		expect(v.resumen.bloquesDistintos).toBe(1);
		expect(v.resumen.palabrasDistintas).toBe(1);

		const d = await llamar<VersionDetalle>(mundo, EDITORA, "versiones/ver", { id: v.id });
		expect(textoBloque(d.version.doc, "b1")).toBe(B1);
		expect(d.comparacion).toHaveLength(1);
		const b = d.comparacion[0]!;
		expect(b).toMatchObject({ campo: "content", blockKey: "b1", estado: "cambiado", soloFormato: false });
		expect(b.segmentos.filter((s) => s.tipo === "añadido").map((s) => s.texto).join("")).toBe(",4");
		await expect(llamar(mundo, EDITORA, "versiones/ver", { id: "nope" })).rejects.toThrow(/No se encuentra esa versión/);
		await expect(llamar(mundo, EDITORA, "versiones/listar", { collection: "pages", id: "x" })).rejects.toThrow(/no está en revisión/);
	});

	it("compara alineando por clave: añadidos, eliminados, cambiados y campos", () => {
		const p = (k: string, t: string, style = "normal") =>
			({ _type: "block", _key: k, style, markDefs: [], children: [{ _type: "span", _key: `${k}s`, text: t, marks: [] }] }) as PTNode;
		const version: DocRevisable = { titulo: "A", extracto: "E", referencias: "", content: [p("b1", "uno"), p("b2", "dos"), p("b3", "tres")] };
		const actual: DocRevisable = { titulo: "B", extracto: "E", referencias: "", content: [p("b1", "uno"), p("bx", "nuevo"), p("b3", "tres", "h2")] };
		const c = compararDocs(version, actual);
		expect(c.map((b) => [b.campo, b.blockKey, b.estado])).toEqual([
			["title", null, "cambiado"],
			["content", "bx", "añadido"],
			["content", "b2", "eliminado"],
			["content", "b3", "cambiado"],
		]);
		expect(c[3]!.soloFormato).toBe(true);
		expect(c[2]!.segmentos).toEqual([{ tipo: "eliminado", texto: "dos" }]);
	});

	it("restaurar guarda antes el texto actual, es deshacible, huerfaniza comentarios y marca la aprobación", async () => {
		await cambiarYa(mundo);
		await leerTodo(mundo);
		await llamar(mundo, EDITORA, "revision/aprobar", ART);
		const { comentario } = await llamar(mundo, EDITORA, "comentarios/crear", {
			...ART,
			texto: "¿Seguro?",
			ancla: { campo: "content", blockKey: "b1", inicio: 37, fin: 41, cita: "51,4" },
		});
		const h = await llamar<HistorialVista>(mundo, EDITORA, "versiones/listar", ART);
		const original = h.cambios[0]!;

		const v = await llamar<ArticuloVista>(mundo, EDITORA, "versiones/restaurar", { id: original.id });
		expect(textoBloque(v.articulo.doc, "b1")).toBe(B1);
		expect(v.comentarios.find((c) => c.id === comentario.id)?.huerfano).toBe(true);
		const cs = await versiones(mundo, "cambio");
		expect(cs.at(-1)!.motivo).toBe("Antes de restaurar una versión");
		expect(textoBloque(cs.at(-1)!.doc, "b1")).toBe(B1_NUEVO);
		const audit = (await (mundo.storage.auditoria as MemoryCollection<{ accion: string }>).query({ limit: 100 })).items;
		expect(audit.some((a) => a.data.accion === "restaurar")).toBe(true);

		// Deshacer: restaurar la copia recién creada devuelve el texto previo
		const h2 = await llamar<HistorialVista>(mundo, EDITORA, "versiones/listar", ART);
		const copia = h2.cambios[0]!;
		expect(copia.motivo).toBe("Antes de restaurar una versión");
		const v2 = await llamar<ArticuloVista>(mundo, EDITORA, "versiones/restaurar", { id: copia.id });
		expect(textoBloque(v2.articulo.doc, "b1")).toBe(B1_NUEVO);
		expect(v2.comentarios.find((c) => c.id === comentario.id)?.huerfano).toBe(false);
	});

	it("restaurar con la aprobación vigente cambia el texto y la aprobación queda «cambiado después»", async () => {
		await cambiarYa(mundo);
		await leerTodo(mundo);
		await llamar(mundo, EDITORA, "revision/aprobar", ART);
		const h = await llamar<HistorialVista>(mundo, EDITORA, "versiones/listar", ART);
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "versiones/restaurar", { id: h.cambios[0]!.id });
		expect(v.revision.estado).toBe("aprobado");
		expect(v.revision.aprobacion?.cambiadoDespues).toBe(true);
	});

	it("restaurar y publicar pide confirmación sin tocar nada y después publica", async () => {
		await cambiarYa(mundo);
		const h = await llamar<HistorialVista>(mundo, EDITORA, "versiones/listar", ART);
		const id = h.cambios[0]!.id;
		const n = mundo.content.updates.length;
		const r = await llamar(mundo, EDITORA, "versiones/restaurar", { id, publicar: true });
		expect(r.requiereConfirmacion).toBe(true);
		expect(r.motivo).toMatch(/no está aprobado/);
		expect(mundo.content.updates.length).toBe(n);

		await llamar(mundo, ADMIN, "ajustes/guardar", { requiereAprobacion: true });
		await expect(llamar(mundo, EDITORA, "versiones/restaurar", { id, publicar: true, confirmar: true })).rejects.toThrow(
			/Solo un administrador/,
		);
		expect(mundo.content.updates.length).toBe(n);
		await llamar(mundo, ADMIN, "ajustes/guardar", { requiereAprobacion: false });

		const v = await llamar<ArticuloVista>(mundo, EDITORA, "versiones/restaurar", { id, publicar: true, confirmar: true });
		expect(v.articulo.publicacion).toBe("publicado");
		expect(textoBloque(v.articulo.doc, "b1")).toBe(B1);
		const acciones = (await (mundo.storage.auditoria as MemoryCollection<{ accion: string }>).query({ limit: 100 })).items.map(
			(a) => a.data.accion,
		);
		expect(acciones).toEqual(expect.arrayContaining(["restaurar", "publicar_sin_aprobar"]));
	});

	it("purga las versiones al borrar la entrada de forma permanente", async () => {
		await cambiarYa(mundo);
		await llamar(mundo, ADMIN, "revision/publicar", { ...ART, confirmar: true });
		expect((await versiones(mundo)).length).toBeGreaterThan(0);
		await hook("content:afterDelete", mundo, { id: "p1", collection: "posts", permanent: true });
		expect(await versiones(mundo)).toHaveLength(0);
	});
});
