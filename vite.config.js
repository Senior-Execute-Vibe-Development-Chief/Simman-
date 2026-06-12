import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => ({
  base: "/Simman-/",
  plugins: [react(), viteSingleFile()],
  worker: { format: 'es' },
  // Inline sourcemaps roughly triple the single-file page weight, so keep
  // them to dev-mode builds (`vite build --mode development`) only.
  build: { sourcemap: mode === "development" ? "inline" : false },
}));
