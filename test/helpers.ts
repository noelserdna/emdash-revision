/**
 * Fakes para los tests del servidor: StorageCollection en memoria con las
 * reglas del host (solo campos indexados en where/orderBy, máximo 100 filas,
 * revisiones), KV, contenido con borrador y publicación, usuarios, cron y correo.
 */

import type { PluginContext, PluginContentItem, RouteContext, StorageCollection } from "emdash";

import { createPlugin } from "../src/plugin.js";
import type { RevisionPluginOptions } from "../src/index.js";
import { STORAGE } from "../src/lib/store.js";
import type { PTNode } from "../src/lib/types.js";

type Where = Record<string, unknown>;

function indexedFields(indexes: Array<string | string[]>): Set<string> {
	const set = new Set<string>();
	for (const i of indexes) {
		if (typeof i === "string") set.add(i);
		else for (const f of i) set.add(f);
	}
	return set;
}

function matches(doc: Record<string, unknown>, where: Where): boolean {
	for (const [field, cond] of Object.entries(where)) {
		const value = doc[field];
		if (cond !== null && typeof cond === "object") {
			const c = cond as Record<string, unknown>;
			if ("in" in c) {
				if (!(c.in as unknown[]).includes(value)) return false;
				continue;
			}
			if ("startsWith" in c) {
				if (typeof value !== "string" || !value.startsWith(String(c.startsWith))) return false;
				continue;
			}
			if ("gt" in c && !((value as never) > (c.gt as never))) return false;
			if ("gte" in c && !((value as never) >= (c.gte as never))) return false;
			if ("lt" in c && !((value as never) < (c.lt as never))) return false;
			if ("lte" in c && !((value as never) <= (c.lte as never))) return false;
			continue;
		}
		if (value !== cond) return false;
	}
	return true;
}

export class MemoryCollection<T> implements StorageCollection<T> {
	private rows = new Map<string, { data: T; rev: number }>();
	private readonly indexed: Set<string>;

	constructor(indexes: Array<string | string[]> = []) {
		this.indexed = indexedFields(indexes);
	}

	private assertIndexed(fields: string[]): void {
		for (const f of fields) {
			if (!this.indexed.has(f)) throw new Error(`Campo no indexado en where/orderBy: ${f}`);
		}
	}

