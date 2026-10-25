import { classifySwipe, type Swipe } from "./data/gestures";

/** Calls `onSwipe` for touch swipes on `element`. Returns a cleanup. */
export function attachSwipe(element: HTMLElement, onSwipe: (swipe: Swipe) => void): () => void {
  let start: { x: number; y: number; t: number; id: number } | null = null;
  const down = (event: PointerEvent) => { if (event.pointerType !== "mouse") start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId }; };
  const up = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    const swipe = classifySwipe(event.clientX - start.x, event.clientY - start.y, event.timeStamp - start.t);
    start = null;
    if (swipe) onSwipe(swipe);
  };
  const cancel = () => { start = null; };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  return () => { element.removeEventListener("pointerdown", down); element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", cancel); };
}
