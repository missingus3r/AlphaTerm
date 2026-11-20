#!/usr/bin/env node
// Instala la AlphaTerm recién compilada en una carpeta por versión y apunta los accesos directos ahí.
//
// - Copia alphaterm.exe, conpty.dll y OpenConsole.exe a %LOCALAPPDATA%\AlphaTerm\versiones\<versión>\.
//   La AlphaTerm abierta no se toca (corre desde otra carpeta), así que se puede instalar con ella
//   abierta: la próxima vez que se abra, es la nueva.
// - Actualiza el acceso directo del escritorio (lo crea si no está) y el anclado en la barra de
//   tareas (si está). No borra nada: las versiones anteriores quedan en su carpeta.
//
// Uso: node scripts/instalar.mjs [--desde <carpeta del build>]   (por defecto src-tauri\target\release)
// `npm run release` compila y después corre esto.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = path.resolve(arg("--desde") ?? path.join(repo, "src-tauri", "target", "release"));
const version = JSON.parse(fs.readFileSync(path.join(repo, "src-tauri", "tauri.conf.json"), "utf8")).version;
const FILES = ["alphaterm.exe", "conpty.dll", "OpenConsole.exe"];

for (const f of FILES) {
  if (!fs.existsSync(path.join(from, f))) {
    console.error(`Falta ${f} en ${from}. ¿Se compiló? (npx tauri build --no-bundle)`);
    process.exit(1);
  }
}

const base = path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE, "AppData", "Local"), "AlphaTerm", "versiones");
/** Copia a la carpeta de la versión; si esa versión está abierta (archivos en uso), a una al lado. */
function install() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  for (const dir of [path.join(base, version), path.join(base, `${version}-${stamp}`)]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of FILES) fs.copyFileSync(path.join(from, f), path.join(dir, f));
      return dir;
    } catch (e) {
      if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
      console.log(`${dir} está en uso (esa versión está abierta): se instala al lado.`);
    }
  }
  throw new Error("No se pudo copiar la versión nueva.");
}

const dir = install();
const exe = path.join(dir, "alphaterm.exe");

// Accesos directos: por PowerShell en línea (WScript.Shell), que anda aunque los .ps1 estén bloqueados.
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
const q = (s) => `'${s.replace(/'/g, "''")}'`;
/** Apunta un acceso directo (nuevo o existente) a la versión instalada. Devuelve a dónde apuntaba. */
const point = (file) =>
  ps(
    [
      `$sh = New-Object -ComObject WScript.Shell`,
      `$l = $sh.CreateShortcut(${q(file)})`,
      `$antes = $l.TargetPath`,
      `$l.TargetPath = ${q(exe)}`,
      `$l.IconLocation = ${q(`${exe},0`)}`,
      `$l.Description = ${q(`AlphaTerm ${version}`)}`,
      `if (-not $l.WorkingDirectory) { $l.WorkingDirectory = $env:USERPROFILE }`,
      `$l.Save()`,
      `$antes`,
    ].join("; "),
  );
const targetOf = (file) => ps(`(New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)}).TargetPath`);

// Escritorio: un acceso directo "AlphaTerm <versión>". Si ya había uno de AlphaTerm (cualquier
// versión), se lo apunta a la nueva y se le cambia el nombre; si no, se crea.
const desktop = ps("[Environment]::GetFolderPath('Desktop')");
const name = `AlphaTerm ${version}.lnk`;
const ours = fs
  .readdirSync(desktop)
  .filter((f) => /^AlphaTerm.*\.lnk$/i.test(f))
  .filter((f) => /alphaterm\.exe$/i.test(targetOf(path.join(desktop, f))));
const main = ours.find((f) => f.toLowerCase() === name.toLowerCase()) ?? ours[0] ?? name;
const before = point(path.join(desktop, main));
if (main !== name) fs.renameSync(path.join(desktop, main), path.join(desktop, name));
console.log(`Escritorio: ${name}${main !== name ? ` (antes "${main}")` : ""}\n  antes: ${before || "(nuevo)"}\n  ahora: ${exe}`);
// Otros accesos directos viejos de AlphaTerm en el escritorio: también a la versión nueva.
for (const f of ours.filter((f) => f !== main)) {
  point(path.join(desktop, f));
  console.log(`También actualizado: ${f}`);
}

// Anclado en la barra de tareas (si está): mismo nombre, apuntado a la versión nueva.
const pinned = path.join(process.env.APPDATA ?? "", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "AlphaTerm.lnk");
if (fs.existsSync(pinned)) {
  const was = point(pinned);
  console.log(`Barra de tareas: AlphaTerm.lnk\n  antes: ${was}\n  ahora: ${exe}`);
}

const old = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => path.join(base, d) !== dir) : [];
console.log(`\nAlphaTerm ${version} instalada en ${dir}.`);
if (old.length) console.log(`Versiones anteriores (no se borraron): ${old.join(", ")} en ${base}`);
console.log("La AlphaTerm que esté abierta sigue igual; la próxima vez que se abra desde el acceso directo es la nueva.");
