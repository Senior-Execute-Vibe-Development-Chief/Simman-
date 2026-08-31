import tseslint from "typescript-eslint";

const forbiddenTranscendentals = [
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "pow",
  "atan",
  "atan2",
  "asin",
  "acos",
  "sinh",
  "cosh",
  "tanh",
  "random",
].map((property) => ({
  object: "Math",
  property,
  message: `Use the deterministic math module instead of Math.${property}.`,
}));

export default tseslint.config(
  {
    ignores: ["dist/**", "src/wasm/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error", forbiddenTranscendentals.find(({ property }) => property === "random")],
    },
  },
  // The sim block must come LAST and carry the FULL restriction list: flat
  // config merges rules last-wins per rule name, so an earlier sim block
  // would be silently erased by the general src/** block (caught in M0
  // review — a Math.sin in src/sim passed the original config).
  {
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...forbiddenTranscendentals],
    },
  },
);
