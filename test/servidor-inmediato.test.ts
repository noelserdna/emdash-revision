import { beforeEach, describe, expect, it, vi } from "vitest";

import { AJUSTE_CLAVE } from "../src/lib/ajustes.js";
import type { ArticuloVista, ComentarioDoc, EntradaCorreccion } from "../src/lib/types.js";
import { EDITORA, datosEjemplo, makeMundo, makePlugin, type Mundo } from "./helpers.js";

/** La «IA»: corrige el bloque de cada comentario que recibe. */
const pedidos: EntradaCorreccion[] = [];
vi.mock("../src/lib/motor-api.js", async (orig) => ({
	...(await orig<typeof import("../src/lib/motor-api.js")>()),
	corregirConApi: async (entrada: EntradaCorreccion) => {
		pedidos.push(entrada);
		return {
			salida: {
				ops: entrada.comentarios
					.filter((c) => c.blockKey)
					.map((c) => ({ op: "reemplazar", blockKey: c.blockKey, markdown: `Corregido por la IA (${c.texto}).`, comentarioIds: [c.id] })),
				resoluciones: entrada.comentarios.map((c) => ({ comentarioId: c.id, accion: "aplicado", nota: "Hecho." })),
			},
			usage: null,
			coste: 0.01,
			modelo: "claude-opus-5-5",
		};
	},
}));

const { llamar } = makePlugin();
const ART = { collection: "posts", id: "p1" };
const texto = (v: ArticuloVista, key: string) =>
	((v.articulo.doc.content.find((n) => n._key === key) as { children?: Array<{ text: string }> } | undefined)?.children ?? []).map((s) => s.text).join("");

async function comentar(mundo: Mundo, blockKey: string, que: string) {
	const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
	const r = await llamar<{ comentario: ComentarioDoc & { id: string } }>(mundo, EDITORA, "comentarios/crear", {
		...ART,
		texto: que,
		ancla: { campo: "content", blockKey, cita: texto(v, blockKey) },
	});
	return r.comentario;
}

describe("corrección al momento y edición directa", () => {
	let mundo: Mundo;
	beforeEach(async () => {
		pedidos.length = 0;
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es", status: "published" });
		await mundo.settings.set(AJUSTE_CLAVE, "sk-ant-api03-clave-de-prueba-0123456789");
	});

	it("cada comentario se corrige solo, y el segundo se suma a la misma vuelta", async () => {
		const c1 = await comentar(mundo, "b1", "más claro");
		const c2 = await comentar(mundo, "b2", "más corto");

		let v = await llamar<ArticuloVista>(mundo, EDITORA, "comentarios/corregir", { id: c1.id });
		expect(pedidos[0]!.comentarios.map((c) => c.id)).toEqual([c1.id]);
		expect(texto(v, "b1")).toBe("Corregido por la IA (más claro).");
		expect(v.revision.estado).toBe("cambios_por_ver");
		expect(v.revision.vuelta).toBe(1);
		expect(v.cambios).toHaveLength(1);
		// El otro comentario sigue abierto y sin tocar.
		expect(v.comentarios.find((c) => c.id === c2.id)?.estado).toBe("abierto");
		expect(mundo.correos).toHaveLength(0);

		v = await llamar<ArticuloVista>(mundo, EDITORA, "comentarios/corregir", { id: c2.id });
		expect(v.revision.vuelta).toBe(1);
		expect(v.cambios).toHaveLength(2);
		expect(v.cambios.every((c) => c.veredicto === "pendiente")).toBe(true);

		// Ya resuelto: no se vuelve a corregir.
		await expect(llamar(mundo, EDITORA, "comentarios/corregir", { id: c1.id })).rejects.toThrow();
	});

	it("la revisora edita un párrafo sin comentar, y luego el cambio de la IA", async () => {
		let v = await llamar<ArticuloVista>(mundo, EDITORA, "bloque/editar", { ...ART, campo: "content", blockKey: "b2", texto: "Párrafo escrito por ella." });
		expect(texto(v, "b2")).toBe("Párrafo escrito por ella.");

		v = await llamar<ArticuloVista>(mundo, EDITORA, "bloque/editar", { ...ART, campo: "title", texto: "Título nuevo" });
		expect(v.articulo.doc.titulo).toBe("Título nuevo");

		const c1 = await comentar(mundo, "b1", "más claro");
		v = await llamar<ArticuloVista>(mundo, EDITORA, "comentarios/corregir", { id: c1.id });
		// Editar un párrafo que tiene un cambio pendiente de la IA lo da por bueno con su texto.
		v = await llamar<ArticuloVista>(mundo, EDITORA, "bloque/editar", { ...ART, campo: "content", blockKey: "b1", texto: "Mejor así, con mis palabras." });
		expect(texto(v, "b1")).toBe("Mejor así, con mis palabras.");
		const cambio = v.cambios.find((c) => c.blockKey === "b1")!;
		expect(cambio.veredicto).toBe("bien");
		expect(v.cambios.filter((c) => c.blockKey === "b1")).toHaveLength(1);
	});
});
