import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerHere, versionsHome, versionsTool } from "./app-versions.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "at-av-"));

describe("app-versions helper", () => {
  it("finds the local folder like app-versions does", () => {
    expect(versionsHome({ APP_VERSIONS_HOME: "/x" }, "linux")).toBe("/x");
    expect(versionsHome({ LOCALAPPDATA: "C:\L" }, "win32")).toBe(path.win32.join("C:\L", "app-versions"));
    expect(versionsHome({ HOME: "/h", XDG_DATA_HOME: "rel" }, "linux")).toBe("/h/.local/share/app-versions");
  });

  it("points at a script of the registered versions repo, or null without config", () => {
    const home = tmp();
    expect(versionsTool("check.mjs", { APP_VERSIONS_HOME: home })).toBeNull();
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ versionsRepo: path.join(home, "v"), apps: {} }));
    expect(versionsTool("check.mjs", { APP_VERSIONS_HOME: home })).toBe(path.join(home, "v", "bin", "check.mjs"));
  });

  it("registers this repo only when the computer has the versions repo set up", () => {
    const home = tmp();
    registerHere("/code/alphaterm", { APP_VERSIONS_HOME: home });
    expect(fs.existsSync(path.join(home, "config.json"))).toBe(false);
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ versionsRepo: "/v", apps: {} }));
    registerHere("/code/alphaterm", { APP_VERSIONS_HOME: home });
    expect(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).apps).toEqual({ alphaterm: { repo: "/code/alphaterm" } });
  });
});
