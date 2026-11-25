import { For, Show } from "solid-js";
import { sideBySide, type DiffLine } from "./diff";

/** Table of a diff, unified or side by side (the classes are those of the git panel). */
export function DiffTable(props: { lines: DiffLine[]; split: boolean }) {
  return (
    <Show
      when={props.split}
      fallback={
        <table class="diff">
          <tbody>
            <For each={props.lines}>
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
          <For each={sideBySide(props.lines)}>
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
  );
}
