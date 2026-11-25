#!/usr/bin/env node
// Versión nueva de AlphaTerm: sube el número, la marca en git, compila y la instala.
//
//   node scripts/release.mjs              → 0.3.0 → 0.3.1 (patch, por defecto)
//   node scripts/release.mjs --minor      → 0.3.0 → 0.4.0
//   node scripts/release.mjs --major      → 0.3.0 → 1.0.0
//   node scripts/release.mjs --misma      → recompila la versión actual sin subirla
//
// Pasos: 0) antes de tocar nada, revisa que los commits desde el último tag tengan su traducción
// de Novedades (src/i18n/changelog/en.json y pt.json; `node scripts/changelog.mjs --faltan`): si
// falta alguna, frena sin cambiar nada; 1) sube `version` en package.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml y Cargo.lock; 2) commit "Versión X" (solo esos archivos) y tag anotado vX;
// 3) genera el changelog; 4) compila; 5) instala (scripts/install.mjs). Si falla la compilación o la
// instalación, deshace el commit y el tag que creó (son locales y recién hechos) y deja los archivos
// como estaban.
//
// Si `src-tauri\target\release\alphaterm.exe` está abierto (una AlphaTerm vieja que corre desde ahí),
// no se puede pisar: se compila en `src-tauri\target\prueba` y se instala desde ahí.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion } from "./changelog-lib.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = path.join(repo, "src-tauri", "target");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

/** ¿Hay un programa corriendo desde este .exe? (un .exe en uso no se puede abrir para escribir). */
function inUse(file) {
  if (!fs.existsSync(file)) return false;
  try {
    fs.closeSync(fs.openSync(file, "r+"));
    return false;
  } catch (e) {
    return e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES";
  }
}

// --- 1) Versión nueva -----------------------------------------------------------------------------
const flag = process.argv.slice(2).find((a) => a.startsWith("--")) ?? "--patch";
const kind = { "--patch": "patch", "--minor": "minor", "--major": "major", "--misma": null }[flag];
if (kind === undefined) {
  console.error(`Opción desconocida: ${flag}. Usar --patch (por defecto), --minor, --major o --misma.`);
  process.exit(1);
}
const conf = path.join(repo, "src-tauri", "tauri.conf.json");
const current = JSON.parse(fs.readFileSync(conf, "utf8")).version;
const version = kind ? bumpVersion(current, kind) : current;

const FILES = {
  "package.json": (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`),
  "src-tauri/tauri.conf.json": (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`),
  "src-tauri/Cargo.toml": (s) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`),
  "src-tauri/Cargo.lock": (s) => s.replace(/(name = "alphaterm"\r?\nversion = ")[^"]+(")/, `$1${version}$2`),
};
const backup = {};
let bumped = false;

function undo() {
  if (!bumped) return;
  console.log(`\nDeshaciendo la versión ${version} (commit y tag recién creados)…`);
  try {
    git("tag", "-d", `v${version}`);
  } catch {
    /* ya no estaba */
  }
  try {
    if (git("log", "-1", "--format=%s") === `Versión ${version}`) git("reset", "--soft", "HEAD~1");
    git("restore", "--staged", ...Object.keys(FILES));
  } catch {
    /* sigue con los archivos */
  }
  for (const [f, text] of Object.entries(backup)) fs.writeFileSync(path.join(repo, f), text);
  console.log(`Quedó en ${current}.`);
}

if (kind) {
  try {
    git("rev-parse", "-q", "--verify", `refs/tags/v${version}`);
    console.error(`Ya existe el tag v${version}. Revisar la versión en src-tauri/tauri.conf.json.`);
    process.exit(1);
  } catch {
    /* no existe: bien */
  }
  // Novedades en los tres idiomas: los commits que entran en esta versión tienen que estar traducidos.
  let since = null;
  try {
    since = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  } catch {
    /* sin tags: se revisa todo el historial */
  }
  try {
    execFileSync(process.execPath, [path.join(repo, "scripts", "changelog.mjs"), "--faltan", ...(since ? ["--desde", since] : [])], { cwd: repo, stdio: "inherit" });
  } catch {
    console.error(
      `\nNo se subió la versión: faltan las traducciones de Novedades de los commits de arriba${since ? ` (los posteriores a ${since})` : ""}.\n` +
        `Agregalas en src/i18n/changelog/en.json y pt.json y volvé a correr la versión. No se cambió nada.`,
    );
    process.exit(1);
  }
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
  if (dirty.length) {
    console.log(`Ojo: hay ${dirty.length} cambios sin commitear. No entran en la versión (el exe va a mostrar "+").`);
  }
  for (const [f, change] of Object.entries(FILES)) {
    const p = path.join(repo, f);
    backup[f] = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, change(backup[f]));
  }
  git("add", "--", ...Object.keys(FILES));
  git("commit", "-q", "-m", `Versión ${version}`, "-m", `Sube de ${current} a ${version}.`, "--", ...Object.keys(FILES));
  git("tag", "-a", `v${version}`, "-m", `AlphaTerm ${version}`);
  bumped = true;
  console.log(`Versión ${current} → ${version} (commit y tag v${version}).`);
} else {
  console.log(`Se recompila la misma versión: ${version}.`);
}

// --- 2) Compilar e instalar -----------------------------------------------------------------------
try {
  const target = inUse(path.join(main, "release", "alphaterm.exe")) ? path.join(main, "prueba") : main;
  if (target !== main) console.log(`target\\release\\alphaterm.exe está abierto: se compila en ${target}.`);
  console.log(`Compilando AlphaTerm ${version}…\n`);
  const env = { ...process.env, CARGO_TARGET_DIR: target };
  // Rust instalado fuera del PATH (~/.cargo/bin).
  env.PATH = `${path.join(process.env.USERPROFILE ?? "", ".cargo", "bin")}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
  // `npm run build` (el beforeBuildCommand de Tauri) genera el changelog con los tags al día.
  execSync("npx tauri build --no-bundle", { cwd: repo, env, stdio: "inherit" });
  execSync(`node "${path.join(repo, "scripts", "install.mjs")}" --desde "${path.join(target, "release")}"`, { cwd: repo, stdio: "inherit" });
} catch (e) {
  undo();
  console.error(`\nNo se pudo compilar o instalar: ${e.message ?? e}`);
  process.exit(1);
}
