import { beforeEach, describe, expect, it } from "vitest";

import type { ArticuloVista, ComentarioDoc, InicioVista, RevisionDoc } from "../src/lib/types.js";
import { ADMIN, EDITORA, datosEjemplo, makeMundo, makePlugin, type MemoryCollection, type Mundo } from "./helpers.js";

const { llamar, hook } = makePlugin();
const ART = { collection: "posts", id: "p1" };

function textoBloque(v: ArticuloVista, key: string): string {
	const b = v.articulo.doc.content.find((n) => n._key === key) as { children?: Array<{ text: string }> } | undefined;
	return (b?.children ?? []).map((s) => s.text).join("");
}

async function comentar(mundo: Mundo, extra: Record<string, unknown> = {}) {
	return llamar<{ comentario: ComentarioDoc & { id: string }; revision: RevisionDoc }>(mundo, EDITORA, "comentarios/crear", {
		...ART,
		texto: "Di que la edad media es 51 años según la AEEM",
		ancla: { campo: "content", blockKey: "b1", cita: "La menopausia llega de media a los 51 años en España." },
		...extra,
	});
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

describe("flujo completo", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es", status: "published" });
		mundo.content.add("posts", "p2", { ...datosEjemplo(), title: "Sofocos" }, { slug: "sofocos" });
	});

	it("comentar → terminar → reclamar → entregar → veredictos → aprobar → publicar", async () => {
		const inicio0 = await llamar<InicioVista>(mundo, EDITORA, "inicio");
		expect(inicio0.articulos).toHaveLength(2);
		expect(inicio0.usuario.puedeAprobar).toBe(true);
		expect(inicio0.seguirCon?.id).toBe("p1"); // publicados primero

		const { comentario, revision } = await comentar(mundo);
		expect(revision.estado).toBe("con_comentarios");
		expect(revision.abiertos).toBe(1);
		expect(comentario.ancla?.blockKey).toBe("b1");

		// Comentario general
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "Revisa el tono del final", ancla: null });

		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		expect(trabajo.motor).toBe("local");
		expect(trabajo.estado).toBe("cola");
		// Repetir «He terminado» no crea otro trabajo
		const otra = await llamar(mundo, EDITORA, "revision/terminar", ART);
		expect(otra.trabajo.id).toBe(trabajo.id);

		const colaMcp = await llamar(mundo, ADMIN, "mcp/cola");
		expect(colaMcp.trabajos).toHaveLength(1);
		expect(colaMcp.trabajos[0].titulo).toBe("Qué es la menopausia");
		expect(colaMcp.trabajos[0].comentarios).toBe(2);

		const r = await llamar(mundo, ADMIN, "mcp/reclamar", {});
		expect(r.entrada.trabajoId).toBe(trabajo.id);
		expect(r.entrada.comentarios).toHaveLength(2);
		expect(r.entrada.bloques.map((b: { key: string }) => b.key)).toEqual(["b1", "b2", "b3", "b4"]);
		expect(typeof r.instrucciones).toBe("string");
		expect(await llamar(mundo, ADMIN, "mcp/reclamar", {})).toEqual({ vacio: true });

		const general = r.entrada.comentarios.find((c: { campo: string }) => c.campo === "general");
		const entrega = await llamar(mundo, ADMIN, "mcp/entregar", {
			trabajoId: trabajo.id,
			ops: [
				{
					op: "reemplazar",
					blockKey: "b1",
					markdown: "La menopausia llega de media a los 51 años en España, según la AEEM.",
					comentarioIds: [comentario.id],
				},
				{ op: "reemplazar", blockKey: "zzz", markdown: "Nada", comentarioIds: [] },
			],
			resoluciones: [
				{ comentarioId: comentario.id, accion: "aplicado", nota: "Añadida la fuente." },
				{ comentarioId: general.id, accion: "descartado", nota: "El tono ya es cercano." },
			],
		});
		expect(entrega.estado).toBe("hecho");
		expect(entrega.cambios).toBe(1);
		expect(entrega.rechazadas).toHaveLength(1);
		// Correo a la editora que pidió la corrección
		expect(mundo.correos.some((c) => c.to === EDITORA.email && /corregido/.test(c.subject))).toBe(true);

		let v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.revision.estado).toBe("cambios_por_ver");
		expect(v.revision.vuelta).toBe(1);
		expect(v.cambios).toHaveLength(1);
		expect(v.noAplicados.map((c) => c.id)).toEqual([general.id]);
		expect(textoBloque(v, "b1")).toContain("según la AEEM");
		expect(v.articulo.publicacion).toBe("publicado_con_cambios");
		expect(v.trabajo?.estado).toBe("hecho");

		const cambio = v.cambios[0]!;
		const ver = await llamar(mundo, EDITORA, "cambios/veredicto", { id: cambio.id, veredicto: "bien", confirmado: true });
		expect(ver.cambio.veredicto).toBe("bien");
		expect(ver.revision.estado).toBe("cambios_por_ver");

		// Aprobar sin haber leído: pide confirmación
		const sinLeer = await llamar(mundo, EDITORA, "revision/aprobar", ART);
		expect(sinLeer.requiereConfirmacion).toBe(true);
		expect(sinLeer.leido).toBe(0);

		await leerTodo(mundo);
		const ap = await llamar(mundo, EDITORA, "revision/aprobar", ART);
		expect(ap.revision.estado).toBe("aprobado");
		expect(ap.revision.aprobacion.nombre).toBe("Isabel");
		// Se escribió el campo de fecha de revisión sin invalidar la aprobación
		expect(mundo.content.updates.at(-1)?.data).toHaveProperty("reviewed_at");
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.revision.aprobacion?.cambiadoDespues).toBeFalsy();

		const pub = await llamar(mundo, EDITORA, "revision/publicar", ART);
		expect(pub.ok).toBe(true);
		expect(pub.urlPublica).toBe("https://test.local/articulos/que-es");
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.articulo.publicacion).toBe("publicado");

		const audit = (mundo.storage.auditoria as MemoryCollection<{ accion: string }>);
		const acciones = (await audit.query({ limit: 100 })).items.map((i) => i.data.accion);
		expect(acciones).toEqual(expect.arrayContaining(["comentar", "terminar", "entregar", "veredicto", "aprobar", "publicar"]));
	});

	it("conflicto si el texto cambia entre reclamar y entregar; entregar es idempotente", async () => {
		const { comentario } = await comentar(mundo);
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		mundo.content.editar("posts", "p1", { title: "Título cambiado a mano" });
		const salida = {
			trabajoId: trabajo.id,
			ops: [{ op: "reemplazar", blockKey: "b1", markdown: "Texto nuevo.", comentarioIds: [comentario.id] }],
			resoluciones: [{ comentarioId: comentario.id, accion: "aplicado", nota: "Hecho" }],
		};
		const r1 = await llamar(mundo, ADMIN, "mcp/entregar", salida);
		expect(r1.estado).toBe("conflicto");
		expect(await llamar(mundo, ADMIN, "mcp/entregar", salida)).toEqual(r1);
		let v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(textoBloque(v, "b1")).not.toBe("Texto nuevo.");
		expect(v.trabajo?.estado).toBe("conflicto");

		// Reintento sobre el texto actual
		const ap = await llamar(mundo, ADMIN, "trabajo/aplicar-pendiente", { id: trabajo.id });
		expect(ap.trabajo.estado).toBe("hecho");
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(textoBloque(v, "b1")).toBe("Texto nuevo.");
		expect(v.articulo.doc.titulo).toBe("Título cambiado a mano");

		// Idempotencia: repetir la entrega no duplica cambios
		const repetida = await llamar(mundo, ADMIN, "mcp/entregar", salida);
		expect(repetida.estado).toBe("hecho");
		expect(repetida.cambios).toBe(1);
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.cambios).toHaveLength(1);
		expect(v.revision.vuelta).toBe(1);
	});

	it("una edición externa degrada la aprobación y re-ancla los comentarios", async () => {
		await leerTodo(mundo);
		const ap = await llamar(mundo, EDITORA, "revision/aprobar", ART);
		expect(ap.revision.estado).toBe("aprobado");
		// Comentario abierto que quedará huérfano (se reabre la revisión, así que lo
		// creamos en otro artículo para la parte del re-anclado)
		mundo.content.editar("posts", "p1", { content: [...datosEjemplo().content as unknown[]].slice(1) });
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false, actor: { id: "u-x", role: 50 } });
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.revision.estado).toBe("aprobado");
		expect(v.revision.aprobacion?.cambiadoDespues).toBe(true);
		const pub = await llamar(mundo, EDITORA, "revision/publicar", ART);
		expect(pub.requiereConfirmacion).toBe(true);
		expect(pub.motivo).toMatch(/cambiado/);

		const art2 = { collection: "posts", id: "p2" };
		await llamar(mundo, EDITORA, "comentarios/crear", {
			...art2,
			texto: "Esto no",
			ancla: { campo: "content", blockKey: "b3", cita: "Los sofocos afectan a muchas mujeres y suelen durar varios años." },
		});
		mundo.content.editar("posts", "p2", { content: (datosEjemplo().content as Array<{ _key: string }>).filter((b) => b._key !== "b3") });
		await hook("content:afterSave", mundo, { content: { id: "p2" }, collection: "posts", isNew: false });
		const v2 = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", art2);
		expect(v2.comentarios[0]?.huerfano).toBe(true);
	});

	it("una escritura propia no degrada la aprobación", async () => {
		const { comentario } = await comentar(mundo, {
			ancla: { campo: "content", blockKey: "b1", inicio: 37, fin: 39, cita: "51" },
			textoPropuesto: "51,4",
		});
		await llamar(mundo, EDITORA, "comentarios/aplicar", { id: comentario.id });
		await leerTodo(mundo);
		await llamar(mundo, EDITORA, "revision/aprobar", ART);
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false });
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.revision.aprobacion?.cambiadoDespues).toBeFalsy();
	});

	it("«Cambiarlo ya» sustituye el fragmento, crea un cambio aceptado y se puede deshacer", async () => {
		const { comentario } = await comentar(mundo, {
			ancla: { campo: "content", blockKey: "b1", inicio: 37, fin: 39, cita: "51" },
			textoPropuesto: "51,4",
		});
		let v = await llamar<ArticuloVista>(mundo, EDITORA, "comentarios/aplicar", { id: comentario.id });
		expect(textoBloque(v, "b1")).toBe("La menopausia llega de media a los 51,4 años en España.");
		expect(v.comentarios.find((c) => c.id === comentario.id)?.estado).toBe("aplicado");
		expect(v.revision.vuelta).toBe(0);
		expect(v.revision.estado).toBe("por_revisar");
		const cambios = (await (mundo.storage.cambios as MemoryCollection<any>).query({ limit: 10 })).items;
		expect(cambios).toHaveLength(1);
		expect(cambios[0]!.data.veredicto).toBe("bien");

		// Deshacer
		const d = await llamar(mundo, EDITORA, "cambios/veredicto", { id: cambios[0]!.id, veredicto: "deshecho" });
		expect(d.cambio.veredicto).toBe("deshecho");
		expect(d.revision.estado).toBe("con_comentarios");
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(textoBloque(v, "b1")).toBe("La menopausia llega de media a los 51 años en España.");
		expect(v.comentarios.find((c) => c.id === comentario.id)?.estado).toBe("abierto");
		// No se puede volver a cambiar un veredicto deshecho
		await expect(llamar(mundo, EDITORA, "cambios/veredicto", { id: cambios[0]!.id, veredicto: "bien" })).rejects.toThrow(/deshizo/);
	});

	it("«No es esto» exige nota y reabre el comentario con la nota como respuesta", async () => {
		const { comentario } = await comentar(mundo);
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		await llamar(mundo, ADMIN, "mcp/reclamar", {});
		await llamar(mundo, ADMIN, "mcp/entregar", {
			trabajoId: trabajo.id,
			ops: [{ op: "reemplazar", blockKey: "b1", markdown: "Otra cosa.", comentarioIds: [comentario.id] }],
			resoluciones: [{ comentarioId: comentario.id, accion: "aplicado", nota: "ok" }],
		});
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		const id = v.cambios[0]!.id;
		await expect(llamar(mundo, EDITORA, "cambios/veredicto", { id, veredicto: "no_es_esto" })).rejects.toThrow(/Cuéntanos/);
		const r = await llamar(mundo, EDITORA, "cambios/veredicto", { id, veredicto: "no_es_esto", nota: "Quería citar la fuente" });
		expect(r.revision.estado).toBe("con_comentarios");
		const v2 = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v2.comentarios.find((c) => c.id === comentario.id)?.estado).toBe("abierto");
		expect(v2.comentarios.some((c) => c.parentId === comentario.id && c.texto === "Quería citar la fuente")).toBe(true);
		// La siguiente entrada para la IA lleva la nota
		const { trabajo: t2 } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		const r2 = await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: t2.id });
		expect(r2.entrada.comentarios[0].texto).toContain("Quería citar la fuente");
	});

	it("un comentario nuevo sobre un artículo aprobado anula la aprobación", async () => {
		await leerTodo(mundo);
		await llamar(mundo, EDITORA, "revision/aprobar", ART);
		const { revision } = await comentar(mundo);
		expect(revision.estado).toBe("con_comentarios");
		expect(revision.aprobacion).toBeNull();
	});

	it("publicar sin aprobación pide confirmación; con requiereAprobacion solo un admin confirma", async () => {
		const r = await llamar(mundo, EDITORA, "revision/publicar", ART);
		expect(r).toMatchObject({ requiereConfirmacion: true, aprobacion: null });
		await llamar(mundo, ADMIN, "ajustes/guardar", { requiereAprobacion: true });
		await expect(llamar(mundo, EDITORA, "revision/publicar", { ...ART, confirmar: true })).rejects.toThrow(/administrador/);
		const ok = await llamar(mundo, ADMIN, "revision/publicar", { ...ART, confirmar: true });
		expect(ok.ok).toBe(true);
		const audit = (await (mundo.storage.auditoria as MemoryCollection<{ accion: string }>).query({ limit: 100 })).items;
		expect(audit.map((a) => a.data.accion)).toContain("publicar_sin_aprobar");
	});

	it("borrar un comentario y descartarlo devuelve el artículo a «por revisar»", async () => {
		const { comentario } = await comentar(mundo);
		const r = await llamar(mundo, EDITORA, "comentarios/estado", { id: comentario.id, estado: "descartado" });
		expect(r.revision.estado).toBe("por_revisar");
		const r2 = await llamar(mundo, EDITORA, "comentarios/estado", { id: comentario.id, estado: "abierto" });
		expect(r2.revision.estado).toBe("con_comentarios");
		await expect(llamar(mundo, ADMIN, "comentarios/borrar", { id: "nope" })).rejects.toThrow(/No se encuentra/);
		const b = await llamar(mundo, EDITORA, "comentarios/borrar", { id: comentario.id });
		expect(b.revision.estado).toBe("por_revisar");
	});

	it("purga todo al borrar la entrada de forma permanente", async () => {
		await comentar(mundo);
		await hook("content:afterDelete", mundo, { id: "p1", collection: "posts", permanent: false });
		expect((mundo.storage.comentarios as MemoryCollection<unknown>).size()).toBe(1);
		await hook("content:afterDelete", mundo, { id: "p1", collection: "posts", permanent: true });
		expect((mundo.storage.comentarios as MemoryCollection<unknown>).size()).toBe(0);
		expect((mundo.storage.revisiones as MemoryCollection<unknown>).size()).toBe(0);
	});
});
