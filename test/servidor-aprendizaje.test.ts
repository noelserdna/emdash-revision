import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/motor-api.js", async (original) => {
	const real = await original<typeof import("../src/lib/motor-api.js")>();
	return { ...real, aprenderConApi: vi.fn() };
});

import { aprenderConApi } from "../src/lib/motor-api.js";
import { resumenEdicion } from "../src/lib/aprendizaje.js";
import { validarSalidaAprendizaje } from "../src/lib/prompt-aprendizaje.js";
import type {
	AprendizajeDoc,
	ArticuloVista,
	AuditoriaDoc,
	EstadoAprendizajeVista,
	GuiaDoc,
	GuiaHistorialDoc,
	InicioVista,
	SalidaAprendizaje,
	SenalDoc,
} from "../src/lib/types.js";
import { ADMIN, AUTORA, EDITORA, contenidoEjemplo, datosEjemplo, makeMundo, makePlugin, type MemoryCollection, type Mundo } from "./helpers.js";

const { plugin, llamar, hook } = makePlugin();
const ART = { collection: "posts", id: "p1" };
const ART2 = { collection: "posts", id: "p2" };
const CITA_B1 = "La menopausia llega de media a los 51 años en España.";
const CITA_B3 = "Los sofocos afectan a muchas mujeres y suelen durar varios años.";
const mockApi = vi.mocked(aprenderConApi);

function col<T>(mundo: Mundo, nombre: string): MemoryCollection<T> {
	return mundo.storage[nombre] as unknown as MemoryCollection<T>;
}

async function filas<T>(mundo: Mundo, nombre: string): Promise<Array<{ id: string; data: T }>> {
	return (await col<T>(mundo, nombre).query({ limit: 100 })).items;
}

async function senales(mundo: Mundo) {
	return filas<SenalDoc>(mundo, "senales");
}

function respuesta(salida: SalidaAprendizaje, coste = 0.25) {
	return { salida, usage: { input_tokens: 100, output_tokens: 50 }, coste, modelo: "claude-opus-5-5" };
}

async function cron(mundo: Mundo, name = "aprendizaje") {
	await hook("cron", mundo, { name, scheduledAt: "" });
}

async function comentar(mundo: Mundo, ref = ART, extra: Record<string, unknown> = {}) {
	return llamar(mundo, EDITORA, "comentarios/crear", {
		...ref,
		texto: "No uses «menopausia precoz» antes de los 40",
		ancla: { campo: "content", blockKey: "b1", cita: CITA_B1 },
		...extra,
	});
}

