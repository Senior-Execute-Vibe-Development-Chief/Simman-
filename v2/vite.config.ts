import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
