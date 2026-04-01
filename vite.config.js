import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "/Simman-/",
  plugins: [react(), viteSingleFile()],
  worker: { format: 'es' },
});
