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
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...forbiddenTranscendentals.filter(({ property }) => property !== "random")],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error", forbiddenTranscendentals.find(({ property }) => property === "random")],
    },
  },
);
