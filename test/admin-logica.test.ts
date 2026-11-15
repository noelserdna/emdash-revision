import { describe, expect, it } from "vitest";

import {
	accionesBarra,
	agruparInicio,
	type EntradaBarra,
	etiquetaRevision,
	familiaFuente,
	hrefSeguro,
	idUnidad,
	intervaloSondeo,
	offsetAbsoluto,
	porcentajeLeido,
	recortarRango,
	refDeId,
	seleccionAOffsets,
	trocearSpans,
} from "../src/admin/logica.js";
import type { ArticuloFila, TrabajoVista } from "../src/lib/types.js";

describe("unidades", () => {
	it("idUnidad y refDeId van y vuelven", () => {
		const ref = { campo: "content" as const, blockKey: "abc", ruta: "r1/c2" };
		expect(refDeId(idUnidad(ref))).toEqual(ref);
		expect(refDeId(idUnidad({ campo: "title" }))).toEqual({ campo: "title" });
		expect(refDeId("otro||")).toBeNull();
	});
});

describe("hrefSeguro", () => {
	it("acepta http, https, mailto y relativos", () => {
		expect(hrefSeguro("https://ejemplo.es/a")).toBe("https://ejemplo.es/a");
		expect(hrefSeguro("http://x.es")).toBe("http://x.es");
		expect(hrefSeguro("mailto:hola@x.es")).toBe("mailto:hola@x.es");
		expect(hrefSeguro("/articulos/uno")).toBe("/articulos/uno");
		expect(hrefSeguro("#fuentes")).toBe("#fuentes");
		expect(hrefSeguro("otra-pagina")).toBe("otra-pagina");
	});
	it("rechaza esquemas peligrosos, también ofuscados", () => {
		expect(hrefSeguro("javascript:alert(1)")).toBeNull();
		expect(hrefSeguro("JavaScript:alert(1)")).toBeNull();
		expect(hrefSeguro(" java\tscript:alert(1)")).toBeNull();
		expect(hrefSeguro("data:text/html,<b>")).toBeNull();
		expect(hrefSeguro("vbscript:x")).toBeNull();
		expect(hrefSeguro("//malo.com")).toBeNull();
		expect(hrefSeguro(undefined)).toBeNull();
		expect(hrefSeguro("")).toBeNull();
	});
	it("sin mailto para imágenes", () => {
		expect(hrefSeguro("mailto:a@b.es", false)).toBeNull();
	});
});

describe("familiaFuente", () => {
	it("entrecomilla un nombre y añade reserva", () => {
		expect(familiaFuente("Source Sans 3", "sans-serif")).toBe('"Source Sans 3", sans-serif');
		expect(familiaFuente("Fraunces, Georgia, serif", "x")).toBe("Fraunces, Georgia, serif");
	});
	it("rechaza CSS inyectado", () => {
		expect(familiaFuente("x; background:url(a)", "s")).toBeNull();
		expect(familiaFuente("a}b{", "s")).toBeNull();
		expect(familiaFuente(null, "s")).toBeNull();
	});
});

describe("offsets de selección", () => {
	it("offsetAbsoluto suma las longitudes previas", () => {
		expect(offsetAbsoluto([3, 4, 5], 0, 2)).toBe(2);
		expect(offsetAbsoluto([3, 4, 5], 2, 1)).toBe(8);
		expect(offsetAbsoluto([3, 4, 5], 1, 99)).toBe(7);
	});
	it("recortarRango quita espacios y ordena", () => {
		expect(recortarRango("  hola  ", 0, 8)).toEqual({ inicio: 2, fin: 6 });
		expect(recortarRango("abc", 3, 1)).toEqual({ inicio: 1, fin: 3 });
		expect(recortarRango("   ", 0, 3)).toBeNull();
	});
	it("seleccionAOffsets cruza nodos de texto (marcas de resaltado partidas)", () => {
		// «La dosis es de » + «2 mg» (resaltado) + « al día.»
		const textos = ["La dosis es de ", "2 mg", " al día."];
		const r = seleccionAOffsets(textos, { indice: 0, offset: 12 }, { indice: 2, offset: 7 });
		expect(r).toEqual({ inicio: 12, fin: 26, cita: "de 2 mg al día" });
		expect(textos.join("").slice(r?.inicio, r?.fin)).toBe(r?.cita);
	});
	it("seleccionAOffsets con extremos invertidos", () => {
		const r = seleccionAOffsets(["abcdef"], { indice: 0, offset: 4 }, { indice: 0, offset: 1 });
		expect(r).toEqual({ inicio: 1, fin: 4, cita: "bcd" });
	});
});

describe("trocearSpans", () => {
	it("no altera el texto y marca los trozos", () => {
		const textos = ["Hola ", "mundo cruel", "."];
		const t = trocearSpans(textos, [
			{ inicio: 3, fin: 8, clase: "frag" },
			{ inicio: 3, fin: 8, clase: "activo" },
		]);
		expect(t.map((x) => x.texto).join("")).toBe(textos.join(""));
		const marcados = t.filter((x) => x.frag).map((x) => x.texto).join("");
		expect(marcados).toBe("a mun");
		expect(t.filter((x) => x.activo).map((x) => x.texto).join("")).toBe("a mun");
		expect(t.every((x) => textos[x.span]?.includes(x.texto))).toBe(true);
	});
	it("sin rangos devuelve un trozo por span", () => {
		expect(trocearSpans(["a", "b"], [])).toHaveLength(2);
	});
});

const trabajo = (estado: TrabajoVista["estado"]): TrabajoVista => ({
	id: "t",
	motor: "local",
	estado,
	modelo: null,
	creado: "2026-11-15T10:00:00Z",
	terminado: null,
	error: null,
	costeEstimado: null,
});

