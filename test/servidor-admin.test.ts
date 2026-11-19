import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/motor-api.js", async (original) => {
	const real = await original<typeof import("../src/lib/motor-api.js")>();
	return { ...real, corregirConApi: vi.fn() };
});

import { corregirConApi, ErrorMotor } from "../src/lib/motor-api.js";
import type { ArticuloVista, InicioVista } from "../src/lib/types.js";
import { ADMIN, AUTORA, EDITORA, datosEjemplo, makeMundo, makePlugin, type MemoryCollection, type Mundo } from "./helpers.js";

const { plugin, llamar, hook } = makePlugin();
const ART = { collection: "posts", id: "p1" };
const CITA_B3 = "Los sofocos afectan a muchas mujeres y suelen durar varios años.";

describe("preguntas", () => {
	let mundo: Mundo;
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo(), { slug: "que-es" });
		mundo.content.add("posts", "p2", { ...datosEjemplo(), title: "Sofocos" }, { slug: "sofocos" });
		mundo.content.add("posts", "p3", { ...datosEjemplo(), title: "Sueño" }, { slug: "sueno" });
	});

	async function importar() {
		return llamar(mundo, ADMIN, "preguntas/importar", {
			preguntas: [
				{
					pregunta: "¿Es correcto decir «suelen durar varios años»?",
					entradas: [
						{ collection: "posts", slug: "que-es", cita: "suelen durar varios años" },
						{ collection: "posts", id: "p2", cita: "texto que no existe" },
					],
				},
				{ pregunta: "¿Citamos la guía de la SEGO de 2024?", entradas: [{ collection: "posts", slug: "sueno" }] },
			],
		});
	}

	it("se importan, se colocan por cita y aparecen en el inicio", async () => {
		const r = await importar();
		expect(r).toEqual({ creadas: 2, sinColocar: 2 });
		// Reimportar no duplica
		expect(await importar()).toEqual({ creadas: 0, sinColocar: 0 });
		const ini = await llamar<InicioVista>(mundo, EDITORA, "inicio");
		expect(ini.preguntas).toHaveLength(2);
		const p = ini.preguntas[0]!;
		expect(p.entradas.map((e) => e.titulo).sort()).toEqual(["Qué es la menopausia", "Sofocos"]);
		expect(p.entradas.find((e) => e.id === "p1")?.cita).toBe("suelen durar varios años");
		expect(ini.articulos.find((a) => a.id === "p1")?.preguntasPendientes).toBe(1);
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.comentarios[0]?.ancla?.blockKey).toBe("b3");
	});

	it("«Es correcto» las descarta; «Cámbialo» las convierte en comentarios abiertos", async () => {
		await importar();
		const ini = await llamar<InicioVista>(mundo, EDITORA, "inicio");
		const [p1, p2] = ini.preguntas;
		const r1 = await llamar(mundo, EDITORA, "preguntas/responder", { reglaId: p1!.reglaId, tipo: "correcto" });
		expect(r1.pregunta.respuesta.tipo).toBe("correcto");
		let v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.comentarios[0]?.estado).toBe("descartado");
		expect(v.revision.preguntasPendientes).toBe(0);
		expect(v.revision.estado).toBe("por_revisar");
		await expect(llamar(mundo, EDITORA, "preguntas/responder", { reglaId: p1!.reglaId, tipo: "quitar" })).rejects.toThrow(/respondida/);

		await expect(llamar(mundo, EDITORA, "preguntas/responder", { reglaId: p2!.reglaId, tipo: "cambiar" })).rejects.toThrow(/Escribe/);
		await llamar(mundo, EDITORA, "preguntas/responder", { reglaId: p2!.reglaId, tipo: "luego" });
		expect((await llamar<InicioVista>(mundo, EDITORA, "inicio")).preguntas).toHaveLength(1);
		await llamar(mundo, EDITORA, "preguntas/responder", { reglaId: p2!.reglaId, tipo: "cambiar", texto: "Cita la guía de 2024" });
		v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", { collection: "posts", id: "p3" });
		expect(v.comentarios[0]).toMatchObject({ tipo: "comentario", estado: "abierto", texto: "Cita la guía de 2024" });
		expect(v.revision.estado).toBe("con_comentarios");
		// Las reglas respondidas llegan a la IA
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", { collection: "posts", id: "p3" });
		const r = await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		expect(r.entrada.reglas.map((x: { pregunta: string }) => x.pregunta)).toEqual(
			expect.arrayContaining(["¿Es correcto decir «suelen durar varios años»?", "¿Citamos la guía de la SEGO de 2024?"]),
		);
	});
});