	async get(id: string): Promise<T | null> {
		return this.rows.get(id)?.data ?? null;
	}
	async put(id: string, data: T): Promise<void> {
		const cur = this.rows.get(id);
		this.rows.set(id, { data: structuredClone(data), rev: (cur?.rev ?? 0) + 1 });
	}
	async delete(id: string): Promise<boolean> {
		return this.rows.delete(id);
	}
	async exists(id: string): Promise<boolean> {
		return this.rows.has(id);
	}
	async getVersioned(id: string) {
		const cur = this.rows.get(id);
		return cur ? { value: cur.data, revision: String(cur.rev) } : null;
	}
	async compareAndSet(id: string, expected: string | null, data: T) {
		const cur = this.rows.get(id);
		if (expected === null) {
			if (cur) return { applied: false as const };
			this.rows.set(id, { data: structuredClone(data), rev: 1 });
			return { applied: true as const, revision: "1" };
		}
		if (!cur || String(cur.rev) !== expected) return { applied: false as const };
		this.rows.set(id, { data: structuredClone(data), rev: cur.rev + 1 });
		return { applied: true as const, revision: String(cur.rev + 1) };
	}
	async compareAndDelete(id: string, expected: string) {
		const cur = this.rows.get(id);
		if (!cur || String(cur.rev) !== expected) return { applied: false };
		this.rows.delete(id);
		return { applied: true };
	}
	async getMany(ids: string[]): Promise<Map<string, T>> {
		const out = new Map<string, T>();
		for (const id of ids) {
			const cur = this.rows.get(id);
			if (cur) out.set(id, cur.data);
		}
		return out;
	}
	async putMany(items: Array<{ id: string; data: T }>): Promise<void> {
		for (const it of items) await this.put(it.id, it.data);
	}
	async deleteMany(ids: string[]): Promise<number> {
		let n = 0;
		for (const id of ids) if (this.rows.delete(id)) n++;
		return n;
	}
	async query(options: { where?: Where; orderBy?: Record<string, "asc" | "desc">; limit?: number; cursor?: string } = {}) {
		const where = options.where ?? {};
		this.assertIndexed(Object.keys(where));
		const orderEntries = Object.entries(options.orderBy ?? {});
		this.assertIndexed(orderEntries.map(([f]) => f));
		const limit = Math.min(options.limit ?? 50, 100);
		if ((options.limit ?? 0) > 100) throw new Error("limit > 100");
		let items = [...this.rows.entries()]
			.map(([id, r]) => ({ id, data: r.data }))
			.filter((r) => matches(r.data as Record<string, unknown>, where));
		for (const [field, dir] of orderEntries.reverse()) {
			items.sort((a, b) => {
				const av = (a.data as Record<string, unknown>)[field] as never;
				const bv = (b.data as Record<string, unknown>)[field] as never;
				const c = av < bv ? -1 : av > bv ? 1 : 0;
				return dir === "desc" ? -c : c;
			});
		}
		if (orderEntries.length === 0) items.sort((a, b) => (a.id < b.id ? -1 : 1));
		const offset = options.cursor ? Number(options.cursor) : 0;
		const page = items.slice(offset, offset + limit);
		const hasMore = offset + limit < items.length;
		return { items: page, cursor: hasMore ? String(offset + limit) : undefined, hasMore };
	}
	async count(where: Where = {}): Promise<number> {
		this.assertIndexed(Object.keys(where));
		return [...this.rows.values()].filter((r) => matches(r.data as Record<string, unknown>, where)).length;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async updateIf(id: string, args: any): Promise<any> {
		const cur = this.rows.get(id);
		if (!cur || !matches(cur.data as Record<string, unknown>, args.where as Where)) return { applied: false };
		const next: Record<string, unknown> = { ...(cur.data as Record<string, unknown>), ...((args.set as Record<string, unknown>) ?? {}) };
		const delta = (args.delta ?? {}) as Record<string, { inc?: number; dec?: number }>;
		for (const [f, d] of Object.entries(delta)) {
			next[f] = ((next[f] as number) ?? 0) + (d.inc ?? 0) - (d.dec ?? 0);
		}
		this.rows.set(id, { data: next as T, rev: cur.rev + 1 });
		return { applied: true, data: next as T };
	}
	/** Solo para tests. */
	size(): number {
		return this.rows.size;
	}
}

export class MemoryKV {
	private map = new Map<string, { value: unknown; rev: number }>();
	async get<T>(key: string): Promise<T | null> {
		return (this.map.get(key)?.value as T) ?? null;
	}
	async getVersioned<T>(key: string) {
		const c = this.map.get(key);
		return c ? { value: c.value as T, revision: String(c.rev) } : null;
	}
	async compareAndSet(key: string, expected: string | null, value: unknown) {
		const c = this.map.get(key);
		if (expected === null ? !!c : !c || String(c.rev) !== expected) return { applied: false as const };
		this.map.set(key, { value, rev: (c?.rev ?? 0) + 1 });
		return { applied: true as const, revision: String((c?.rev ?? 0) + 1) };
	}
	async compareAndDelete(key: string, expected: string) {
		const c = this.map.get(key);
		if (!c || String(c.rev) !== expected) return { applied: false };
		this.map.delete(key);
		return { applied: true };
	}
	async set(key: string, value: unknown): Promise<void> {
		this.map.set(key, { value, rev: (this.map.get(key)?.rev ?? 0) + 1 });
	}
	async delete(key: string): Promise<boolean> {
		return this.map.delete(key);
	}
	async list(prefix = "") {
		return [...this.map.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, value: v.value }));
	}
}

// ─── Usuarios ──────────────────────────────────────────────────────

export interface FakeUser {
	id: string;
	email: string;
	name: string | null;
	role: number;
	createdAt: string;
}

export const ADMIN: FakeUser = { id: "u-admin", email: "andres@ejemplo.es", name: "Andrés", role: 50, createdAt: "2026-01-01T00:00:00.000Z" };
export const EDITORA: FakeUser = { id: "u-isabel", email: "isabel@ejemplo.es", name: "Isabel", role: 40, createdAt: "2026-01-01T00:00:00.000Z" };
export const AUTORA: FakeUser = { id: "u-autora", email: "autora@ejemplo.es", name: "Autora", role: 30, createdAt: "2026-01-01T00:00:00.000Z" };
const USUARIOS = [ADMIN, EDITORA, AUTORA];

// ─── Contenido ─────────────────────────────────────────────────────

interface FilaContenido {
	id: string;
	slug: string | null;
	status: string;
	live: Record<string, unknown>;
	draft: Record<string, unknown> | null;
	draftRevisionId: string | null;
	liveRevisionId: string | null;
	version: number;
	updatedAt: string;
}

/** Contenido en memoria con borrador («draft-aware») y publicación con `_rev`. */
export class FakeContent {
	readonly filas = new Map<string, FilaContenido>();
	readonly updates: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
	private rev = 0;

