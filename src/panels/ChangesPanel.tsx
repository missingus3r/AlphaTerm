import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { askConfirm } from "../widgets/confirm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseDiff } from "./diff";
import { DiffTable } from "./DiffTable";
import { changeTags, matchesFilter, totals, type ChangeFilter, type ChangeSummary } from "./changes";
import { ago } from "../widgets/format";
import { t } from "../i18n";

interface DiffOut {
  text: string;
  note: string | null;
}
interface Editable {
  text: string;
  token: string;
  enc: string;
  crlf: boolean;
}

const SPLIT_PREF = "alphaterm.changes.split";

/** A file: header (click = open/close), diff and editor. */
function FileCard(props: { c: ChangeSummary; open: boolean; split: boolean; onToggle: () => void; onRemove: () => void }) {
  const name = () => props.c.path.split(/[\\/]/).pop() ?? props.c.path;
  const dir = () => props.c.path.slice(0, Math.max(0, props.c.path.length - name().length - 1));
  // The diff is requested when it opens and again when the file changes (the version goes up).
  const [diff, { refetch }] = createResource(
    () => (props.open ? `${props.c.id}:${props.c.version}` : false),
    () => invoke<DiffOut>("changes_diff", { id: props.c.id }),
  );
  const lines = createMemo(() => (diff()?.text ? parseDiff(diff()!.text) : []));
  const [edit, setEdit] = createSignal<Editable | null>(null);
  const [draft, setDraft] = createSignal("");
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = createSignal(false);
  const dirty = () => !!edit() && draft() !== edit()!.text;

  const startEdit = async () => {
    setMsg(null);
    try {
      const e = await invoke<Editable>("changes_read", { id: props.c.id });
      setEdit(e);
      setDraft(e.text);
      if (!props.open) props.onToggle();
    } catch (err) {
      setMsg({ ok: false, text: String(err) });
    }
  };
  const save = async () => {
    const e = edit();
    if (!e || saving()) return;
    setSaving(true);
    try {
      await invoke("changes_save", { id: props.c.id, text: draft(), token: e.token, enc: e.enc, crlf: e.crlf });
      setEdit(null);
      setMsg({ ok: true, text: t("Guardado.") });
      setTimeout(() => setMsg((m) => (m?.ok ? null : m)), 2500);
      void refetch();
    } catch (err) {
      setMsg({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
    }
  };
  const cancel = async () => {
    if (dirty() && !(await askConfirm(t("¿Descartar lo que editaste en este archivo?"), t("Descartar")))) return;
    setEdit(null);
    setMsg(null);
  };
  const open = (how: "default" | "explorer" | "code") => {
    const path = how === "explorer" ? dir() || props.c.path : props.c.path;
    void invoke("fs_open", { path, with: how }).catch((e) => setMsg({ ok: false, text: String(e) }));
  };

  return (
    <li class="change" classList={{ open: props.open, deleted: props.c.deleted }}>
      <div class="change-head" onClick={props.onToggle} title={`${props.c.path}\n${props.c.agents.join(", ")}${props.c.tools.length ? ` · ${props.c.tools.join(", ")}` : ""}`}>
        <span class="chev">{props.open ? "▾" : "▸"}</span>
        <span class="change-name">
          <b>{name()}</b> <small>{dir()}</small>
        </span>
        <span class="diff-count">
          <Show when={props.c.kind === "text"} fallback={<span class="muted small">{props.c.kind === "binary" ? t("binario") : props.c.kind === "tooBig" ? t("grande") : "?"}</span>}>
            <span class="add">+{props.c.adds}</span> <span class="del">−{props.c.dels}</span>
          </Show>
        </span>
      </div>
      <div class="change-meta">
        <For each={changeTags(props.c)}>{(tag) => <span class={`badge ${tag.cls}`} title={t(tag.title)}>{t(tag.label)}</span>}</For>
        <span class="muted small">
          {props.c.agents.join(" + ")} · {ago(props.c.lastAt)}
        </span>
        <span class="grow" />
        <Show when={props.c.editable && !edit()}>
          <button class="link small" onClick={() => void startEdit()} title={t("Editar el archivo acá")}>
            {t("Editar")}
          </button>
        </Show>
        <Show when={!props.c.deleted}>
          <button class="link small" onClick={() => open("default")} title={t("Abrir con el programa de Windows")}>
            {t("Abrir")}
          </button>
        </Show>
        <button class="link small" onClick={() => open("explorer")} title={t("Mostrar la carpeta")}>
          {t("Carpeta")}
        </button>
        <button class="icon-btn tiny-x" onClick={props.onRemove} title={t("Sacar de la lista (no toca el archivo)")}>
          ×
        </button>
      </div>
      <Show when={msg()}>
        <div class="banner" classList={{ ok: msg()!.ok }} onClick={() => setMsg(null)}>
          {msg()!.text}
        </div>
      </Show>
      <Show when={props.open}>
        <Show
          when={edit()}
          fallback={
            <div class="change-body">
              <Show when={!diff.loading || diff()} fallback={<p class="muted small">{t("Cargando…")}</p>}>
                <Show when={!diff.error} fallback={<div class="banner">{String(diff.error)}</div>}>
                  <Show when={diff()?.note}>
                    <p class="muted small change-note">{diff()!.note}</p>
                  </Show>
                  <Show when={lines().length}>
                    <DiffTable lines={lines()} split={props.split} />
                  </Show>
                </Show>
              </Show>
            </div>
          }
        >
          <div class="change-edit">
            <textarea
              class="text mono"
              spellcheck={false}
              value={draft()}
              rows={Math.min(30, Math.max(8, draft().split("\n").length + 1))}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "s" && e.ctrlKey) {
                  e.preventDefault();
                  void save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                } else if (e.key === "Tab" && !e.shiftKey) {
                  // Tab inserts a tab character (it doesn't jump to the button next to it).
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const [a, b] = [ta.selectionStart, ta.selectionEnd];
                  ta.setRangeText("\t", a, b, "end");
                  setDraft(ta.value);
                }
              }}
            />
            <div class="change-edit-bar">
              <span class="muted small">
                {edit()!.enc === "utf8" ? "UTF-8" : edit()!.enc} · {edit()!.crlf ? "CRLF" : "LF"}
                {dirty() ? ` · ${t("sin guardar")}` : ""}
              </span>
              <span class="grow" />
              <button class="btn" onClick={cancel}>
                {t("Cancelar")}
              </button>
              <button class="btn commit" disabled={!dirty() || saving()} onClick={() => void save()} title="Ctrl+S">
                {saving() ? t("Guardando…") : t("Guardar")}
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </li>
  );
}