describe("señales: qué se registra y de quién", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es" });
		mundo.content.add("posts", "p2", { ...datosEjemplo(), title: "Sofocos" }, { slug: "sofocos" });
	});

	it("un comentario de la revisora deja una señal; los de administradores y autoras no", async () => {
		await comentar(mundo, ART, { textoPropuesto: "insuficiencia ovárica prematura" });
		await llamar(mundo, ADMIN, "comentarios/crear", { ...ART, texto: "Del admin", ancla: null });
		await llamar(mundo, AUTORA, "comentarios/crear", { ...ART, texto: "De la autora", ancla: null });
		const s = await senales(mundo);
		expect(s).toHaveLength(1);
		expect(s[0]!.data).toMatchObject({
			tipo: "comentario",
			userId: EDITORA.id,
			nombre: "Isabel",
			collection: "posts",
			entryId: "p1",
			titulo: "Qué es la menopausia",
			campo: "content",
			cita: CITA_B1,
			texto: "No uses «menopausia precoz» antes de los 40",
			despues: "insuficiencia ovárica prematura",
			general: false,
			procesada: false,
		});
		// Con el ajuste, también se aprende de los administradores.
		await llamar(mundo, ADMIN, "ajustes/guardar", { aprenderDeAdministradores: true });
		await llamar(mundo, ADMIN, "comentarios/crear", { ...ART, texto: "Ahora sí", ancla: null });
		expect(await senales(mundo)).toHaveLength(2);
		// Si solo aprueban los administradores, una editora ya no es revisora.
		await llamar(mundo, ADMIN, "ajustes/guardar", { rolAprueba: 50, aprenderDeAdministradores: false });
		await comentar(mundo);
		expect(await senales(mundo)).toHaveLength(2);
	});

	it("los textos largos se recortan", async () => {
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "x".repeat(5000), ancla: null });
		const [s] = await senales(mundo);
		expect(s!.data.texto!.length).toBeLessThanOrEqual(1000);
		expect(s!.data.campo).toBe("general");
	});

	it("«Cambiarlo ya» completa la señal del comentario con el antes y el después", async () => {
		const { comentario } = await llamar(mundo, EDITORA, "comentarios/crear", {
			...ART,
			texto: "Mejor así",
			textoPropuesto: "Los sofocos son frecuentes",
			ancla: { campo: "content", blockKey: "b3", cita: CITA_B3 },
			fragmento: "Los sofocos afectan a muchas mujeres",
		});
		await llamar(mundo, EDITORA, "comentarios/aplicar", { id: comentario.id });
		const s = await senales(mundo);
		expect(s).toHaveLength(1);
		expect(s[0]!.data).toMatchObject({
			tipo: "cambiar_ya",
			antes: "Los sofocos afectan a muchas mujeres",
			despues: "Los sofocos son frecuentes",
			texto: "Mejor así",
		});
	});

	it("«No es esto» y «Deshacer» sobre cambios de la IA dejan señal con el cambio", async () => {
		const c1 = (await comentar(mundo)).comentario;
		const c2 = (
			await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "Más corto", ancla: { campo: "content", blockKey: "b3", cita: CITA_B3 } })
		).comentario;
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		await llamar(mundo, ADMIN, "mcp/entregar", {
			trabajoId: trabajo.id,
			ops: [
				{ op: "reemplazar", blockKey: "b1", markdown: "La menopausia precoz llega a los 51 años.", comentarioIds: [c1.id] },
				{ op: "reemplazar", blockKey: "b3", markdown: "Los sofocos son frecuentes.", comentarioIds: [c2.id] },
			],
			resoluciones: [
				{ comentarioId: c1.id, accion: "aplicado", nota: "Hecho" },
				{ comentarioId: c2.id, accion: "aplicado", nota: "Hecho" },
			],
		});
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		const [k1, k2] = v.cambios;
		await llamar(mundo, EDITORA, "cambios/veredicto", { id: k1!.id, veredicto: "no_es_esto", nota: "Al revés: precoz es de 40 a 44" });
		await llamar(mundo, EDITORA, "cambios/veredicto", { id: k2!.id, veredicto: "deshecho" });
		const s = (await senales(mundo)).map((r) => r.data);
		const noEs = s.find((x) => x.tipo === "no_es_esto");
		expect(noEs).toMatchObject({
			nota: "Al revés: precoz es de 40 a 44",
			antes: CITA_B1,
			despues: "La menopausia precoz llega a los 51 años.",
			campo: "content",
		});
		expect(s.find((x) => x.tipo === "deshacer")).toMatchObject({ antes: CITA_B3, despues: "Los sofocos son frecuentes." });
		// Las respuestas hijas de «No es esto» no son comentarios nuevos: 2 comentarios + 2 veredictos.
		expect(s).toHaveLength(4);
	});

	it("la respuesta a una pregunta deja una señal con la pregunta y a cuántos artículos afecta", async () => {
		await llamar(mundo, ADMIN, "preguntas/importar", {
			preguntas: [
				{
					pregunta: "¿Decimos «suelen durar varios años»?",
					entradas: [
						{ collection: "posts", id: "p1", cita: "suelen durar varios años" },
						{ collection: "posts", id: "p2", cita: "suelen durar varios años" },
					],
				},
			],
		});
		const ini = await llamar<InicioVista>(mundo, EDITORA, "inicio");
		await llamar(mundo, EDITORA, "preguntas/responder", { reglaId: ini.preguntas[0]!.reglaId, tipo: "cambiar", texto: "Di «una media de siete años»" });
		const s = (await senales(mundo)).map((r) => r.data);
		expect(s).toHaveLength(1);
		expect(s[0]).toMatchObject({ tipo: "respuesta", texto: "¿Decimos «suelen durar varios años»?", despues: "Di «una media de siete años»" });
		expect(s[0]!.nota).toMatch(/Afecta a 2 artículos/);
		expect(s[0]!.titulo).toMatch(/Qué es la menopausia/);
	});

	it("una edición en el editor nativo solo deja señal si la hace una revisora", async () => {
		await llamar(mundo, ADMIN, "comentarios/crear", { ...ART, texto: "General", ancla: null });
		await llamar(mundo, EDITORA, "articulo/get", ART); // fija el último texto visto
		mundo.content.editar("posts", "p1", { title: "Título de la revisora" });
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false, actor: { id: ADMIN.id, role: 50 } });
		expect(await senales(mundo)).toHaveLength(0);

		const content = contenidoEjemplo();
		(content[2] as { children: Array<{ text: string }> }).children[0]!.text = "Los sofocos son muy frecuentes.";
		mundo.content.editar("posts", "p1", { content });
		await hook("content:afterSave", mundo, { content: { id: "p1" }, collection: "posts", isNew: false, actor: { id: EDITORA.id, role: 40 } });
		const s = await senales(mundo);
		expect(s).toHaveLength(1);
		expect(s[0]!.data).toMatchObject({ tipo: "edicion", campo: "content", antes: CITA_B3, despues: "Los sofocos son muy frecuentes." });
	});

	it("el resumen de una edición se queda en 3 bloques y 1.500 caracteres", () => {
		const antes = { titulo: "T", extracto: "E", referencias: "", content: contenidoEjemplo() };
		const despues = {
			titulo: "T2",
			extracto: "E2",
			referencias: "",
			content: contenidoEjemplo().map((b) => ({ ...b, children: [{ _type: "span", _key: "x", text: "y".repeat(3000) }] })),
		};
		const r = resumenEdicion(antes, despues as typeof antes)!;
		expect(r.antes.split("¶")).toHaveLength(3);
		expect(r.antes.length + r.despues.length).toBeLessThanOrEqual(1500 + 10);
		expect(resumenEdicion(antes, antes)).toBeNull();
	});
});

