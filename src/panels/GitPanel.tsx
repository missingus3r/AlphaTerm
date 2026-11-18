import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { countChanges, parseDiff, sideBySide, STATUS_WORD, type DiffLine } from "./diff";
import { projectName } from "./projects";

interface FileChange {
  path: string;
  orig: string | null;
  index: string;
  work: string;
  conflict: boolean;
}
interface Status {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}
interface LogRow {
  graph: string;
  hash: string | null;
  short: string | null;
  author: string | null;
  when: string | null;
  subject: string | null;
  refs: string | null;
}
interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
}

interface Props {
  /** Carpeta de la que partir (la del proyecto elegido o la del panel activo). */
  dir?: string;
  onChanged: () => void;
  onTerminal: (dir: string) => void;
}

type View = "changes" | "log" | "branches";
type Sel = { kind: "file"; path: string; staged: boolean; untracked: boolean } | { kind: "commit"; hash: string };

export default function GitPanel(props: Props) {
  const [root] = createResource(
    () => props.dir ?? "",
    async (d) => (d ? invoke<string | null>("git_root", { dir: d }) : null),
  );
  const [view, setView] = createSignal<View>("changes");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [sel, setSel] = createSignal<Sel | null>(null);
  const [split, setSplit] = createSignal(false);
  const [message, setMessage] = createSignal("");

  const [status, { refetch: refetchStatus }] = createResource(
    () => root() ?? false,
    (r) => (r ? invoke<Status>("git_status", { root: r }) : Promise.resolve(null)),
  );
  const [log, { refetch: refetchLog }] = createResource(
    () => (view() === "log" && root() ? root()! : false),
    (r) => invoke<LogRow[]>("git_log", { root: r, limit: 300 }),
  );
  const [branches, { refetch: refetchBranches }] = createResource(
    () => (view() === "branches" && root() ? root()! : false),
    (r) => invoke<Branch[]>("git_branches", { root: r }),
  );
  const [diff] = createResource(
    () => {
      const s = sel();
      return root() && s ? { r: root()!, s } : false;
    },
    async ({ r, s }) =>
      s.kind === "file"
        ? invoke<string>("git_diff", { root: r, path: s.path, staged: s.staged, untracked: s.untracked })
        : invoke<string>("git_show", { root: r, hash: s.hash }),
  );
  const lines = createMemo<DiffLine[]>(() => (diff() ? parseDiff(diff()!) : []));

  const refresh = () => {
    void refetchStatus();
    if (view() === "log") void refetchLog();
    if (view() === "branches") void refetchBranches();
    props.onChanged();
  };
  // Mientras el panel está abierto, el estado se refresca cada 4 s (barato) y al volver a la ventana.
  createEffect(
    on(root, (r) => {
      if (!r) return;
      const t = setInterval(() => !document.hidden && !busy() && void refetchStatus(), 4000);
      onCleanup(() => clearInterval(t));
    }),
  );

  const staged = () => (status()?.files ?? []).filter((f) => f.index !== "." && f.index !== "?" && !f.conflict);
  const unstaged = () => (status()?.files ?? []).filter((f) => f.work !== "." || f.conflict);

  const act = async (label: string, f: () => Promise<unknown>, okText?: (r: unknown) => string) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await f();
      if (okText) setMsg({ ok: true, text: okText(r) });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const stage = (paths: string[], on: boolean) => act(on ? "stage" : "unstage", () => invoke("git_stage", { root: root(), paths, stage: on }));
  const commit = () =>
    act(
      "commit",
      () => invoke<string>("git_commit", { root: root(), message: message() }),
      (r) => {
        setMessage("");
        return `Commit hecho: ${r}`;
      },
    );
  const remote = (op: "fetch" | "pull" | "push") => act(op, () => invoke<string>("git_remote", { root: root(), op }), (r) => String(r));
  const switchTo = (name: string, create: boolean) => {
    if (!create && (status()?.files.length ?? 0) > 0 && !confirm(`Hay ${status()!.files.length} cambios sin commitear. ¿Cambiar a ${name} igual? Git no deja cambiar si se pisarían.`)) return;
    void act("switch", () => invoke<string>("git_switch", { root: root(), branch: name, create }), () => `Ahora en ${name}`);
  };
  const [newBranch, setNewBranch] = createSignal("");

  const [cloneUrl, setCloneUrl] = createSignal("");
  const clone = async () => {
    const parent = await open({ directory: true, title: "Carpeta donde clonar" });
    if (typeof parent !== "string") return;
    void act("clone", () => invoke<string>("git_clone", { url: cloneUrl(), parent }), (r) => {
      props.onTerminal(String(r));
      return `Clonado en ${r}`;
    });
  };

  const fileLabel = (f: FileChange, stagedSide: boolean) => {
    const code = stagedSide ? f.index : f.conflict ? "U" : f.work;
    return { code, word: STATUS_WORD[code] ?? code };
  };

  function FileRow(fp: { f: FileChange; stagedSide: boolean }) {
    const l = () => fileLabel(fp.f, fp.stagedSide);
    const isSel = () => {
      const s = sel();
      return s?.kind === "file" && s.path === fp.f.path && s.staged === fp.stagedSide;
    };
    return (
      <li
        class="git-file"
        classList={{ on: isSel() }}
        onClick={() => setSel({ kind: "file", path: fp.f.path, staged: fp.stagedSide, untracked: fp.f.work === "?" && !fp.stagedSide })}
        title={`${fp.f.path}${fp.f.orig ? ` (antes ${fp.f.orig})` : ""} · ${l().word}`}
      >
        <span class={`git-code c-${l().code === "?" ? "U2" : l().code}`}>{l().code === "?" ? "U" : l().code}</span>
        <span class="git-path">
          <b>{fp.f.path.split("/").pop()}</b> <small>{fp.f.path.includes("/") ? fp.f.path.slice(0, fp.f.path.lastIndexOf("/")) : ""}</small>
        </span>
        <button
          class="icon-btn tiny show"
          title={fp.stagedSide ? "Sacar del commit (unstage)" : "Agregar al commit (stage)"}
          onClick={(e) => {
            e.stopPropagation();
            void stage([fp.f.path], !fp.stagedSide);
          }}
        >
          {fp.stagedSide ? "−" : "+"}
        </button>
      </li>
    );
  }

  return (
    <div class="panel git-panel">
      <header class="panel-head">
        <h2>Git</h2>
        <button class="icon-btn" classList={{ spin: !!busy() || status.loading }} title="Actualizar" onClick={refresh}>
          ↻
        </button>
      </header>

      <Show when={!root.loading}>
        <Show
          when={root()}
          fallback={
            <div class="git-empty">
              <p class="muted small">{props.dir ? `${props.dir} no está en un repo git.` : "Elegí un proyecto o abrí una terminal en un repo."}</p>
              <Show when={props.dir}>
                <button
                  class="btn"
                  onClick={() => {
                    if (confirm(`¿Crear un repo git nuevo en ${props.dir}?`)) void act("init", () => invoke("git_init", { dir: props.dir }), () => "Repo creado.");
                  }}
                >
                  Inicializar un repo acá
                </button>
              </Show>
              <div class="field">
                <label>Clonar desde una URL</label>
                <div class="dir-row">
                  <input class="text mono" placeholder="https://github.com/usuario/repo.git" value={cloneUrl()} onInput={(e) => setCloneUrl(e.currentTarget.value)} />
                  <button class="btn" disabled={!cloneUrl().trim() || !!busy()} onClick={() => void clone()}>
                    Clonar…
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <div class="git-repo" title={root()!}>
            <b>{projectName(root()!)}</b>
            <span class="git-branch">
              ⎇ {status()?.branch ?? (status()?.oid ? `(detached ${status()!.oid!.slice(0, 7)})` : "sin commits")}
              <Show when={status()?.ahead}>
                <span class="ab" title="Commits para subir">
                  ↑{status()!.ahead}
                </span>
              </Show>
              <Show when={status()?.behind}>
                <span class="ab" title="Commits para bajar">
                  ↓{status()!.behind}
                </span>
              </Show>
            </span>
          </div>
          <div class="git-remote">
            <button class="btn" disabled={!!busy()} onClick={() => void remote("fetch")} title="git fetch --all --prune">
              Fetch
            </button>
            <button class="btn" disabled={!!busy()} onClick={() => void remote("pull")} title="git pull --ff-only">
              Pull
            </button>
            <button class="btn" disabled={!!busy()} onClick={() => void remote("push")} title="git push (o push -u origin HEAD si la rama no tiene upstream)">
              Push
            </button>
            <Show when={busy()}>
              <span class="muted small">{busy()}…</span>
            </Show>
          </div>
          <Show when={msg()}>
            <div class="banner pre" classList={{ ok: msg()!.ok }} onClick={() => setMsg(null)}>
              {msg()!.text}
            </div>
          </Show>
          <div class="segmented small">
            <button classList={{ on: view() === "changes" }} onClick={() => setView("changes")}>
              Cambios{status()?.files.length ? ` (${status()!.files.length})` : ""}
            </button>
            <button classList={{ on: view() === "log" }} onClick={() => setView("log")}>
              Historial
            </button>
            <button classList={{ on: view() === "branches" }} onClick={() => setView("branches")}>
              Ramas
            </button>
          </div>

          <Show when={view() === "changes"}>
            <textarea
              class="text commit-msg"
              rows={3}
              placeholder={staged().length ? "Mensaje del commit" : "Agregá archivos al commit (+) para poder commitear"}
              value={message()}
              onInput={(e) => setMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey && staged().length && message().trim()) void commit();
              }}
            />
            <button class="btn commit" disabled={!staged().length || !message().trim() || !!busy()} onClick={() => void commit()} title="Ctrl+Enter">
              Commit ({staged().length})
            </button>
            <h3>
              Para el commit
              <Show when={staged().length}>
                <button class="link small" onClick={() => void stage(staged().map((f) => f.path), false)}>
                  sacar todos
                </button>
              </Show>
            </h3>
            <ul class="git-files">
              <For each={staged()} fallback={<li class="muted small">Nada todavía.</li>}>
                {(f) => <FileRow f={f} stagedSide={true} />}
              </For>
            </ul>
            <h3>
              Cambios
              <Show when={unstaged().length}>
                <button class="link small" onClick={() => void stage(unstaged().map((f) => f.path), true)}>
                  agregar todos
                </button>
              </Show>
            </h3>
            <ul class="git-files">
              <For each={unstaged()} fallback={<li class="muted small">Sin cambios.</li>}>
                {(f) => <FileRow f={f} stagedSide={false} />}
              </For>
            </ul>
          </Show>

          <Show when={view() === "log"}>
            <ul class="git-log">
              <For each={log() ?? []} fallback={<li class="muted small">{log.loading ? "Cargando…" : "Sin commits."}</li>}>
                {(r) => (
                  <li
                    classList={{ on: (() => { const s = sel(); return s?.kind === "commit" && s.hash === r.hash; })(), clickable: !!r.hash }}
                    onClick={() => r.hash && setSel({ kind: "commit", hash: r.hash })}
                    title={r.hash ? `${r.hash}\n${r.author} · ${r.when}` : ""}
                  >
                    <span class="graph">{r.graph}</span>
                    <Show when={r.hash}>
                      <span class="log-text">
                        <Show when={r.refs}>
                          <span class="refs">{r.refs}</span>
                        </Show>
                        {r.subject}
                        <small>
                          {" "}
                          {r.short} · {r.author} · {r.when}
                        </small>
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={view() === "branches"}>
            <div class="dir-row">
              <input class="text mono" placeholder="nueva-rama" value={newBranch()} onInput={(e) => setNewBranch(e.currentTarget.value)} />
              <button
                class="btn"
                disabled={!newBranch().trim() || !!busy()}
                onClick={() => {
                  switchTo(newBranch().trim(), true);
                  setNewBranch("");
                }}
              >
                Crear y cambiar
              </button>
            </div>
            <ul class="git-branches">
              <For each={(branches() ?? []).filter((b) => !b.remote)}>
                {(b) => (
                  <li classList={{ current: b.current }} onClick={() => !b.current && switchTo(b.name, false)} title={b.current ? "Rama actual" : `Cambiar a ${b.name}`}>
                    <span>{b.current ? "●" : "○"}</span> {b.name}
                    <Show when={b.upstream}>
                      <small> → {b.upstream}</small>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <h3>Remotas</h3>
            <ul class="git-branches remote">
              <For each={(branches() ?? []).filter((b) => b.remote)} fallback={<li class="muted small">Ninguna (¿falta un fetch?).</li>}>
                {(b) => (
                  <li
                    onClick={() => switchTo(b.name.split("/").slice(1).join("/"), false)}
                    title={`Cambiar a ${b.name.split("/").slice(1).join("/")} (git crea la rama local que sigue a ${b.name})`}
                  >
                    <span>○</span> {b.name}
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={sel()}>
            <div class="diff-box">
              <div class="diff-head">
                <span class="mono small">
                  {(() => {
                    const s = sel()!;
                    return s.kind === "file" ? `${s.path}${s.staged ? " (en el commit)" : ""}` : `commit ${s.hash.slice(0, 10)}`;
                  })()}
                </span>
                <span class="diff-count">
                  <span class="add">+{countChanges(lines()).add}</span> <span class="del">−{countChanges(lines()).del}</span>
                </span>
                <button class="link small" onClick={() => setSplit(!split())}>
                  {split() ? "Unificado" : "Lado a lado"}
                </button>
                <button class="icon-btn" title="Cerrar" onClick={() => setSel(null)}>
                  ×
                </button>
              </div>
              <Show when={!diff.loading} fallback={<p class="muted small">Cargando…</p>}>
                <Show when={!diff.error} fallback={<div class="banner">{String(diff.error)}</div>}>
                  <Show
                    when={split()}
                    fallback={
                      <table class="diff">
                        <tbody>
                          <For each={lines()}>
                            {(l) => (
                              <tr class={`d-${l.kind}`}>
                                <td class="no">{l.oldNo ?? ""}</td>
                                <td class="no">{l.newNo ?? ""}</td>
                                <td class="code">
                                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
                                  {l.text}
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    }
                  >
                    <table class="diff split">
                      <tbody>
                        <For each={sideBySide(lines())}>
                          {(r) =>
                            r.full ? (
                              <tr class={`d-${r.full.kind}`}>
                                <td colSpan={4} class="code">
                                  {r.full.text}
                                </td>
                              </tr>
                            ) : (
                              <tr>
                                <td class="no">{r.left?.oldNo ?? ""}</td>
                                <td class={`code ${r.left ? `d-${r.left.kind}` : "d-empty"}`}>{r.left?.text ?? ""}</td>
                                <td class="no">{r.right?.newNo ?? ""}</td>
                                <td class={`code ${r.right ? `d-${r.right.kind}` : "d-empty"}`}>{r.right?.text ?? ""}</td>
                              </tr>
                            )
                          }
                        </For>
                      </tbody>
                    </table>
                  </Show>
                </Show>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
