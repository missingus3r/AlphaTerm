import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

/**
 * Text that scrolls if it doesn't fit. It pauses with the mouse over it and respects
 * prefers-reduced-motion (then it stays with an ellipsis). The tooltip shows the whole text.
 */
export function Marquee(props: { text: string; class?: string; style?: Record<string, string> }) {
  let outer!: HTMLSpanElement;
  let inner!: HTMLSpanElement;
  const [shift, setShift] = createSignal(0);

  const measure = () => {
    const over = inner.scrollWidth - outer.clientWidth;
    setShift(over > 2 ? over + 12 : 0);
  };

  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => {
    void props.text;
    queueMicrotask(measure);
  });

  return (
    <span ref={outer} class={`marquee ${props.class ?? ""}`} classList={{ scrolling: shift() > 0 }} title={props.text} style={props.style}>
      <span
        ref={inner}
        class="marquee-inner"
        style={{
          "--shift": `${shift()}px`,
          // ~35 px per second, with pauses at the ends (see keyframes).
          "--dur": `${Math.max(4, shift() / 35 + 3)}s`,
        }}
      >
        {props.text}
      </span>
    </span>
  );
}