describe("casilla «Esto vale para todos los artículos»", () => {
	it("marca el comentario y la señal como generales y programa una síntesis a los 10 minutos, una sola vez", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		const antes = Date.now();
		const { comentario } = await comentar(mundo, ART, { general: true });
		expect(comentario.general).toBe(true);
		expect((await senales(mundo))[0]!.data.general).toBe(true);
		const pronto = mundo.cron.filter((c) => c.name === "aprendizaje-pronto");
		expect(pronto).toHaveLength(1);
		const t = Date.parse(pronto[0]!.schedule);
		expect(t - antes).toBeGreaterThanOrEqual(9.9 * 60 * 1000);
		expect(t - antes).toBeLessThanOrEqual(10.1 * 60 * 1000);
		// Antirrebote
		await comentar(mundo, ART, { general: true });
		expect(mundo.cron.filter((c) => c.name === "aprendizaje-pronto")).toHaveLength(1);
		// Sin casilla, no se programa nada
		const otro = makeMundo();
		otro.content.add("posts", "p1", datosEjemplo());
		await comentar(otro);
		expect(otro.cron).toHaveLength(0);
	});

	it("«Aprobar» programa la síntesis si hay correcciones pendientes", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		await llamar(mundo, EDITORA, "revision/aprobar", { ...ART, confirmar: true });
		expect(mundo.cron).toHaveLength(0);
		await comentar(mundo);
		await llamar(mundo, EDITORA, "comentarios/estado", { id: (await filas<{ texto: string }>(mundo, "comentarios"))[0]!.id, estado: "descartado" });
		await llamar(mundo, EDITORA, "revision/aprobar", { ...ART, confirmar: true });
		expect(mundo.cron.map((c) => c.name)).toEqual(["aprendizaje-pronto"]);
	});
});