export default function ChangesPanel() {
  const [list, { refetch }] = createResource(() => invoke<ChangeSummary[]>("changes_list"));
  const [open, setOpen] = createSignal<Set<number>>(new Set());
  const [filter, setFilter] = createSignal<ChangeFilter>("all");
  const [query, setQuery] = createSignal("");
  const [split, setSplitRaw] = createSignal((() => {
    try {
      return localStorage.getItem(SPLIT_PREF) === "1";
    } catch {
      return false;
    }
  })());
  const setSplit = (v: boolean) => {
    setSplitRaw(v);
    try {
      localStorage.setItem(SPLIT_PREF, v ? "1" : "0");
    } catch {
      /* doesn't matter */
    }
  };
  onMount(async () => {
    const un = await listen("changes-updated", () => void refetch());
    onCleanup(un);
  });
  const shown = createMemo(() => (list() ?? []).filter((c) => matchesFilter(c, filter(), query())));
  // Iterated by id: this way a new list (it arrives with every change) doesn't recreate the cards and what is being
  // edited isn't lost.
  const byId = createMemo(() => new Map((list() ?? []).map((c) => [c.id, c])));
  const shownIds = createMemo(() => shown().map((c) => c.id));
  const tot = createMemo(() => totals(shown()));
  const toggle = (id: number) => {
    const s = new Set(open());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setOpen(s);
  };
  const remove = (ids?: number[]) => void invoke("changes_remove", { ids: ids ?? null }).then(() => refetch());

  return (
    <div class="panel changes-panel">
      <header class="panel-head">
        <h2>{t("Modificaciones")}</h2>
        <button class="icon-btn" classList={{ spin: list.loading }} title={t("Actualizar")} onClick={() => void refetch()}>
          ↻
        </button>
      </header>
      <div class="changes-tools">
        <input class="text" placeholder={t("Filtrar por nombre o carpeta")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        <select class="text" value={filter()} onChange={(e) => setFilter(e.currentTarget.value as ChangeFilter)} title={t("Qué archivos mostrar")}>
          <option value="all">{t("Todos")}</option>
          <option value="nogit">{t("Sin git")}</option>
          <option value="git">{t("En git")}</option>
        </select>
      </div>
      <div class="changes-bar">
        <span class="small">
          {tot().files === 1 ? t("1 archivo") : t("{n} archivos", { n: tot().files })} · <span class="add">+{tot().adds}</span> <span class="del">−{tot().dels}</span>
        </span>
        <span class="grow" />
        <button class="link small" disabled={!shown().length} onClick={() => setOpen(new Set(shown().map((c) => c.id)))}>
          {t("Abrir todos")}
        </button>
        <button class="link small" disabled={!open().size} onClick={() => setOpen(new Set<number>())}>
          {t("Colapsar todos")}
        </button>
        <button class="link small" onClick={() => setSplit(!split())}>
          {split() ? t("Unificado") : t("Lado a lado")}
        </button>
        <button
          class="link small danger"
          disabled={!(list() ?? []).length}
          onClick={async () => (await askConfirm(t("¿Vaciar la lista de modificaciones? Los archivos no se tocan."), t("Vaciar"))) && remove()}
        >
          {t("Limpiar")}
        </button>
      </div>
      <ul class="changes">
        <For
          each={shownIds()}
          fallback={
            <li class="muted small changes-empty">
              {list.loading
                ? t("Cargando…")
                : (list() ?? []).length
                  ? t("Nada con ese filtro.")
                  : t("Todavía nada. Acá aparece lo que cambien los agentes (Claude Code lanzado desde AlphaTerm, y cualquier agente en la carpeta de su pestaña), con o sin git.")}
            </li>
          }
        >
          {(id) => (
            <Show when={byId().get(id)}>
              <FileCard c={byId().get(id)!} open={open().has(id)} split={split()} onToggle={() => toggle(id)} onRemove={() => remove([id])} />
            </Show>
          )}
        </For>
      </ul>
    </div>
  );
}
