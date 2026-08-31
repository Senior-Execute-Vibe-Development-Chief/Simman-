import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const simRoot = fileURLToPath(new URL("../src/sim/", import.meta.url));
const allowed = new Set(["0", "1", "2"]);

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function withoutCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "");
}

function isArrayIndex(source: string, start: number, end: number): boolean {
  const before = source.slice(0, start).trimEnd();
  const after = source.slice(end).trimStart();
  return before.endsWith("[") && after.startsWith("]");
}

const failures: string[] = [];
for (const path of sourceFiles(simRoot)) {
  if (path.endsWith("constants.ts")) continue;
  const source = withoutCommentsAndStrings(readFileSync(path, "utf8"));
  const lines = source.split("\n");
  lines.forEach((line, lineNumber) => {
    for (const match of line.matchAll(/(?<![A-Za-z0-9_$])(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(?![A-Za-z0-9_$])/g)) {
      const token = match[1];
      if (!token) continue;
      const start = match.index ?? 0;
      const end = start + token.length;
      const bitwiseLine = /(?:<<|>>>?|[&|^])/.test(line);
      if (allowed.has(token) || isArrayIndex(line, start, end) || bitwiseLine) continue;
      failures.push(`${relative(process.cwd(), path)}:${lineNumber + 1}: literal ${token} must come from constants.ts`);
    }
  });
}

for (const path of sourceFiles(simRoot)) {
  if (path.endsWith("constants.ts")) {
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, lineNumber) => {
      if (line.trimStart().startsWith("export const ") && !line.includes("spec/09-constants-ledger.md")) {
        failures.push(`${relative(process.cwd(), path)}:${lineNumber + 1}: constant has no ledger citation`);
      }
    });
  }
}

if (failures.length) {
  console.error(["Constants-ledger lint failed:", ...failures].join("\n"));
  process.exitCode = 1;
} else {
  console.log("constants-ledger: ok");
}
