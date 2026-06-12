// Flat ESLint config. Deliberately minimal: the goal is to catch the two
// classes of rot this codebase actually accumulated —
//   • no-undef        : a used identifier that isn't defined/imported (e.g. an
//                       import deleted while a use remained) — a real runtime
//                       ReferenceError that the Vite/esbuild build does NOT catch.
//   • no-unused-vars   : dead imports/locals (how ~10 dead imports piled up in
//                       WorldSim.jsx). Kept as a WARNING so it surfaces without
//                       blocking — there is pre-existing cruft to burn down.
// Run with `npm run lint`.
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Browser (the React app) + worker (peopleSimWorker / worldGenWorker run
      // in Web Workers and use self/postMessage) + the JS built-ins.
      // `process` is read-only: sim modules use guarded
      // `typeof process !== "undefined" && process.env.SIM_*` env flags so the
      // same files run under the node probes in tools/.
      globals: { ...globals.browser, ...globals.worker, ...globals.es2021, process: "readonly" },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { vars: "all", args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