const fila = (p: Partial<ArticuloFila>): ArticuloFila => ({
	collection: "posts",
	id: p.id ?? "x",
	slug: null,
	titulo: p.id ?? "x",
	publicacion: "sin_publicar",
	estado: "por_revisar",
	vuelta: 0,
	abiertos: 0,
	preguntasPendientes: 0,
	cambiosPendientes: 0,
	aprobacion: null,
	trabajo: null,
	minutosLectura: 5,
	actualizado: "",
	leido: 0,
	...p,
});

describe("agruparInicio", () => {
	it("agrupa por lo que toca y pone primero los publicados", () => {
		const g = agruparInicio([
			fila({ id: "a" }),
			fila({ id: "b", publicacion: "publicado" }),
			fila({ id: "c", estado: "cambios_por_ver" }),
			fila({ id: "d", estado: "con_comentarios", abiertos: 2, trabajo: trabajo("cola") }),
			fila({ id: "e", estado: "aprobado" }),
			fila({ id: "f", estado: "con_comentarios", abiertos: 1 }),
		]);
		expect(g.porRevisar.map((f) => f.id)).toEqual(["b", "a", "f"]);
		expect(g.cambios.map((f) => f.id)).toEqual(["c"]);
		expect(g.esperando.map((f) => f.id)).toEqual(["d"]);
		expect(g.aprobados.map((f) => f.id)).toEqual(["e"]);
	});
	it("filtro «Necesitan corrección»", () => {
		const g = agruparInicio(
			[fila({ id: "a" }), fila({ id: "f", estado: "con_comentarios", abiertos: 1 }), fila({ id: "d", abiertos: 2, trabajo: trabajo("en_curso") })],
			true,
		);
		expect([...g.porRevisar, ...g.esperando].map((f) => f.id)).toEqual(["f"]);
	});
});

describe("etiquetaRevision", () => {
	it("usa icono y texto, y el trabajo activo manda", () => {
		expect(etiquetaRevision({ estado: "con_comentarios", aprobacion: null, trabajo: trabajo("cola") }).texto).toBe("Esperando corrección");
		const ap = { draftRevisionId: null, hash: "h", userId: "u", nombre: "Isabel", fecha: "" };
		expect(etiquetaRevision({ estado: "aprobado", aprobacion: ap, trabajo: null }).texto).toBe("Aprobado por Isabel");
		expect(etiquetaRevision({ estado: "aprobado", aprobacion: { ...ap, cambiadoDespues: true }, trabajo: null }).icono).toBe("alerta");
	});
});

describe("accionesBarra", () => {
	const base: EntradaBarra = {
		estado: "por_revisar",
		abiertos: 0,
		completada: false,
		cambiosPendientes: 0,
		hayNoEsEsto: false,
		trabajoActivo: false,
		puedeAprobar: true,
		esAdmin: false,
		haySiguiente: true,
	};
	it("sin terminar de leer: seguir leyendo, aprobar en el menú", () => {
		const a = accionesBarra(base);
		expect(a.principal).toBe("seguir_leyendo");
		expect(a.menu).toContain("aprobar");
	});
	it("nunca ofrece aprobar como principal antes de leer", () => {
		expect(accionesBarra({ ...base, completada: false }).principal).not.toBe("aprobar");
	});
	it("leído sin comentarios: aprobar", () => {
		expect(accionesBarra({ ...base, completada: true }).principal).toBe("aprobar");
	});
	it("con comentarios: he terminado", () => {
		const a = accionesBarra({ ...base, abiertos: 3 });
		expect(a.principal).toBe("he_terminado");
		expect(a.menu).toContain("aprobar_igualmente");
	});
	it("cambios por ver", () => {
		expect(accionesBarra({ ...base, estado: "cambios_por_ver", cambiosPendientes: 2 }).principal).toBe("cambio_siguiente");
		expect(accionesBarra({ ...base, estado: "cambios_por_ver", hayNoEsEsto: true }).principal).toBe("enviar_otra_vez");
		expect(accionesBarra({ ...base, estado: "cambios_por_ver" }).principal).toBe("aprobar");
	});
	it("aprobado: siguiente; publicar y retirar en el menú", () => {
		const a = accionesBarra({ ...base, estado: "aprobado" });
		expect(a.principal).toBe("siguiente");
		expect(a.menu).toEqual(expect.arrayContaining(["publicar", "retirar"]));
	});
	it("sin permiso de aprobar no aparece aprobar", () => {
		const a = accionesBarra({ ...base, puedeAprobar: false, completada: true });
		expect(a.principal).toBe("siguiente");
		expect(a.menu).not.toContain("aprobar");
	});
	it("administrador: corregir con la IA y Claude Code", () => {
		const a = accionesBarra({ ...base, esAdmin: true, abiertos: 1 });
		expect(a.menu).toEqual(expect.arrayContaining(["corregir_ia", "claude_code", "publicar"]));
	});
	it("con trabajo en curso no se lanza otro", () => {
		const a = accionesBarra({ ...base, esAdmin: true, abiertos: 1, trabajoActivo: true });
		expect(a.principal).not.toBe("he_terminado");
		expect(a.menu).not.toContain("corregir_ia");
	});
});

describe("progreso y sondeo", () => {
	it("porcentajeLeido no llega a 100 sin completar", () => {
		expect(porcentajeLeido(10, 10, false)).toBe(99);
		expect(porcentajeLeido(4, 10, false)).toBe(40);
		expect(porcentajeLeido(0, 10, true)).toBe(100);
	});
	it("sondea cada 5 s y cada 15 s pasados 2 minutos", () => {
		expect(intervaloSondeo(10_000)).toBe(5_000);
		expect(intervaloSondeo(130_000)).toBe(15_000);
	});
});
