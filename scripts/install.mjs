#!/usr/bin/env node
// Installs the freshly built AlphaTerm into a per-version folder and points the shortcuts there.
//
// Windows:
// - Copies alphaterm.exe, conpty.dll and OpenConsole.exe to %LOCALAPPDATA%\AlphaTerm\versiones\<version>\.
// - Updates the desktop shortcut (creates it if missing) and the one pinned to the
//   taskbar (if present).
// Linux:
// - Copies alphaterm to ~/.local/share/AlphaTerm/versiones/<version>/ (XDG_DATA_HOME), with its icon.
// - Points the applications menu entry (~/.local/share/applications/alphaterm.desktop) there: the dock's
//   pinned icon uses that same file, so it follows. On the desktop folder (if there is one), the
//   "AlphaTerm <version>" launcher.
// The open AlphaTerm is not touched (it runs from another folder), so you can install with it
// open: the next time it is opened, it is the new one. Deletes nothing: earlier versions stay in their folder.
//
// Usage: node scripts/install.mjs [--desde <build folder>]   (default src-tauri/target/release)
// `npm run release` builds and then runs this.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const from = path.resolve(arg("--desde") ?? path.join(repo, "src-tauri", "target", "release"));
const version = JSON.parse(fs.readFileSync(path.join(repo, "src-tauri", "tauri.conf.json"), "utf8")).version;
const windows = process.platform === "win32";
const FILES = windows ? ["alphaterm.exe", "conpty.dll", "OpenConsole.exe"] : ["alphaterm"];

for (const f of FILES) {
  if (!fs.existsSync(path.join(from, f))) {
    console.error(`Falta ${f} en ${from}. ¿Se compiló? (npx tauri build --no-bundle)`);
    process.exit(1);
  }
}

const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(os.homedir(), ".local", "share");
const base = windows
  ? path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE, "AppData", "Local"), "AlphaTerm", "versiones")
  : path.join(dataHome, "AlphaTerm", "versiones");
/** Copies to the version's folder; if that version is open (files in use), to one next to it. */
function install() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  for (const dir of [path.join(base, version), path.join(base, `${version}-${stamp}`)]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of FILES) {
        fs.copyFileSync(path.join(from, f), path.join(dir, f));
        if (!windows) fs.chmodSync(path.join(dir, f), 0o755);
      }
      return dir;
    } catch (e) {
      // ETXTBSY: on Linux, the binary of a running version.
      if (e.code !== "EBUSY" && e.code !== "EPERM" && e.code !== "ETXTBSY") throw e;
      console.log(`${dir} está en uso (esa versión está abierta): se instala al lado.`);
    }
  }
  throw new Error("No se pudo copiar la versión nueva.");
}

const dir = install();
const old = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => path.join(base, d) !== dir) : [];
const done = () => {
  console.log(`\nAlphaTerm ${version} instalada en ${dir}.`);
  if (old.length) console.log(`Versiones anteriores (no se borraron): ${old.join(", ")} en ${base}`);
  console.log("La AlphaTerm que esté abierta sigue igual; la próxima vez que se abra desde el acceso directo es la nueva.");
};

if (!windows) {
  installLinux();
  done();
  process.exit(0);
}

/** Linux: menu entry (and desktop launcher) pointing to this version. */
function installLinux() {
  const exe = path.join(dir, "alphaterm");
  const icon = path.join(dir, "alphaterm.png");
  fs.copyFileSync(path.join(repo, "src-tauri", "icons", "128x128@2x.png"), icon);
  // A .desktop value: spaces and the rest go quoted in Exec (and % is doubled there).
  const execQ = `"${exe.replace(/(["`$\\])/g, "\\$1").replace(/%/g, "%%")}"`;
  const entry = (name) =>
    [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${name}`,
      "GenericName=Terminal",
      "Comment=Terminal liviana para trabajar con agentes de IA",
      `Exec=${execQ}`,
      `Icon=${icon}`,
      "Terminal=false",
      "Categories=System;TerminalEmulator;Development;",
      "Keywords=terminal;shell;agent;claude;codex;",
      // The window's WM_CLASS: so the dock groups it with this icon.
      "StartupWMClass=Alphaterm",
      "StartupNotify=true",
      `X-AlphaTerm-Version=${version}`,
      "",
    ].join("\n");
  const apps = path.join(dataHome, "applications");
  fs.mkdirSync(apps, { recursive: true });
  const menu = path.join(apps, "alphaterm.desktop");
  const before = fs.existsSync(menu) ? (fs.readFileSync(menu, "utf8").match(/^Exec=(.*)$/m)?.[1] ?? "") : "";
  fs.writeFileSync(menu, entry("AlphaTerm"));
  console.log(`Menú de aplicaciones: ${menu}\n  antes: ${before || "(nuevo)"}\n  ahora: ${exe}`);
  try {
    execFileSync("update-desktop-database", [apps], { stdio: "ignore" });
  } catch {
    /* optional: the menu picks it up anyway */
  }

  // Desktop: an "AlphaTerm <version>" launcher (the old ones are renamed and pointed to the new one).
  let desktop = "";
  try {
    desktop = execFileSync("xdg-user-dir", ["DESKTOP"], { encoding: "utf8" }).trim();
  } catch {
    desktop = path.join(os.homedir(), "Desktop");
  }
  if (!desktop || desktop === os.homedir() || !fs.existsSync(desktop)) return;
  const name = `AlphaTerm ${version}.desktop`;
  const ours = fs.readdirSync(desktop).filter((f) => /^AlphaTerm.*\.desktop$/i.test(f) && /X-AlphaTerm-Version=/.test(fs.readFileSync(path.join(desktop, f), "utf8")));
  const replaced = ours.filter((f) => f !== name);
  for (const f of replaced) fs.rmSync(path.join(desktop, f));
  const file = path.join(desktop, name);
  fs.writeFileSync(file, entry(`AlphaTerm ${version}`), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  // GNOME's desktop only launches the ones marked as trusted.
  try {
    execFileSync("gio", ["set", file, "metadata::trusted", "true"], { stdio: "ignore" });
  } catch {
    /* other desktops don't need it */
  }
  console.log(`Escritorio: ${name}${replaced.length ? ` (reemplaza a ${replaced.join(", ")})` : ""}`);
}

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

done();
