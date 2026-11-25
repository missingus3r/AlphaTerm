#!/usr/bin/env node
// Generates src/generated/changelog.json from git: each version (tag vX.Y.Z) with its commits, and each
// commit with its English and Portuguese translation (src/i18n/changelog/en.json and pt.json).
// `npm run dev`, `npm run build` and `npm run typecheck` run it (so the app always ships it).
//
// Usage: node scripts/changelog.mjs [--next <version>]
//        --next: name for the commits that don't have a tag yet (the version being built).
//      node scripts/changelog.mjs --faltan [--desde <ref>]
//        Lists the untranslated commits (and the malformed entries); exits with 1 if anything is missing.
//        --desde vX.Y.Z: only the commits after that reference (this is how release.mjs uses it).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG_LANGS, dictProblems, groupByVersion, LOG_FORMAT, missingTranslations, parseLog, parseTags, unusedTranslations, withTranslations } from "./changelog-lib.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "src", "generated", "changelog.json");
const trDir = path.join(repo, "src", "i18n", "changelog");
const rel = (p) => path.relative(repo, p).replaceAll("\\", "/");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Translations per language ({ en: { subject: { subject, body } }, … }) and the files that couldn't be read. */
function readTranslations() {
  const dicts = {};
  const errors = [];
  for (const l of CHANGELOG_LANGS) {
    const f = path.join(trDir, `${l}.json`);
    dicts[l] = {};
    if (!fs.existsSync(f)) continue;
    try {
      dicts[l] = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      errors.push(`${rel(f)}: JSON inválido (${e.message})`);
    }
  }
  return { dicts, errors };
}

const { dicts, errors } = readTranslations();

if (process.argv.includes("--faltan")) faltan(arg("--desde"));
else generate(arg("--next"));

function generate(next) {
  for (const e of errors) console.error(`changelog: ${e} (se genera sin esas traducciones)`);
  let data;
  let missing = 0;
  try {
    const commits = parseLog(git(["log", `--format=${LOG_FORMAT}`]));
    const tags = parseTags(git(["tag", "-l", "v*", "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)"]));
    missing = missingTranslations(commits, dicts).length;
    data = { generatedAt: new Date().toISOString(), versions: groupByVersion(withTranslations(commits, dicts), tags, next) };
  } catch {
    // Without git (for example, a copy without .git): empty changelog instead of breaking the build.
    data = { generatedAt: new Date().toISOString(), versions: [] };
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const text = JSON.stringify(data, null, 1) + "\n";
  // Don't rewrite if nothing changed (avoids extra reloads in `npm run dev`).
  const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/"generatedAt": "[^"]*"/, "") : "";
  if (before !== text.replace(/"generatedAt": "[^"]*"/, "")) fs.writeFileSync(out, text);
  const n = data.versions.reduce((s, v) => s + v.commits.length, 0);
  const pending = missing ? ` (${missing} sin traducir: node scripts/changelog.mjs --faltan)` : "";
  console.log(`changelog: ${data.versions.length} versiones, ${n} commits${pending}`);
}

function faltan(desde) {
  let commits;
  try {
    commits = parseLog(git(["log", `--format=${LOG_FORMAT}`, ...(desde ? [`${desde}..HEAD`] : [])]));
  } catch {
    console.error(`No se pudo leer el historial de git${desde ? ` desde ${desde}` : ""}.`);
    process.exit(2);
  }
  const problems = [...errors, ...dictProblems(dicts)];
  const missing = missingTranslations(commits, dicts);
  const files = CHANGELOG_LANGS.map((l) => rel(path.join(trDir, `${l}.json`))).join(" y ");
  const scope = desde ? ` desde ${desde}` : "";

  if (problems.length) {
    console.log(`Traducciones del changelog con problemas:`);
    for (const p of problems) console.log(`  ${p}`);
    console.log("");
  }
  if (missing.length) {
    console.log(`Novedades: ${missing.length} commit(s)${scope} sin traducir:`);
    for (const { commit: c, missing: m } of missing) {
      const what = Object.entries(m).map(([l, parts]) => (parts.length === 2 || (parts[0] === "asunto" && !c.body) ? l : `${l} (${parts.join(" y ")})`));
      console.log(`  ${c.short}  ${c.subject}  → ${what.join(", ")}`);
    }
    const ej = missing[0].commit;
    console.log(`\nSe agregan en ${files}, con el asunto en español tal cual como clave:`);
    console.log(`  ${JSON.stringify(ej.subject)}: { "subject": "…"${ej.body ? `, "body": "…"` : ""} }`);
    console.log(`"body" solo si el commit tiene cuerpo (verlo con: git show -s ${ej.short}). Los "Versión X.Y.Z" se traducen solos.`);
  }
  if (!desde) {
    const unused = unusedTranslations(commits, dicts);
    if (unused.length) {
      console.log(`\nSobran ${unused.length} traducción(es): ningún commit tiene ese asunto (¿se cambió o se reescribió el historial?):`);
      for (const u of unused) console.log(`  ${u.lang}: ${u.subject}`);
    }
  }
  if (!problems.length && !missing.length) console.log(`Novedades: los ${commits.length} commits${scope} tienen traducción (${CHANGELOG_LANGS.join(", ")}).`);
  process.exit(problems.length || missing.length ? 1 : 0);
}
