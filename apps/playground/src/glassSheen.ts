/** Glass surfaces that catch the pointer: sets --glass-x / --glass-y on each
 * surface under the pointer (percent of its box). Returns a cleanup. */
const SURFACES = ".orbital-active .inspector-sheet, .pi-console, .pi-review-progress, .faculty-sheet, .orbital-hover-card, .glass-frame";

export function attachGlassSheen(root: Document = document): () => void {
  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    if (!last) return;
    for (const surface of root.querySelectorAll<HTMLElement>(SURFACES)) {
      const box = surface.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const x = (last.clientX - box.left) / box.width, y = (last.clientY - box.top) / box.height;
      if (x < -0.3 || x > 1.3 || y < -0.3 || y > 1.3) continue;
      surface.style.setProperty("--glass-x", `${Math.round(x * 100)}%`);
      surface.style.setProperty("--glass-y", `${Math.round(y * 100)}%`);
    }
  };
  const move = (event: PointerEvent) => { last = event; if (!frame) frame = requestAnimationFrame(apply); };
  root.addEventListener("pointermove", move, { passive: true });
  return () => { root.removeEventListener("pointermove", move); if (frame) cancelAnimationFrame(frame); };
}