	private k(collection: string, id: string) {
		return `${collection}/${id}`;
	}

	add(collection: string, id: string, data: Record<string, unknown>, opts: { slug?: string; status?: string } = {}): void {
		this.filas.set(this.k(collection, id), {
			id,
			slug: opts.slug ?? id,
			status: opts.status ?? "draft",
			live: structuredClone(data),
			draft: null,
			draftRevisionId: null,
			liveRevisionId: opts.status === "published" ? `rev-${++this.rev}` : null,
			version: 1,
			updatedAt: "2026-11-01T00:00:00.000Z",
		});
	}

	private item(collection: string, f: FilaContenido, merged: boolean): PluginContentItem {
		return {
			id: f.id,
			type: collection,
			slug: f.slug,
			status: f.status,
			locale: "es",
			data: structuredClone(merged && f.draft ? f.draft : f.live),
			createdAt: "2026-10-01T00:00:00.000Z",
			updatedAt: f.updatedAt,
			publishedAt: f.status === "published" ? "2026-10-02T00:00:00.000Z" : null,
			liveRevisionId: f.liveRevisionId,
			draftRevisionId: f.draftRevisionId,
			version: f.version,
		};
	}

	/** Edición externa (editor nativo): no pasa por el plugin. */
	editar(collection: string, id: string, data: Record<string, unknown>): void {
		this.escribir(collection, id, data);
	}

	private escribir(collection: string, id: string, data: Record<string, unknown>): void {
		const f = this.filas.get(this.k(collection, id));
		if (!f) throw new Error("Content not found");
		const base = f.draft ?? f.live;
		f.draft = { ...structuredClone(base), ...structuredClone(data) };
		f.draftRevisionId = `rev-${++this.rev}`;
		f.version++;
		f.updatedAt = new Date().toISOString();
	}

	access() {
		const self = this;
		return {
			async get(collection: string, id: string) {
				const f = self.filas.get(self.k(collection, id));
				return f ? self.item(collection, f, false) : null;
			},
			async list(collection: string, opts: { limit?: number; cursor?: string } = {}) {
				const all = [...self.filas.entries()].filter(([k]) => k.startsWith(`${collection}/`)).map(([, f]) => self.item(collection, f, false));
				const off = opts.cursor ? Number(opts.cursor) : 0;
				const lim = opts.limit ?? 50;
				const items = all.slice(off, off + lim);
				const hasMore = off + lim < all.length;
				return { items, cursor: hasMore ? String(off + lim) : undefined, hasMore };
			},
			async getPublicUrl(collection: string, id: string) {
				const f = self.filas.get(self.k(collection, id));
				return f?.status === "published" ? `https://test.local/${collection}/${f.slug}` : null;
			},
			async getVersioned(collection: string, id: string) {
				const f = self.filas.get(self.k(collection, id));
				return f ? { item: self.item(collection, f, true), _rev: `${f.id}:${f.version}` } : null;
			},
			async update(collection: string, id: string, data: Record<string, unknown>) {
				self.updates.push({ collection, id, data: structuredClone(data) });
				self.escribir(collection, id, data);
				return self.item(collection, self.filas.get(self.k(collection, id))!, true);
			},
			async publish(collection: string, id: string, opts: { _rev: string }) {
				const f = self.filas.get(self.k(collection, id));
				if (!f) throw new Error("Content not found");
				if (opts._rev !== `${f.id}:${f.version}`) throw new Error("REV_CONFLICT");
				if (f.draft) f.live = f.draft;
				f.draft = null;
				f.liveRevisionId = f.draftRevisionId ?? f.liveRevisionId ?? `rev-${++self.rev}`;
				f.draftRevisionId = null;
				f.status = "published";
				f.version++;
				return { item: self.item(collection, f, true), _rev: `${f.id}:${f.version}` };
			},
		};
	}
}

// ─── Contexto ──────────────────────────────────────────────────────

export function makeStorage() {
	const cols: Record<string, MemoryCollection<unknown>> = {};
	for (const [name, cfg] of Object.entries(STORAGE)) cols[name] = new MemoryCollection(cfg.indexes);
	return cols;
}

export interface Mundo {
	storage: Record<string, MemoryCollection<unknown>>;
	kv: MemoryKV;
	content: FakeContent;
	correos: Array<{ to: string; subject: string; text: string }>;
	cron: Array<{ name: string; schedule: string; data?: Record<string, unknown> }>;
	logs: string[];
	conCorreo: boolean;
}

