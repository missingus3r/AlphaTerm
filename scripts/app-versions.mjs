// Link to app-versions (github.com/missingus3r/app-versions), the repo that publishes my apps' versions and
// updates them on my other computers. This same file lives in each app; only APP_ID changes.
//
// The per-computer folder (never in a repo) holds config.json with the clone of app-versions and where each
// app's code is. Same rule as app-versions/lib/home.mjs:
//   Windows: %LOCALAPPDATA%\app-versions
//   Linux:   $XDG_DATA_HOME/app-versions (only if absolute), else ~/.local/share/app-versions
//   APP_VERSIONS_HOME overrides both.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_ID = "alphaterm";

export function versionsHome(env = process.env, platform = process.platform) {
  if (env.APP_VERSIONS_HOME) return env.APP_VERSIONS_HOME;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? path.win32.join(env.USERPROFILE ?? os.homedir(), "AppData", "Local");
    return path.win32.join(base, "app-versions");
  }
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(env.HOME ?? os.homedir(), ".local", "share");
  return path.posix.join(base, "app-versions");
}

function readConfig(env) {
  try {
    return JSON.parse(fs.readFileSync(path.join(versionsHome(env), "config.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Path to <versions repo>/bin/<script>, or null when this computer has no app-versions set up. */
export function versionsTool(script, env = process.env) {
  const cfg = readConfig(env);
  return cfg?.versionsRepo ? path.join(cfg.versionsRepo, "bin", script) : null;
}

/** Runs an app-versions script with node (output to this console). Returns its exit code (1 if it's missing). */
export function runVersionsTool(script, args, env = process.env) {
  const tool = versionsTool(script, env);
  if (!tool) return 1;
  const r = spawnSync(process.execPath, [tool, ...args], { stdio: "inherit", env, windowsHide: true });
  return r.status ?? 1;
}

/** Records where this app's code lives on this computer (only if app-versions is set up here). */
export function registerHere(repo, env = process.env) {
  const cfg = readConfig(env);
  if (!cfg?.versionsRepo) return;
  cfg.apps = cfg.apps ?? {};
  if (cfg.apps[APP_ID]?.repo === repo) return;
  cfg.apps[APP_ID] = { repo };
  const file = path.join(versionsHome(env), "config.json");
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}
