import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		plugin: "src/plugin.ts",
		admin: "src/admin.tsx",
		lib: "src/lib.ts",
	},
	format: "esm",
	platform: "neutral",
	dts: true,
	clean: true,
	sourcemap: true,
	deps: {
		// El host aporta emdash, react y astro (astro/zod es el zod que usa emdash);
		// `cloudflare:workers` lo resuelve el runtime del Worker.
		neverBundle: [/^emdash(\/.*)?$/, /^react(\/.*)?$/, /^react-dom(\/.*)?$/, /^astro(\/.*)?$/, /^cloudflare:/],
	},
	// src/env.ts debe quedar como chunk propio: el import dinámico de
	// `cloudflare:workers` no puede convertirse en estático.
	outputOptions: {
		manualChunks(id) {
			if (id.endsWith("/src/env.ts")) return "env";
			return undefined;
		},
	},
});