export function makeMundo(opts: { conCorreo?: boolean } = {}): Mundo {
	return {
		storage: makeStorage(),
		kv: new MemoryKV(),
		content: new FakeContent(),
		correos: [],
		cron: [],
		logs: [],
		conCorreo: opts.conCorreo ?? true,
	};
}

export function makeCtx(mundo: Mundo, user: FakeUser | null = ADMIN, input?: unknown): RouteContext<any> {
	const log = {
		debug: (m: string) => mundo.logs.push(`debug ${m}`),
		info: (m: string) => mundo.logs.push(`info ${m}`),
		warn: (m: string) => mundo.logs.push(`warn ${m}`),
		error: (m: string) => mundo.logs.push(`error ${m}`),
	};
	const ctx = {
		plugin: { id: "emdash-revision", version: "test" },
		storage: mundo.storage,
		kv: mundo.kv,
		settings: new MemoryKV(),
		log,
		site: { name: "Test", url: "https://test.local", locale: "es" },
		url: (p: string) => `https://test.local${p}`,
		content: mundo.content.access(),
		users: {
			get: async (id: string) => USUARIOS.find((u) => u.id === id) ?? null,
			getByEmail: async (email: string) => USUARIOS.find((u) => u.email === email) ?? null,
			list: async () => ({ items: USUARIOS }),
		},
		cron: {
			schedule: async (name: string, o: { schedule: string; data?: Record<string, unknown> }) => {
				mundo.cron.push({ name, ...o });
			},
			cancel: async () => undefined,
			list: async () => [],
		},
		email: mundo.conCorreo
			? {
					send: async (m: { to: string; subject: string; text: string }) => {
						mundo.correos.push(m);
					},
				}
			: undefined,
		user: user ?? undefined,
		input,
		request: new Request("https://test.local/"),
		requestMeta: { ip: null, userAgent: null, referer: null, geo: null },
	};
	return ctx as unknown as RouteContext<any>;
}

export function asPluginCtx(ctx: RouteContext<any>): PluginContext {
	return ctx as unknown as PluginContext;
}

// ─── Plugin y llamadas ─────────────────────────────────────────────

export const OPCIONES: RevisionPluginOptions = {
	collections: { posts: { campoRevisado: "reviewed_at", urlPublica: "/articulos/" } },
	etiqueta: "Revisión médica",
};

export function makePlugin(opciones: RevisionPluginOptions = OPCIONES) {
	const plugin = createPlugin(opciones);
	/** Llama a una ruta como lo haría el host (valida la entrada con su esquema). */
	async function llamar<T = any>(mundo: Mundo, user: FakeUser | null, ruta: string, input: unknown = {}): Promise<T> {
		const route = plugin.routes[ruta];
		if (!route) throw new Error(`Ruta desconocida: ${ruta}`);
		const parsed = route.input ? route.input.parse(input) : input;
		return (await route.handler(makeCtx(mundo, user, parsed))) as T;
	}
	async function hook(nombre: "content:afterSave" | "content:afterDelete" | "cron", mundo: Mundo, event: unknown): Promise<void> {
		const h = plugin.hooks[nombre] as { handler: (e: unknown, c: PluginContext) => Promise<unknown> } | undefined;
		if (!h) throw new Error(`Hook desconocido: ${nombre}`);
		await h.handler(event, asPluginCtx(makeCtx(mundo, null)));
	}
	return { plugin, llamar, hook };
}

// ─── Documento de ejemplo ──────────────────────────────────────────

function span(key: string, text: string, marks: string[] = []) {
	return { _type: "span", _key: key, text, marks };
}

export function contenidoEjemplo(): PTNode[] {
	return [
		{ _type: "block", _key: "b1", style: "normal", markDefs: [], children: [span("s1", "La menopausia llega de media a los 51 años en España.")] },
		{ _type: "block", _key: "b2", style: "h2", markDefs: [], children: [span("s2", "Síntomas frecuentes")] },
		{ _type: "block", _key: "b3", style: "normal", markDefs: [], children: [span("s3", "Los sofocos afectan a muchas mujeres y suelen durar varios años.")] },
		{ _type: "block", _key: "b4", style: "normal", markDefs: [], children: [span("s4", "Consulta con tu médica si los síntomas te impiden dormir.")] },
	] as PTNode[];
}

export function datosEjemplo(): Record<string, unknown> {
	return {
		title: "Qué es la menopausia",
		excerpt: "Una guía clara sobre la menopausia.",
		references: "1. Sociedad Española de Ginecología y Obstetricia. Guía 2024.",
		content: contenidoEjemplo(),
		featured_image: { src: "https://test.local/portada.jpg", alt: "Portada" },
	};
}