describe("volumen", () => {
	it("más de 100 comentarios en un artículo se cuentan y se listan todos", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		for (let i = 0; i < 130; i++) {
			await llamar(mundo, EDITORA, "comentarios/crear", {
				...ART,
				texto: `Comentario ${i}`,
				ancla: { campo: "content", blockKey: "b3", cita: CITA_B3 },
			});
		}
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.comentarios).toHaveLength(130);
		expect(v.revision.abiertos).toBe(130);
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		const r = await llamar(mundo, ADMIN, "mcp/reclamar", { trabajoId: trabajo.id });
		expect(r.entrada.comentarios).toHaveLength(130);
	});
});

describe("permisos", () => {
	const ADMIN_RUTAS = [
		"trabajo/crear",
		"trabajo/cancelar",
		"trabajo/aplicar-pendiente",
		"guias/listar",
		"guias/guardar",
		"guias/borrar",
		"ajustes/get",
		"ajustes/guardar",
		"ajustes/clave",
		"ajustes/clave-borrar",
		"preguntas/importar",
		"mcp/cola",
		"mcp/reclamar",
		"mcp/articulo",
		"mcp/entregar",
		"editor/importar",
		"aprendizaje/estado",
		"aprendizaje/actualizar",
		"aprendizaje/retirar",
		"aprendizaje/historial",
		"aprendizaje/restaurar",
		"mcp/aprendizaje-pendiente",
		"mcp/aprendizaje-aplicar",
	];

	it("cada ruta declara su permiso: plugins:manage para administración, plugins:read para la revisora", () => {
		for (const [nombre, ruta] of Object.entries(plugin.routes)) {
			expect(ruta.permission, nombre).toBe(ADMIN_RUTAS.includes(nombre) ? "plugins:manage" : "plugins:read");
		}
		expect(Object.keys(plugin.routes)).toHaveLength(45);
	});

	it("las herramientas MCP apuntan a rutas de administración y solo las que escriben son destructivas", () => {
		const tools = plugin.mcp!.tools;
		expect(Object.keys(tools).sort()).toEqual([
			"revision_aprendizaje_aplicar",
			"revision_aprendizaje_pendiente",
			"revision_articulo",
			"revision_cola",
			"revision_entregar",
			"revision_reclamar",
		]);
		for (const t of Object.values(tools)) expect(plugin.routes[t.route]?.permission).toBe("plugins:manage");
		expect(tools.revision_entregar!.destructive).toBe(true);
		expect(tools.revision_aprendizaje_aplicar!.destructive).toBe(true);
		expect(tools.revision_aprendizaje_pendiente!.destructive).toBe(false);
		expect(tools.revision_cola!.destructive).toBe(false);
	});

	it("capacidades, hosts y timeout del cron", () => {
		expect(plugin.capabilities).toEqual(expect.arrayContaining(["content:publish", "users:read", "email:send", "network:request"]));
		expect(plugin.allowedHosts).toEqual(["api.anthropic.com"]);
		expect(plugin.hooks.cron?.timeout).toBe(9 * 60 * 1000);
	});

	it("aprobar exige el rol configurado; publicar exige rol de editora", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		await expect(llamar(mundo, AUTORA, "revision/aprobar", { ...ART, confirmar: true })).rejects.toThrow(/permiso/);
		await llamar(mundo, ADMIN, "ajustes/guardar", { rolAprueba: 50 });
		await expect(llamar(mundo, EDITORA, "revision/aprobar", { ...ART, confirmar: true })).rejects.toThrow(/permiso/);
		expect((await llamar(mundo, ADMIN, "revision/aprobar", { ...ART, confirmar: true })).revision.estado).toBe("aprobado");
		await expect(llamar(mundo, AUTORA, "revision/publicar", { ...ART, confirmar: true })).rejects.toThrow(/permiso/);
		await expect(llamar(mundo, null, "inicio")).rejects.toThrow(/usuario/);
	});

	it("solo la autora o un admin edita o borra un comentario", async () => {
		const mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		const { comentario } = await llamar(mundo, ADMIN, "comentarios/crear", { ...ART, texto: "Del admin", ancla: null });
		expect(comentario.editable).toBe(true);
		await expect(llamar(mundo, EDITORA, "comentarios/editar", { id: comentario.id, texto: "x" })).rejects.toThrow(/Solo quien/);
		await expect(llamar(mundo, EDITORA, "comentarios/borrar", { id: comentario.id })).rejects.toThrow(/Solo quien/);
		const v = await llamar<ArticuloVista>(mundo, EDITORA, "articulo/get", ART);
		expect(v.comentarios[0]?.editable).toBe(false);
	});
});

