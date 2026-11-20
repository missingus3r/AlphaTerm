#!/usr/bin/env node
// Genera src/generated/changelog.json desde git: cada versión (tag vX.Y.Z) con sus commits.
// Lo corren `npm run dev`, `npm run build` y `npm run typecheck` (así la app siempre lo trae).
//
// Uso: node scripts/changelog.mjs [--next <versión>]
//   --next: nombre para los commits que todavía no tienen tag (la versión que se está compilando).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupByVersion, LOG_FORMAT, parseLog, parseTags } from "./changelog-lib.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "src", "generated", "changelog.json");
const i = process.argv.indexOf("--next");
const next = i > 0 ? process.argv[i + 1] : undefined;

const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let data;
try {
  const commits = parseLog(git(["log", `--format=${LOG_FORMAT}`]));
  const tags = parseTags(git(["tag", "-l", "v*", "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)"]));
  data = { generatedAt: new Date().toISOString(), versions: groupByVersion(commits, tags, next) };
} catch {
  // Sin git (por ejemplo, una copia sin .git): changelog vacío en vez de romper el build.
  data = { generatedAt: new Date().toISOString(), versions: [] };
}
fs.mkdirSync(path.dirname(out), { recursive: true });
const text = JSON.stringify(data, null, 1) + "\n";
// No reescribir si no cambió nada (evita recargas de más en `npm run dev`).
const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/"generatedAt": "[^"]*"/, "") : "";
if (before !== text.replace(/"generatedAt": "[^"]*"/, "")) fs.writeFileSync(out, text);
const n = data.versions.reduce((s, v) => s + v.commits.length, 0);
console.log(`changelog: ${data.versions.length} versiones, ${n} commits`);
