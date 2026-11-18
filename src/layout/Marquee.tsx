import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

/**
 * Texto que se desplaza si no entra. Se pausa con el mouse encima y respeta
 * prefers-reduced-motion (ahí queda con puntos suspensivos). El tooltip muestra el texto entero.
 */
export function Marquee(props: { text: string; class?: string }) {
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
    <span ref={outer} class={`marquee ${props.class ?? ""}`} classList={{ scrolling: shift() > 0 }} title={props.text}>
      <span
        ref={inner}
        class="marquee-inner"
        style={{
          "--shift": `${shift()}px`,
          // ~35 px por segundo, con pausas en los extremos (ver keyframes).
          "--dur": `${Math.max(4, shift() / 35 + 3)}s`,
        }}
      >
        {props.text}
      </span>
    </span>
  );
}