describe("síntesis con la API", () => {
	let mundo: Mundo;
	beforeEach(async () => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es" });
		mundo.content.add("posts", "p2", { ...datosEjemplo(), title: "Sofocos" }, { slug: "sofocos" });
		process.env.ANTHROPIC_API_KEY = "sk-test";
		mockApi.mockReset();
		await llamar(mundo, ADMIN, "guias/guardar", { nombre: "Criterios", markdown: "# Criterios", orden: 1 });
		await llamar(mundo, ADMIN, "guias/guardar", { nombre: "Guía editorial", markdown: "# Guía", orden: 2 });
		await llamar(mundo, ADMIN, "ajustes/guardar", { avisarA: "andres@ejemplo.es", nombreGuiaAprendida: "Aprendido de Isabel" });
	});
	afterEach(() => {
		delete process.env.ANTHROPIC_API_KEY;
	});

	async function dosSenales() {
		await comentar(mundo, ART);
		await comentar(mundo, ART2);
		return (await senales(mundo)).map((s) => s.id);
	}

	it("añade criterios, regenera la guía, marca las señales, cobra, guarda historial, audita y avisa", async () => {
		const ids = await dosSenales();
		mockApi.mockResolvedValueOnce(
			respuesta({
				operaciones: [{ op: "añadir", texto: "Escribe «menopausia precoz» solo entre los 40 y los 44 años.", tema: "Terminología", senales: ids }],
				resumen: "Un criterio de terminología.",
			}),
		);
		await cron(mundo);
		expect(mockApi).toHaveBeenCalledOnce();
		const [entrada, opts] = mockApi.mock.calls[0]!;
		expect(entrada.senales.map((s) => s.id).sort()).toEqual([...ids].sort());
		expect(entrada.guias.map((g) => g.nombre)).toEqual(["Criterios", "Guía editorial"]);
		expect(opts).toMatchObject({ apiKey: "sk-test", modelo: "claude-opus-5-5", esfuerzo: "high" });

		const guia = (await col<GuiaDoc>(mundo, "guias").get("aprendido"))!;
		expect(guia).toMatchObject({ nombre: "Aprendido de Isabel", orden: 1.5, automatica: true });
		expect(guia.markdown).toContain("## Terminología");
		expect(guia.markdown).toMatch(/- Escribe «menopausia precoz» solo entre los 40 y los 44 años\. \(desde el \d+ \S+ \d{4}; visto en: «[^»]+», «[^»]+»\)/);
		expect(guia.markdown).toContain("«Qué es la menopausia»");
		expect(guia.markdown).toContain("«Sofocos»");
		expect((await senales(mundo)).every((s) => s.data.procesada)).toBe(true);
		expect((await llamar(mundo, ADMIN, "ajustes/get")).gastoMes).toBe(0.25);
		// No había versión anterior: el historial empieza con la siguiente.
		expect(await filas<GuiaHistorialDoc>(mundo, "guias_historial")).toHaveLength(0);
		const correo = mundo.correos.at(-1)!;
		expect(correo.to).toBe("andres@ejemplo.es");
		expect(correo.text).toContain("Criterios nuevos:");
		expect(correo.text).toContain("/_emdash/admin/plugins/emdash-revision/guias?guia=aprendido");
		const aud = await filas<AuditoriaDoc>(mundo, "auditoria");
		expect(aud.some((a) => a.data.accion === "aprender")).toBe(true);

		// En el panel
		const est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado");
		expect(est).toMatchObject({ pendientes: 0, parado: null, error: null, apiDisponible: true });
		expect(est.aprendizajes).toHaveLength(1);
		expect(est.ultimoResumen).toMatch(/1 criterio nuevo/);

		// Segunda pasada: modificar y retirar
		const id = est.aprendizajes[0]!.id;
		await comentar(mundo, ART, { texto: "Y en la primera mención, «insuficiencia ovárica prematura (IOP)»" });
		const nueva = (await senales(mundo)).find((s) => !s.data.procesada)!.id;
		mockApi.mockResolvedValueOnce(
			respuesta({ operaciones: [{ op: "modificar", id, texto: "Antes de los 40, «insuficiencia ovárica prematura (IOP)».", senales: [nueva] }], resumen: "Precisado." }),
		);
		await cron(mundo);
		const a = (await col<AprendizajeDoc>(mundo, "aprendizajes").get(id))!;
		expect(a.texto).toBe("Antes de los 40, «insuficiencia ovárica prematura (IOP)».");
		expect(a.tema).toBe("Terminología");
		expect(a.evidencias).toHaveLength(3);
		const hist = await filas<GuiaHistorialDoc>(mundo, "guias_historial");
		expect(hist).toHaveLength(1);
		expect(hist[0]!.data.markdown).toContain("solo entre los 40 y los 44");

		await comentar(mundo, ART2, { texto: "Ya no hace falta" });
		const otra = (await senales(mundo)).find((s) => !s.data.procesada)!.id;
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "retirar", id, senales: [otra] }], resumen: "Ya no vale." }));
		await cron(mundo);
		expect((await col<AprendizajeDoc>(mundo, "aprendizajes").get(id))!).toMatchObject({ estado: "retirado", retiradoPor: "ia" });
		expect((await col<GuiaDoc>(mundo, "guias").get("aprendido"))!.markdown).toContain("Todavía no hay criterios aprendidos.");
		expect(mundo.correos.at(-1)!.text).toContain("Criterios retirados:");
	});

	it("la guía automática llega a la IA que corrige y no se puede editar ni borrar a mano", async () => {
		const ids = await dosSenales();
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "añadir", texto: "Regla aprendida.", tema: "Tono", senales: ids }], resumen: "" }));
		await cron(mundo);
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "x", ancla: null });
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		const r = await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		expect(r.entrada.guias.map((g: { nombre: string }) => g.nombre)).toEqual(["Criterios", "Aprendido de Isabel", "Guía editorial"]);
		expect(r.entrada.guias[1].markdown).toContain("Regla aprendida.");
		await expect(llamar(mundo, ADMIN, "guias/guardar", { id: "aprendido", nombre: "x", markdown: "y" })).rejects.toThrow(/se actualiza sola/);
		await expect(llamar(mundo, ADMIN, "guias/borrar", { id: "aprendido" })).rejects.toThrow(/se actualiza sola/);
		const lista = await llamar(mundo, ADMIN, "guias/listar");
		expect(lista.guias.find((g: { id: string }) => g.id === "aprendido").automatica).toBe(true);
		// Cambiar el nombre en Ajustes renombra la guía
		await llamar(mundo, ADMIN, "ajustes/guardar", { nombreGuiaAprendida: "Aprendido de las correcciones de Isabel" });
		const g = (await col<GuiaDoc>(mundo, "guias").get("aprendido"))!;
		expect(g.nombre).toBe("Aprendido de las correcciones de Isabel");
		expect(g.markdown).toMatch(/^# Aprendido de las correcciones de Isabel/);
	});

	it("rechaza ids y señales inexistentes sin tocar nada y deja las señales pendientes", async () => {
		const ids = await dosSenales();
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "modificar", id: "no-existe", texto: "x", senales: ids }], resumen: "" }));
		await cron(mundo);
		const est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado");
		expect(est.error).toMatch(/no existe ningún criterio/);
		expect(est.pendientes).toBe(2);
		expect((await llamar(mundo, ADMIN, "ajustes/get")).gastoMes).toBe(0.25); // la llamada se cobra igual
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "añadir", texto: "x", tema: "y", senales: ["fantasma"] }], resumen: "" }));
		await cron(mundo);
		expect((await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).error).toMatch(/señal «fantasma» no existe/);
		expect(await filas(mundo, "aprendizajes")).toHaveLength(0);
	});

	it("respeta el tope de gasto, la falta de clave y el ajuste desactivado: no llama y las señales se acumulan", async () => {
		await dosSenales();
		await llamar(mundo, ADMIN, "ajustes/guardar", { topeMensualUsd: 1 });
		await mundo.kv.set(`gasto:${new Date().toISOString().slice(0, 7)}`, 1.5);
		await cron(mundo);
		expect(mockApi).not.toHaveBeenCalled();
		let est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado");
		expect(est).toMatchObject({ parado: "tope", pendientes: 2 });
		expect((await llamar(mundo, ADMIN, "aprendizaje/actualizar")).motivo).toBe("tope");

		await llamar(mundo, ADMIN, "ajustes/guardar", { topeMensualUsd: 0 });
		delete process.env.ANTHROPIC_API_KEY;
		await cron(mundo);
		expect(mockApi).not.toHaveBeenCalled();
		est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado");
		expect(est).toMatchObject({ parado: "sin_clave", pendientes: 2, apiDisponible: false });
		expect((await llamar(mundo, ADMIN, "aprendizaje/actualizar")).motivo).toBe("sin_clave");

		process.env.ANTHROPIC_API_KEY = "sk-test";
		await llamar(mundo, ADMIN, "ajustes/guardar", { aprenderAuto: false });
		await cron(mundo);
		expect(mockApi).not.toHaveBeenCalled();
		expect((await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).parado).toBe("desactivado");
		// «Actualizar ahora» funciona aunque el automático esté apagado
		const r = await llamar(mundo, ADMIN, "aprendizaje/actualizar");
		expect(r.programado).toBe(true);
		const ahora = mundo.cron.find((c) => c.name === "aprendizaje-ahora")!;
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [], resumen: "Nada general." }));
		await cron(mundo, ahora.name);
		expect(mockApi).toHaveBeenCalledOnce();
		expect((await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).pendientes).toBe(0);
	});

	it("un criterio retirado a mano sale de la guía, se pasa como retirado al modelo y no se recupera sin una señal general", async () => {
		const ids = await dosSenales();
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "añadir", texto: "Usa comillas latinas.", tema: "Estilo", senales: ids }], resumen: "" }));
		await cron(mundo);
		const [a] = (await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).aprendizajes;
		const est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/retirar", { id: a!.id });
		expect(est.aprendizajes[0]).toMatchObject({ estado: "retirado", retiradoPor: "Andrés" });
		expect((await col<GuiaDoc>(mundo, "guias").get("aprendido"))!.markdown).not.toContain("comillas latinas");

		await comentar(mundo, ART, { texto: "Comillas latinas otra vez" });
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "modificar", id: a!.id, texto: "Usa comillas latinas.", senales: [] }], resumen: "" }));
		await cron(mundo);
		const entrada = mockApi.mock.calls[1]![0];
		expect(entrada.aprendizajes).toEqual([
			expect.objectContaining({ id: a!.id, estado: "retirado", retiradoPor: "Andrés", articulos: 2 }),
		]);
		// «modificar» sin señales no pasa la validación; con una señal no general, tampoco recupera el criterio.
		expect((await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).error).toMatch(/al menos una señal/);
		const pendiente = (await senales(mundo)).find((s) => !s.data.procesada)!.id;
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "modificar", id: a!.id, senales: [pendiente] }], resumen: "" }));
		await cron(mundo);
		expect((await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/estado")).error).toMatch(/lo retiró una persona/);
		// Con una señal general, sí.
		await comentar(mundo, ART2, { texto: "Siempre comillas latinas", general: true });
		const general = (await senales(mundo)).find((s) => s.data.general)!.id;
		mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "modificar", id: a!.id, senales: [general] }], resumen: "" }));
		await cron(mundo);
		expect((await col<AprendizajeDoc>(mundo, "aprendizajes").get(a!.id))!.estado).toBe("activo");
	});

	it("el historial guarda las últimas 20 versiones y restaurar repone criterios y guía", async () => {
		for (let i = 0; i < 23; i++) {
			await comentar(mundo, ART, { texto: `Corrección ${i}`, general: true });
			const id = (await senales(mundo)).find((s) => !s.data.procesada)!.id;
			mockApi.mockResolvedValueOnce(respuesta({ operaciones: [{ op: "añadir", texto: `Regla ${i}.`, tema: "Varias", senales: [id] }], resumen: `Regla ${i}` }, 0));
			await cron(mundo);
		}
		const { versiones } = await llamar(mundo, ADMIN, "aprendizaje/historial");
		expect(versiones).toHaveLength(20);
		// La más reciente es la versión con 22 criterios (antes de añadir la regla 22).
		expect(versiones[0].criterios).toBe(22);
		expect(versiones[0].resumen).toMatch(/Regla 22/);
		const v3 = versiones.find((v: { criterios: number }) => v.criterios === 3);
		const est = await llamar<EstadoAprendizajeVista>(mundo, ADMIN, "aprendizaje/restaurar", { id: v3.id });
		expect(est.aprendizajes.filter((a) => a.estado === "activo")).toHaveLength(3);
		const guia = (await col<GuiaDoc>(mundo, "guias").get("aprendido"))!;
		expect(guia.markdown).toContain("Regla 2.");
		expect(guia.markdown).not.toContain("Regla 3.");
		// Restaurar también guarda la versión actual (se puede deshacer)
		const despues = (await llamar(mundo, ADMIN, "aprendizaje/historial")).versiones;
		expect(despues).toHaveLength(20);
		expect(despues[0].criterios).toBe(23);
		expect(despues[0].resumen).toMatch(/Antes de restaurar/);
	});
});

