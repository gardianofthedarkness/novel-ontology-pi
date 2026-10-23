import type { EventSource as PlaygroundEventSource, PlaygroundEvent } from "../types.js";
import { projectProcessingEvent, type EventRecord } from "./project.js";
import { createDraftProjector, type WorkingDraftView } from "./draftProject.js";

/**
 * SseEventSource — the playground's LIVE event source over `novel watch`.
 *
 * Connects to the CLI watch server's SSE endpoint (loopback only,
 * default http://127.0.0.1:4317/events) and projects each streamed
 * EventRecord into PlaygroundEvents via ./project. The browser's
 * EventSource reconnects on its own and replays from the last record id
 * (the watch server honors Last-Event-ID), so a dropped tab picks the
 * stream back up without losing gate events.
 *
 * Phase B (decision #15): the stream also announces `draft.updated`
 * whenever the block processor republishes a working draft. Those
 * facts are intercepted here — the current draft is fetched from the
 * watch server (`GET /drafts/<blockId>`) and run through the draft
 * projector, so the batch's new nodes emerge in place as ghosts.
 * Gate verdicts keep flowing through ./project; a held changeset's
 * proposal ids are translated into the node ids the projector emitted,
 * so the held state lands on the actual ghost nodes.
 *
 * Live mode is VIEW-ONLY: the watch server is read-only by design, so
 * the gate itself stays in the CLI / with the main agent — approvals
 * appear here as stream events when they happen.
 *
 * Usage: serve the playground on a loopback origin and open it with
 * ?live=http://127.0.0.1:4317/events (see App.tsx).
 */
export class SseEventSource implements PlaygroundEventSource {
  private handlers = new Set<(event: PlaygroundEvent) => void>();
  private stream: EventSource | null = null;
  private projector = createDraftProjector();
  private draftInFlight = new Set<string>();
  private draftDirty = new Set<string>();
  private epoch = 0;
  private lastDraftWarnAt = 0;

  constructor(private readonly url: string) {}

  subscribe(handler: (event: PlaygroundEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private dispatch(event: PlaygroundEvent): void {
    for (const h of this.handlers) h(event);
  }

  /** Watch base URL: the SSE url minus its trailing /events segment. */
  private baseUrl(): string {
    const u = new URL(this.url);
    u.pathname = u.pathname.replace(/\/events\/?$/, "");
    u.search = "";
    return u.toString().replace(/\/$/, "");
  }

  private async pullDraft(blockId: string): Promise<void> {
    if (this.draftInFlight.has(blockId)) {
      this.draftDirty.add(blockId);
      return;
    }
    this.draftInFlight.add(blockId);
    const myEpoch = this.epoch;
    try {
      const res = await fetch(`${this.baseUrl()}/drafts/${blockId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const draft = (await res.json()) as WorkingDraftView;
      if (myEpoch !== this.epoch) return;
      for (const event of this.projector.ingest(draft)) this.dispatch(event);
    } catch {
      // A missing/failed draft fetch degrades to a feed note, never a
      // dead session; the next draft.updated retries.
      const now = Date.now();
      if (myEpoch === this.epoch && now - this.lastDraftWarnAt > 5000) {
        this.lastDraftWarnAt = now;
        this.dispatch({
          type: "verdict",
          patch: "watch",
          text: `⚠ working draft unavailable for ${blockId} — emergence paused, stream continues`,
        });
      }
    } finally {
      this.draftInFlight.delete(blockId);
      if (this.draftDirty.delete(blockId) && myEpoch === this.epoch) {
        void this.pullDraft(blockId);
      }
    }
  }

  start(): void {
    this.stop();
    const stream = new EventSource(this.url);
    this.stream = stream;
    stream.onmessage = (msg) => {
      try {
        const record = JSON.parse(msg.data as string) as EventRecord;
        const event = record.event;
        if (event.type === "draft.updated") {
          void this.pullDraft(event.blockId);
          return;
        }
        if (event.type === "changeset.revision_requested") {
          this.projector.markRevised(event.changesetId);
        }
        for (const projected of projectProcessingEvent(event)) {
          if (projected.type === "changeset.held") {
            // The transport carries proposal ids; the app holds ghost
            // NODE ids. Translate through the draft projector so the
            // held state lands on the nodes that actually emerged.
            const nodeIds = this.projector.nodeIdsForProposals(projected.nodeIds);
            this.dispatch(nodeIds.length ? { ...projected, nodeIds } : projected);
          } else {
            this.dispatch(projected);
          }
        }
      } catch {
        // A malformed frame is skipped, never fatal to the session.
      }
    };
    stream.addEventListener("stream.error", () => {
      this.dispatch({
        type: "verdict",
        patch: "watch",
        text: "⚠ watch stream reported unavailable history — reconnecting",
      });
    });
  }

  stop(): void {
    this.epoch++;
    this.stream?.close();
    this.stream = null;
    this.draftInFlight.clear();
    this.draftDirty.clear();
  }
}