describe("motor A (API) y tope de gasto", () => {
	let mundo: Mundo;
	const mockApi = vi.mocked(corregirConApi);
	beforeEach(() => {
		mundo = makeMundo();
		mundo.content.add("posts", "p1", datosEjemplo());
		process.env.ANTHROPIC_API_KEY = "sk-test";
		mockApi.mockReset();
	});
	afterEach(() => {
		delete process.env.ANTHROPIC_API_KEY;
	});

	it("crea el trabajo, lo programa por cron y el hook entrega la corrección", async () => {
		const { comentario } = await llamar(mundo, EDITORA, "comentarios/crear", {
			...ART,
			texto: "Más claro",
			ancla: { campo: "content", blockKey: "b3", cita: CITA_B3 },
		});
		mockApi.mockResolvedValue({
			salida: {
				ops: [{ op: "reemplazar", blockKey: "b3", markdown: "Los sofocos son frecuentes y pueden durar años.", comentarioIds: [comentario.id] }],
				resoluciones: [{ comentarioId: comentario.id, accion: "aplicado", nota: "Más claro" }],
			},
			usage: { input_tokens: 1000, output_tokens: 200 },
			coste: 0.5,
			modelo: "claude-haiku-5-5",
		});
		const { trabajo } = await llamar(mundo, ADMIN, "trabajo/crear", { ...ART, motor: "api", modelo: "claude-haiku-5-5", esfuerzo: "low" });
		expect(trabajo.estado).toBe("cola");
		expect(mundo.cron).toHaveLength(1);
		expect(mundo.cron[0]!.name).toBe(`trabajo-${trabajo.id}`);
		expect(Number.isNaN(Date.parse(mundo.cron[0]!.schedule))).toBe(false);
		await expect(llamar(mundo, ADMIN, "trabajo/crear", { ...ART, motor: "local" })).rejects.toThrow(/en marcha/);

		await hook("cron", mundo, { name: mundo.cron[0]!.name, data: mundo.cron[0]!.data, scheduledAt: mundo.cron[0]!.schedule });
		expect(mockApi).toHaveBeenCalledOnce();
		expect(mockApi.mock.calls[0]![1]).toMatchObject({ apiKey: "sk-test", modelo: "claude-haiku-5-5", esfuerzo: "low" });
		const est = await llamar(mundo, EDITORA, "trabajo/estado", ART);
		expect(est.trabajo).toMatchObject({ estado: "hecho", costeEstimado: 0.5 });
		expect(est.revision.estado).toBe("cambios_por_ver");
		expect((await llamar(mundo, ADMIN, "ajustes/get")).gastoMes).toBe(0.5);
	});

	it("un error del motor deja el trabajo en error con mensaje", async () => {
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "x", ancla: null });
		mockApi.mockRejectedValue(new ErrorMotor("El modelo se negó a corregir.", "rechazo"));
		const { trabajo } = await llamar(mundo, ADMIN, "trabajo/crear", { ...ART, motor: "api" });
		await hook("cron", mundo, { name: `trabajo-${trabajo.id}`, data: { trabajoId: trabajo.id }, scheduledAt: "" });
		const est = await llamar(mundo, EDITORA, "trabajo/estado", ART);
		expect(est.trabajo).toMatchObject({ estado: "error", error: "El modelo se negó a corregir." });
	});

	it("el tope mensual bloquea la API y «He terminado» cae a la cola local", async () => {
		await llamar(mundo, ADMIN, "ajustes/guardar", { topeMensualUsd: 1, motorHeTerminado: "api" });
		const clave = `gasto:${new Date().toISOString().slice(0, 7)}`;
		await mundo.kv.set(clave, 1.2);
		await expect(llamar(mundo, ADMIN, "trabajo/crear", { ...ART, motor: "api" })).rejects.toThrow(/tope/);
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "x", ancla: null });
		const { trabajo } = await llamar(mundo, EDITORA, "revision/terminar", ART);
		expect(trabajo.motor).toBe("local");
		expect(mundo.cron).toHaveLength(0);
	});

	it("sin clave, la API no está disponible", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		await expect(llamar(mundo, ADMIN, "trabajo/crear", { ...ART, motor: "api" })).rejects.toThrow(/clave/);
		expect((await llamar(mundo, ADMIN, "ajustes/get")).apiDisponible).toBe(false);
	});

	it("«He terminado» avisa por correo al administrador y tolera la falta de transporte", async () => {
		await llamar(mundo, ADMIN, "ajustes/guardar", { avisarA: "andres@ejemplo.es" });
		await llamar(mundo, EDITORA, "comentarios/crear", { ...ART, texto: "x", ancla: null });
		await llamar(mundo, EDITORA, "revision/terminar", ART);
		expect(mundo.correos.at(-1)).toMatchObject({ to: "andres@ejemplo.es" });

		const sinCorreo = makeMundo({ conCorreo: false });
		sinCorreo.content.add("posts", "p1", datosEjemplo());
		await llamar(sinCorreo, ADMIN, "ajustes/guardar", { avisarA: "andres@ejemplo.es" });
		await llamar(sinCorreo, EDITORA, "comentarios/crear", { ...ART, texto: "x", ancla: null });
		const r = await llamar(sinCorreo, EDITORA, "revision/terminar", ART);
		expect(r.trabajo.estado).toBe("cola");
	});
});