describe("motor B: aprendizaje con Claude Code por MCP", () => {
	it("pendiente devuelve el lote con instrucciones; aplicar valida, aplica y marca el lote", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		expect(await llamar(mundo, ADMIN, "mcp/aprendizaje-pendiente")).toEqual({ vacio: true, pendientes: 0 });
		await comentar(mundo);
		await comentar(mundo, ART, { texto: "Otra cosa puntual" });
		const r = await llamar(mundo, ADMIN, "mcp/aprendizaje-pendiente");
		expect(r.lote).toHaveLength(2);
		expect(r.entrada.senales[0]).toMatchObject({ tipo: "comentario", titulo: "Qué es la menopausia" });
		expect(r.entrada.senales[0].userId).toBeUndefined();
		expect(r.instrucciones).toMatch(/revision_aprendizaje_aplicar/);

		await expect(
			llamar(mundo, ADMIN, "mcp/aprendizaje-aplicar", { operaciones: [{ op: "retirar", id: "nada", senales: [] }], resumen: "" }),
		).rejects.toThrow(/no existe ningún criterio/);
		await expect(
			llamar(mundo, ADMIN, "mcp/aprendizaje-aplicar", { operaciones: [{ op: "añadir", texto: "x".repeat(600), tema: "t", senales: [r.lote[0]] }], resumen: "" }),
		).rejects.toThrow(/menos de 600/);

		const res = await llamar(mundo, ADMIN, "mcp/aprendizaje-aplicar", {
			operaciones: [{ op: "añadir", id: null, texto: "Regla.", tema: "Tono", senales: [r.lote[0]] }],
			resumen: "Una regla.",
		});
		expect(res).toMatchObject({ añadidos: 1, procesadas: 2 });
		expect((await senales(mundo)).every((s) => s.data.procesada)).toBe(true);
		const aud = (await filas<AuditoriaDoc>(mundo, "auditoria")).find((a) => a.data.accion === "aprender")!;
		expect(aud.data.userId).toBe(ADMIN.id);
		expect(aud.data.detalle).toMatch(/^claude_code:/);
	});
});

