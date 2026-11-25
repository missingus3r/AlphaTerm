#!/usr/bin/env node
// New AlphaTerm version: bumps the number, tags it in git, builds and installs it.
//
//   node scripts/release.mjs              → 0.3.0 → 0.3.1 (patch, the default)
//   node scripts/release.mjs --minor      → 0.3.0 → 0.4.0
//   node scripts/release.mjs --major      → 0.3.0 → 1.0.0
//   node scripts/release.mjs --misma      → rebuilds the current version without bumping it
//
// Steps: 0) before touching anything, checks that the commits since the last tag have their
// What's new translation (src/i18n/changelog/en.json and pt.json; `node scripts/changelog.mjs --faltan`): if
// any is missing, it stops without changing anything; 1) bumps `version` in package.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml and Cargo.lock; 2) commit "Versión X" (only those files) and annotated tag vX;
// 3) generates the changelog; 4) builds; 5) installs (scripts/install.mjs). If the build or the
// install fails, it undoes the commit and tag it created (they are local and freshly made) and leaves the files
// as they were.
//
// If `src-tauri/target/release/alphaterm(.exe)` is open (an old AlphaTerm running from there),
// it can't be overwritten: it builds into `src-tauri/target/prueba` and installs from there.
// Works on Windows (build-release.bat) and Linux (build-release.sh).
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion } from "./changelog-lib.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = path.join(repo, "src-tauri", "target");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const exeName = process.platform === "win32" ? "alphaterm.exe" : "alphaterm";

/** Is a program running from this .exe? (an .exe in use can't be opened for writing). */
function inUse(file) {
  if (!fs.existsSync(file)) return false;
  try {
    fs.closeSync(fs.openSync(file, "r+"));
    return false;
  } catch (e) {
    // ETXTBSY: Linux, a running binary.
    return e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES" || e.code === "ETXTBSY";
  }
}

// --- 1) New version ---
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
    /* it was no longer there */
  }
  try {
    if (git("log", "-1", "--format=%s") === `Versión ${version}`) git("reset", "--soft", "HEAD~1");
    git("restore", "--staged", ...Object.keys(FILES));
  } catch {
    /* it still has the files */
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
    /* doesn't exist: fine */
  }
  // What's new in the three languages: the commits that go into this version must be translated.
  let since = null;
  try {
    since = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  } catch {
    /* no tags: the whole history is checked */
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

// --- 2) Build and install ---
try {
  const target = inUse(path.join(main, "release", exeName)) ? path.join(main, "prueba") : main;
  if (target !== main) console.log(`target/release/${exeName} está abierto: se compila en ${target}.`);
  console.log(`Compilando AlphaTerm ${version}…\n`);
  const env = { ...process.env, CARGO_TARGET_DIR: target };
  // Rust installed outside the PATH (~/.cargo/bin).
  env.PATH = `${path.join(os.homedir(), ".cargo", "bin")}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
  // `npm run build` (Tauri's beforeBuildCommand) generates the changelog with the tags up to date.
  execSync("npx tauri build --no-bundle", { cwd: repo, env, stdio: "inherit" });
  execSync(`node "${path.join(repo, "scripts", "install.mjs")}" --desde "${path.join(target, "release")}"`, { cwd: repo, stdio: "inherit" });
} catch (e) {
  undo();
  console.error(`\nNo se pudo compilar o instalar: ${e.message ?? e}`);
  process.exit(1);
}
