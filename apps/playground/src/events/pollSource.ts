import type { EventSource as PlaygroundEventSource, PlaygroundEvent } from "../types.js";
import { projectProcessingEvent, type EventRecord } from "./project.js";

/**
 * PollingEventSource — the playground's live event source over a
 * PUBLISHED events.jsonl mirror.
 *
 * The CLI's watch stream is loopback-only, so a hosted deployment of
 * this app cannot subscribe to it from a phone browser. Instead, the
 * run's events.jsonl (metadata only: ids, kinds, confidences, counts —
 * never novel text) is mirrored to a same-origin URL next to the app,
 * and this source polls it: every poll fetches the file fresh, projects
 * each record it has not seen yet through ./project (the same
 * projection the SSE source uses), and dispatches the PlaygroundEvents.
 *
 * Usage: open the hosted app with ?livepoll=<events.jsonl url>.
 * Freshness is bounded by the mirror's publish cadence plus the poll
 * interval — block-level, not sub-second, and the UI says so nowhere
 * it would be a lie: the stage/feed/gate all move as blocks land.
 */
export class PollingEventSource implements PlaygroundEventSource {
  private handlers = new Set<(event: PlaygroundEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private consumedLines = 0;
  private pollCount = 0;
  private failing = false;
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly intervalMs = 8000,
  ) {}

  subscribe(handler: (event: PlaygroundEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private dispatch(event: PlaygroundEvent): void {
    for (const h of this.handlers) h(event);
  }

  start(): void {
    this.stop();
    this.stopped = false;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      const sep = this.url.includes("?") ? "&" : "?";
      const res = await fetch(`${this.url}${sep}t=${++this.pollCount}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (this.stopped) return;
      if (this.failing) {
        this.failing = false;
        this.dispatch({
          type: "verdict",
          patch: "watch",
          text: "✓ live mirror reachable again",
        });
      }
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      // A replaced/shorter file means a new stream: start over.
      if (lines.length < this.consumedLines) this.consumedLines = 0;
      for (let i = this.consumedLines; i < lines.length; i++) {
        try {
          const record = JSON.parse(lines[i]) as EventRecord;
          for (const event of projectProcessingEvent(record.event)) {
            this.dispatch(event);
          }
        } catch {
          // A torn final line (file still being published) is retried
          // on the next poll; a bad line anywhere else is skipped so
          // one corrupt record can never stall the stream.
          if (i === lines.length - 1) break;
        }
        this.consumedLines = i + 1;
      }
    } catch (e) {
      if (!this.failing) {
        this.failing = true;
        this.dispatch({
          type: "verdict",
          patch: "watch",
          text: `⚠ live mirror unreachable (${(e as Error).message}) — retrying`,
        });
      }
    }
  }
}