describe("cron del aprendizaje y permisos", () => {
	it("se registra a diario a la hora de los ajustes y al instalar", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		await llamar(mundo, EDITORA, "inicio");
		expect(mundo.cron).toEqual([{ name: "aprendizaje", schedule: "0 3 * * *" }]);
		await llamar(mundo, EDITORA, "inicio");
		expect(mundo.cron).toHaveLength(1);
		await llamar(mundo, ADMIN, "ajustes/guardar", { horaAprendizaje: 5 });
		expect(mundo.cron.at(-1)).toEqual({ name: "aprendizaje", schedule: "0 5 * * *" });
		const h = plugin.hooks["plugin:activate"] as { handler: (e: unknown, c: unknown) => Promise<void> };
		expect(h).toBeDefined();
		await expect(llamar(mundo, ADMIN, "ajustes/guardar", { horaAprendizaje: 24 })).rejects.toThrow();
	});

	it("las rutas del aprendizaje son de administración; la casilla va en comentarios/crear (revisora)", async () => {
		for (const r of [
			"aprendizaje/estado",
			"aprendizaje/actualizar",
			"aprendizaje/retirar",
			"aprendizaje/historial",
			"aprendizaje/restaurar",
			"mcp/aprendizaje-pendiente",
			"mcp/aprendizaje-aplicar",
		]) {
			expect(plugin.routes[r]?.permission, r).toBe("plugins:manage");
		}
		expect(plugin.routes["comentarios/crear"]?.permission).toBe("plugins:read");
		expect(() => plugin.routes["comentarios/crear"]!.input!.parse({ ...ART, texto: "x", ancla: null, general: true })).not.toThrow();
	});
});

