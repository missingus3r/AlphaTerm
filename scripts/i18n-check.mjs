// Checks the interface translations (src/i18n): that every text marked with t("…"), k("…") or
// tIn(language, "…") has its English and Portuguese translation, that there are no extra translations, that the
// {variables} match and that the same text doesn't have two different translations in two areas.
//
// Usage: node scripts/i18n-check.mjs                 → checks everything
//        node scripts/i18n-check.mjs src/panels/X.tsx → only the texts of those files (no "extras")
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const I18N = join(SRC, "i18n");
export const LANGS = ["en", "pt"];

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "generated" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && p !== join(I18N, "index.ts") ? [p] : [];
  });
}

const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\$]|\\.|\$(?!\{))*\`)`;
const CALL = new RegExp(String.raw`(?<![\w$.])(?:t|k)\(\s*` + LIT + String.raw`|(?<![\w$.])tIn\(\s*[^,()]+,\s*` + LIT, "g");

/** Texts marked in a file: [{ text, line }]. */
export function extract(code) {
  const out = [];
  for (const m of code.matchAll(CALL)) {
    const lit = m[1] ?? m[2];
    let text;
    try {
      text = new Function(`return ${lit}`)();
    } catch {
      continue;
    }
    out.push({ text, line: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

export const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Dictionaries per language: { en: { text: { value, file } }, … } and the conflicts between areas. */
export function loadDicts() {
  const dicts = {};
  const conflicts = [];
  for (const l of LANGS) {
    dicts[l] = {};
    const dir = join(I18N, l);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      let data;
      try {
        data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch (e) {
        conflicts.push(`${l}/${f}: JSON inválido (${e.message})`);
        continue;
      }
      for (const [key, value] of Object.entries(data)) {
        const prev = dicts[l][key];
        if (prev && prev.value !== value) conflicts.push(`${l}: «${key}» tiene dos traducciones: «${prev.value}» (${prev.file}) y «${value}» (${f})`);
        dicts[l][key] = { value, file: f };
      }
    }
  }
  return { dicts, conflicts };
}

/** Problems found (empty list = all good). */
export function check(files) {
  const only = files?.length ? files.map((f) => resolve(f)) : null;
  const all = sources(SRC);
  const used = new Map(); // text → "file:line"
  for (const file of only ?? all) {
    for (const { text, line } of extract(readFileSync(file, "utf8"))) {
      if (!used.has(text)) used.set(text, `${relative(ROOT, file)}:${line}`);
    }
  }
  const { dicts, conflicts } = loadDicts();
  const problems = [...conflicts];
  for (const [text, where] of used) {
    for (const l of LANGS) {
      const tr = dicts[l][text];
      if (!tr) problems.push(`${where}: falta «${text}» en ${l}`);
      else if (!String(tr.value).trim()) problems.push(`${l}/${tr.file}: «${text}» está vacío`);
      else if (placeholders(tr.value) !== placeholders(text)) problems.push(`${l}/${tr.file}: «${text}» → «${tr.value}» no tiene las mismas {variables}`);
    }
  }
  if (!only) {
    const everywhere = new Set();
    for (const file of all) for (const { text } of extract(readFileSync(file, "utf8"))) everywhere.add(text);
    for (const l of LANGS) {
      for (const [key, { file }] of Object.entries(dicts[l])) {
        if (!everywhere.has(key)) problems.push(`${l}/${file}: sobra «${key}» (nadie lo usa con t/k)`);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = check(process.argv.slice(2));
  for (const p of problems) console.log(p);
  console.log(problems.length ? `\n${problems.length} problema(s)` : "Traducciones OK");
  process.exit(problems.length ? 1 : 0);
}
