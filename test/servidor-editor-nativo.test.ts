import { beforeEach, describe, expect, it } from "vitest";

import type { CambioDoc, ComentarioDoc, PTNode, RevisionDoc, SenalDoc, VersionDoc } from "../src/lib/types.js";
import { ADMIN, EDITORA, datosEjemplo, makeMundo, makePlugin, type MemoryCollection, type Mundo } from "./helpers.js";

const { llamar, hook, eventoPublicar } = makePlugin();
const ART = { collection: "posts", id: "p1" };

function bloque(key: string, texto: string): PTNode {
	return { _type: "block", _key: key, style: "normal", markDefs: [], children: [{ _type: "span", _key: `${key}s`, text: texto, marks: [] }] } as PTNode;
}

/** Contenido de ejemplo con el texto de algunos bloques cambiado (mismas claves). */
function contenidoCon(cambios: Record<string, string>): PTNode[] {
	return (datosEjemplo().content as PTNode[]).map((b) => (cambios[b._key] ? bloque(b._key, cambios[b._key]!) : b));
}

async function filas<T>(mundo: Mundo, nombre: string): Promise<Array<{ id: string; data: T }>> {
	const col = mundo.storage[nombre as keyof typeof mundo.storage] as unknown as MemoryCollection<T>;
	return (await col.query({ limit: 100 })).items;
}

async function guardarComoIsabel(mundo: Mundo, data: Record<string, unknown>, actor = EDITORA) {
	mundo.content.editar("posts", "p1", data);
	await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false, actor: { id: actor.id, role: actor.role } });
}

/** Publica como lo haría el editor de artículos: beforePublish, publicar y afterPublish. */
async function publicarDesdeEditor(mundo: Mundo, actor = EDITORA) {
	await eventoPublicar(mundo, "posts", "p1", { id: actor.id, role: actor.role } as { id: string });
	const acceso = mundo.content.access();
	const v = await acceso.getVersioned("posts", "p1");
	const antes = mundo.content.antesDePublicar;
	mundo.content.antesDePublicar = null; // el beforePublish ya se ha lanzado arriba
	await acceso.publish("posts", "p1", { _rev: v!._rev });
	mundo.content.antesDePublicar = antes;
	await hook("content:afterPublish", mundo, { content: { id: "p1" }, collection: "posts" });
}