describe("validarSalidaAprendizaje", () => {
	it("normaliza nulos y exige lo necesario en cada operación", () => {
		expect(
			validarSalidaAprendizaje({
				operaciones: [
					{ op: "añadir", id: null, texto: " Regla. ", tema: "Tono", senales: ["s1", "s1"] },
					{ op: "modificar", id: "a1", texto: null, tema: null, senales: ["s2"] },
					{ op: "retirar", id: "a2", texto: null, tema: null, senales: [] },
				],
				resumen: " Hecho. ",
			}),
		).toEqual({
			operaciones: [
				{ op: "añadir", texto: "Regla.", tema: "Tono", senales: ["s1"] },
				{ op: "modificar", id: "a1", senales: ["s2"] },
				{ op: "retirar", id: "a2", senales: [] },
			],
			resumen: "Hecho.",
		});
		expect(() => validarSalidaAprendizaje({ operaciones: [{ op: "añadir", id: null, texto: "", tema: "x", senales: ["s"] }], resumen: "" })).toThrow(
			/necesita «texto»/,
		);
		expect(() => validarSalidaAprendizaje({ operaciones: [{ op: "borrar", senales: [] }], resumen: "" })).toThrow(/debe ser una de/);
		expect(() => validarSalidaAprendizaje({ operaciones: [], resumen: "", extra: 1 })).toThrow(/desconocido/);
	});
});
