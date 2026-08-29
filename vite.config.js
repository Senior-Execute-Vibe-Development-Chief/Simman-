import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Cross-origin isolation (COOP/COEP): the popField worker pool
// (docs/popfield-parallel.md) needs SharedArrayBuffer, which browsers only
// expose on isolated pages. Dev + preview send the headers here; PRODUCTION
// hosting must send them too (GitHub Pages cannot set headers — a
// service-worker shim like coi-serviceworker is the usual workaround, a
// deployment decision not taken here). Without isolation the sim silently
// runs the identical-result single-thread path.
const coi = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => ({
  // Live: /Simman-/. Preview channels: /Simman-/b/<slug>/ (set by deploy.yml).
  base: process.env.VITE_BASE || "/Simman-/",
  // The running tab's build identity (the stale-tab detector, 2026-08-19):
  // the deploy workflow exports GITHUB_SHA and also writes dist/version.json
  // with the same sha AFTER the build; the app polls that file and shows a
  // "new build" chip when the deployed sha differs from the one baked in
  // here. Local dev has neither — the chip stays silent.
  define: { __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA || "dev") },
  plugins: [react(), viteSingleFile()],
  worker: { format: 'es' },
  server: { headers: coi },
  preview: { headers: coi },
  // Inline sourcemaps roughly triple the single-file page weight, so keep
  // them to dev-mode builds (`vite build --mode development`) only.
  build: { sourcemap: mode === "development" ? "inline" : false },
}));