describe("ediciones en el editor de artículos", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es", status: "published" });
	});

	it("en un artículo que el plugin no conocía, deja copia, constancia y una señal", async () => {
		await guardarComoIsabel(mundo, { content: contenidoCon({ b1: "La menopausia llega, de media, a los 51 años en España." }) });

		const versiones = await filas<VersionDoc>(mundo, "versiones");
		expect(versiones).toHaveLength(1);
		expect(versiones[0]!.data.motivo).toBe("Antes de una edición en el editor");
		expect(versiones[0]!.data.nombre).toBe("Isabel");

		const cambios = await filas<CambioDoc>(mundo, "cambios");
		expect(cambios).toHaveLength(1);
		expect(cambios[0]!.data).toMatchObject({ origen: "editor", veredicto: "bien", blockKey: "b1", op: "reemplazar" });
		expect(cambios[0]!.data.nota).toBe("Editado por Isabel en el editor de artículos");

		const senales = await filas<SenalDoc>(mundo, "senales");
		expect(senales).toHaveLength(1);
		expect(senales[0]!.data.tipo).toBe("edicion");
	});

	it("varios guardados seguidos son una sola sesión: una copia, un cambio por bloque y una señal", async () => {
		await guardarComoIsabel(mundo, { content: contenidoCon({ b1: "Uno." }) });
		await guardarComoIsabel(mundo, { content: contenidoCon({ b1: "Uno bis.", b3: "Tres." }) });
		expect(await filas<VersionDoc>(mundo, "versiones")).toHaveLength(1);
		const cambios = (await filas<CambioDoc>(mundo, "cambios")).map((r) => r.data);
		expect(cambios.map((c) => c.blockKey).sort()).toEqual(["b1", "b3"]);
		const b1 = cambios.find((c) => c.blockKey === "b1")!;
		expect(JSON.stringify(b1.antes)).toContain("51 años"); // el antes es el de partida
		expect(JSON.stringify(b1.despues)).toContain("Uno bis.");
		expect(await filas<SenalDoc>(mundo, "senales")).toHaveLength(1);

		// Si deja un bloque como estaba, ese cambio desaparece.
		await guardarComoIsabel(mundo, { content: contenidoCon({ b3: "Tres." }) });
		expect((await filas<CambioDoc>(mundo, "cambios")).map((r) => r.data.blockKey)).toEqual(["b3"]);
	});

	it("solo cambia el formato: no deja cambios ni señal", async () => {
		const content = (datosEjemplo().content as PTNode[]).map((b) => (b._key === "b1" ? { ...b, style: "h3" } : b));
		await guardarComoIsabel(mundo, { content });
		expect(await filas<CambioDoc>(mundo, "cambios")).toHaveLength(0);
		expect(await filas<SenalDoc>(mundo, "senales")).toHaveLength(0);
	});

	it("cierra lo pendiente en los bloques que toca y deja lo demás", async () => {
		const { cambios, comentarios, revisiones } = mundo.storage as unknown as {
			cambios: MemoryCollection<CambioDoc>;
			comentarios: MemoryCollection<ComentarioDoc>;
			revisiones: MemoryCollection<RevisionDoc>;
		};
		await llamar(mundo, EDITORA, "articulo/get", ART); // el plugin ya conoce el artículo
		const rev = (await revisiones.get("posts:p1"))!;
		await revisiones.put("posts:p1", { ...rev, vuelta: 1, estado: "cambios_por_ver" });
		const pendiente = (blockKey: string): CambioDoc => ({
			collection: "posts",
			entryId: "p1",
			vuelta: 1,
			trabajoId: "t1",
			orden: 1,
			op: "reemplazar",
			campo: "content",
			blockKey,
			trasKey: null,
			antes: null,
			despues: null,
			comentarioIds: [],
			avisos: [],
			veredicto: "pendiente",
			creado: "2026-11-01T00:00:00.000Z",
		});
		await cambios.put("c-b1", pendiente("b1"));
		await cambios.put("c-b4", pendiente("b4"));
		const comentario = (blockKey: string): ComentarioDoc => ({
			collection: "posts",
			entryId: "p1",
			tipo: "comentario",
			texto: "Revisa esto",
			ancla: { campo: "content", blockKey, cita: "x" },
			estado: "abierto",
			autorId: EDITORA.id,
			autorNombre: "Isabel",
			creado: "2026-11-01T00:00:00.000Z",
			vuelta: 1,
		});
		await comentarios.put("k-b1", comentario("b1"));
		await comentarios.put("k-b4", comentario("b4"));

		await guardarComoIsabel(mundo, { content: contenidoCon({ b1: "Texto suyo." }) });

		expect((await cambios.get("c-b1"))!).toMatchObject({ veredicto: "bien", cerradoPor: "editor" });
		expect((await cambios.get("c-b4"))!.veredicto).toBe("pendiente");
		expect((await comentarios.get("k-b1"))!.estado).toBe("aplicado");
		expect((await comentarios.get("k-b4"))!.estado).toBe("abierto");

		// Publicar desde el editor siendo revisora: aprueba y cierra lo que queda.
		await publicarDesdeEditor(mundo);
		expect((await cambios.get("c-b4"))!).toMatchObject({ veredicto: "bien", cerradoPor: "publicar" });
		expect((await comentarios.get("k-b4"))!.estado).toBe("aplicado");
		const final = (await revisiones.get("posts:p1"))!;
		expect(final.estado).toBe("aprobado");
		expect(final.aprobacion?.nombre).toBe("Isabel");
		// La fecha de revisión queda publicada.
		const fila = mundo.content.fila("posts", "p1")!;
		expect(fila.draft).toBeNull();
		expect(typeof fila.live.reviewed_at).toBe("string");
	});

	it("publicar como administrador no cuenta como aprobación de la revisora", async () => {
		await guardarComoIsabel(mundo, { title: "Otro título" }, ADMIN);
		await publicarDesdeEditor(mundo, ADMIN);
		const rev = await llamar(mundo, EDITORA, "articulo/get", ART);
		expect(rev.revision.estado).not.toBe("aprobado");
		expect(mundo.content.fila("posts", "p1")!.live.reviewed_at).toBeUndefined();
	});

	it("importa sesiones pasadas una sola vez y da por bueno lo publicado", async () => {
		mundo.content.editar("posts", "p1", { content: contenidoCon({ b1: "Versión de Isabel." }) });
		const acceso = mundo.content.access();
		const revs = await acceso.listRevisions("posts", "p1");
		const [despues, antes] = [revs[0]!, revs[1]!];
		mundo.content.antesDePublicar = null;
		const v = await acceso.getVersioned("posts", "p1");
		await acceso.publish("posts", "p1", { _rev: v!._rev });

		const entrada = {
			...ART,
			sesiones: [{ antesRevisionId: antes.id, despuesRevisionId: despues.id, autorId: EDITORA.id, fecha: "2026-11-18T19:09:00.000Z" }],
			aprobar: { autorId: EDITORA.id, fecha: "2026-11-18T19:13:00.000Z" },
		};
		const r = await llamar(mundo, ADMIN, "editor/importar", entrada);
		expect(r.sesiones[0].resultado).toMatch(/^1 cambio/);
		expect(r.aprobacion).toBe("aprobado por Isabel");

		const versiones = await filas<VersionDoc>(mundo, "versiones");
		expect(versiones.filter((x) => x.data.tipo === "cambio").map((x) => x.data.fecha)).toEqual(["2026-11-18T19:09:00.000Z"]);
		const senales = await filas<SenalDoc>(mundo, "senales");
		expect(senales.map((s) => s.data.fecha)).toEqual(["2026-11-18T19:09:00.000Z"]);
		expect(mundo.content.fila("posts", "p1")!.live.reviewed_at).toBe("2026-11-18T19:13:00.000Z");

		const otra = await llamar(mundo, ADMIN, "editor/importar", { ...entrada, aprobar: null });
		expect(otra.sesiones[0].resultado).toBe("ya importada");
		expect(await filas<CambioDoc>(mundo, "cambios")).toHaveLength(1);
	});
});
