import { For, type JSX } from "solid-js";

export type PanelId = "agents" | "servers" | "projects" | "git";

/** Íconos de 18 px dibujados con trazos (heredan el color del texto). */
const svg = (d: JSX.Element) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {d}
  </svg>
);

export const PANELS: { id: PanelId; label: string; command: string; icon: () => JSX.Element }[] = [
  {
    id: "agents",
    label: "Agentes",
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
    label: "Servidores",
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
];

export function ActivityBar(props: { active: PanelId | null; onToggle: (p: PanelId) => void; help: [string, string][] }) {
  const keyOf = (label: string) => props.help.find(([, l]) => l === label)?.[0];
  return (
    <nav class="activity-bar" aria-label="Paneles">
      <For each={PANELS}>
        {(p) => (
          <button
            classList={{ on: props.active === p.id }}
            title={`${p.label}${keyOf(`Panel de ${p.label.toLowerCase()}`) ? ` (${keyOf(`Panel de ${p.label.toLowerCase()}`)})` : ""}`}
            aria-pressed={props.active === p.id}
            onClick={() => props.onToggle(p.id)}
          >
            {p.icon()}
          </button>
        )}
      </For>
    </nav>
  );
}
