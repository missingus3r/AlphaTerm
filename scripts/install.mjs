#!/usr/bin/env node
// Installs the freshly built AlphaTerm into a per-version folder and points the shortcuts there.
//
// - Copies alphaterm.exe, conpty.dll and OpenConsole.exe to %LOCALAPPDATA%\AlphaTerm\versiones\<version>\.
//   The open AlphaTerm is not touched (it runs from another folder), so you can install with it
//   open: the next time it is opened, it is the new one.
// - Updates the desktop shortcut (creates it if missing) and the one pinned to the
//   taskbar (if present). Deletes nothing: earlier versions stay in their folder.
//
// Usage: node scripts/install.mjs [--desde <build folder>]   (default src-tauri\target\release)
// `npm run release` builds and then runs this.
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
/** Copies to the version's folder; if that version is open (files in use), to one next to it. */
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

// Shortcuts: through inline PowerShell (WScript.Shell), which works even if .ps1 files are blocked.
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
const q = (s) => `'${s.replace(/'/g, "''")}'`;
/** Points a shortcut (new or existing) to the installed version. Returns where it pointed. */
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

// Desktop: an "AlphaTerm <version>" shortcut. If there was already an AlphaTerm one (any
// version), it is pointed to the new one and renamed; otherwise, it is created.
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
// Other old AlphaTerm shortcuts on the desktop: also to the new version.
for (const f of ours.filter((f) => f !== main)) {
  point(path.join(desktop, f));
  console.log(`También actualizado: ${f}`);
}

// Pinned to the taskbar (if present): same name, pointed to the new version.
const pinned = path.join(process.env.APPDATA ?? "", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "AlphaTerm.lnk");
if (fs.existsSync(pinned)) {
  const was = point(pinned);
  console.log(`Barra de tareas: AlphaTerm.lnk\n  antes: ${was}\n  ahora: ${exe}`);
}

const old = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => path.join(base, d) !== dir) : [];
console.log(`\nAlphaTerm ${version} instalada en ${dir}.`);
if (old.length) console.log(`Versiones anteriores (no se borraron): ${old.join(", ")} en ${base}`);
console.log("La AlphaTerm que esté abierta sigue igual; la próxima vez que se abra desde el acceso directo es la nueva.");
