#!/usr/bin/env node
// Compila AlphaTerm (release) y la instala (scripts/instalar.mjs).
// Si `src-tauri\target\release\alphaterm.exe` está abierto (una AlphaTerm vieja que corre desde ahí),
// no se puede pisar: se compila en `src-tauri\target\prueba` y se instala desde ahí.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = path.join(repo, "src-tauri", "target");

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

const target = inUse(path.join(main, "release", "alphaterm.exe")) ? path.join(main, "prueba") : main;
if (target !== main) console.log(`target\\release\\alphaterm.exe está abierto: se compila en ${target}.`);

const version = JSON.parse(fs.readFileSync(path.join(repo, "src-tauri", "tauri.conf.json"), "utf8")).version;
console.log(`Compilando AlphaTerm ${version}…\n`);
const env = { ...process.env, CARGO_TARGET_DIR: target };
// Rust instalado fuera del PATH (~/.cargo/bin).
env.PATH = `${path.join(process.env.USERPROFILE ?? "", ".cargo", "bin")}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
execSync("npx tauri build --no-bundle", { cwd: repo, env, stdio: "inherit" });
execSync(`node "${path.join(repo, "scripts", "instalar.mjs")}" --desde "${path.join(target, "release")}"`, { cwd: repo, stdio: "inherit" });
