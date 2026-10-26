import { useLayoutEffect, useState, type CSSProperties } from "react";

/**
 * The page's floating chrome (heading and view switch on top; transport,
 * pipeline and review bars below) sits over the stage. Full-screen views
 * pad their scrolling content by the space it takes, measured live, so
 * nothing starts hidden underneath at any breakpoint.
 */
const TOP = [".page-heading", ".design-switch"];
const BOTTOM = [".transport", ".pipeline", ".pi-review-progress", ".pi-console"];

export function useChromeInsets(): CSSProperties {
  const [insets, setInsets] = useState({ top: 200, bottom: 180 });
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = window.innerHeight;
      const top = Math.max(0, ...TOP.map((selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0)) + 12;
      const lows = BOTTOM.map((selector) => document.querySelector(selector)?.getBoundingClientRect()).filter((box): box is DOMRect => !!box && box.height > 0 && box.top > height / 2).map((box) => box.top);
      const bottom = height - Math.min(height, ...lows) + 12;
      setInsets((previous) => previous.top === Math.round(top) && previous.bottom === Math.round(bottom) ? previous : { top: Math.round(top), bottom: Math.round(bottom) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    for (const selector of [...TOP, ...BOTTOM]) { const element = document.querySelector(selector); if (element) observer.observe(element); }
    window.addEventListener("resize", schedule);
    const timer = setInterval(schedule, 1500);
    return () => { observer.disconnect(); window.removeEventListener("resize", schedule); clearInterval(timer); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return { ["--tp-top" as string]: `${insets.top}px`, ["--tp-bottom" as string]: `${insets.bottom}px` };
}
