import { For, type JSX } from "solid-js";
import { k, t } from "../i18n";
import { COMMANDS } from "../layout/shortcuts";

export type PanelId = "agents" | "servers" | "projects" | "git" | "history" | "docker" | "changes";

/** Íconos de 18 px dibujados con trazos (heredan el color del texto). */
const svg = (d: JSX.Element) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {d}
  </svg>
);

export const PANELS: { id: PanelId; label: string; command: string; icon: () => JSX.Element }[] = [
  {
    id: "agents",
    label: k("Agentes"),
    command: "panelAgents",
    icon: () =>
      svg(
        <>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
        </>,
      ),
  },
  {
    id: "servers",
    label: k("Servidores"),
    command: "panelServers",
    icon: () =>
      svg(
        <>
          <rect x="3" y="4" width="18" height="7" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
        </>,
      ),
  },
  {
    id: "projects",
    label: k("Proyectos"),
    command: "panelProjects",
    icon: () => svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  },
  {
    id: "git",
    label: "Git",
    command: "panelGit",
    icon: () =>
      svg(
        <>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="6" cy="18" r="2.2" />
          <circle cx="18" cy="8" r="2.2" />
          <path d="M6 8.2v7.6M18 10.2c0 4-6 3.5-10.5 6.3" />
        </>,
      ),
  },
  {
    id: "changes",
    label: k("Modificaciones"),
    command: "panelChanges",
    icon: () =>
      svg(
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9.5 12.5h5M12 10v5M9.5 17.5h5" />
        </>,
      ),
  },
  {
    id: "history",
    label: k("Historial"),
    command: "panelHistory",
    icon: () =>
      svg(
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </>,
      ),
  },
  {
    id: "docker",
    label: "Docker",
    command: "panelDocker",
    icon: () =>
      svg(
        <>
          <path d="M3 12h16c-.5 4-4 7-9 7-4 0-6.5-2.5-7-7z" />
          <path d="M5 12V9h3v3M8 12V9h3v3M11 12V9h3v3M8 9V6h3v3M19.5 11.5c.8-.2 1.5-.9 1.5-2" />
        </>,
      ),
  },
];

export function ActivityBar(props: { isOpen: (p: PanelId) => boolean; onToggle: (p: PanelId) => void; help: [string, string][] }) {
  // El atajo se busca por el id del comando del panel: su etiqueta (en español o ya traducida, según
  // cómo arme la ayuda `shortcutHelp`) es la que figura en `help`.
  const keyOf = (command: string) => {
    const label = COMMANDS.find((c) => c.id === command)?.label;
    return label ? props.help.find(([, l]) => l === label || l === t(label))?.[0] : undefined;
  };
  return (
    <nav class="activity-bar" aria-label={t("Paneles")}>
      <For each={PANELS}>
        {(p) => (
          <button
            classList={{ on: props.isOpen(p.id) }}
            title={`${t(p.label)}${keyOf(p.command) ? ` (${keyOf(p.command)})` : ""}`}
            aria-pressed={props.isOpen(p.id)}
            onClick={() => props.onToggle(p.id)}
          >
            {p.icon()}
          </button>
        )}
      </For>
    </nav>
  );
}