describe("guías y ajustes", () => {
	it("guardar, listar en orden y borrar guías; ajustes fusionados", async () => {
		const mundo = makeMundo();
		const g2 = await llamar(mundo, ADMIN, "guias/guardar", { nombre: "Adenda", markdown: "# B", orden: 2 });
		await llamar(mundo, ADMIN, "guias/guardar", { nombre: "Guía", markdown: "# A", orden: 1 });
		expect((await llamar(mundo, ADMIN, "guias/listar")).guias.map((g: { nombre: string }) => g.nombre)).toEqual(["Guía", "Adenda"]);
		await llamar(mundo, ADMIN, "guias/borrar", { id: g2.guia.id });
		expect((await llamar(mundo, ADMIN, "guias/listar")).guias).toHaveLength(1);
		const a = await llamar(mundo, ADMIN, "ajustes/guardar", { adminNombre: "Andrés" });
		expect(a.ajustes).toMatchObject({ adminNombre: "Andrés", modeloDefecto: "claude-opus-5-5" });
		expect(a.mcpUrl).toBe("https://test.local/_emdash/api/mcp");
		expect(a.modelos.length).toBeGreaterThan(0);
		const store = mundo.storage.guias as MemoryCollection<unknown>;
		expect(store.size()).toBe(1);
	});
});
