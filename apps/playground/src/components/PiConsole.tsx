import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { FacultyFlowPanel } from "./FacultyFlowPanel";
import { flowState } from "../data/facultyFlow";
import type { LiveActivity } from "../data/liveActivity";
import "./pi-console.css";

interface PiEntry {
  id: string;
  timestamp: string;
  kind: "command" | "status" | "user" | "assistant";
  text: string;
  status?: string;
}

interface PiSnapshot {
  status: string;
  acceptingMessages: boolean;
  entries: PiEntry[];
  pending: number;
  queued?: number;
  processing?: number;
  unknown?: number;
  detail?: string;
}

interface Submission {
  id: string;
  text: string;
}

type MessageStatus = "queued" | "processing" | "consumed" | "failed";

interface AcknowledgedSubmission extends Submission {
  status: MessageStatus;
}

interface TranscriptScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

export function isNearTranscriptBottom({ scrollHeight, clientHeight, scrollTop }: TranscriptScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight < 64;
}

export function transcriptScrollTarget({ scrollHeight, clientHeight }: TranscriptScrollMetrics, previousTop: number, follow: boolean): number {
  const bottom = Math.max(0, scrollHeight - clientHeight);
  return follow ? bottom : Math.min(Math.max(0, previousTop), bottom);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizeSnapshot(value: unknown): PiSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as PiSnapshot;
  const valid = typeof snapshot.status === "string"
    && typeof snapshot.acceptingMessages === "boolean"
    && (isCount(snapshot.pending) || (snapshot.pending === undefined && isCount(snapshot.queued) && isCount(snapshot.processing)))
    && [snapshot.queued, snapshot.processing, snapshot.unknown].every(count => count === undefined || isCount(count))
    && (snapshot.detail === undefined || typeof snapshot.detail === "string")
    && Array.isArray(snapshot.entries)
    && snapshot.entries.every(entry => entry && typeof entry.id === "string"
      && typeof entry.timestamp === "string" && typeof entry.text === "string"
      && ["command", "status", "user", "assistant"].includes(entry.kind)
      && (entry.status === undefined || typeof entry.status === "string"));
  return valid ? { ...snapshot, pending: snapshot.pending ?? snapshot.queued! + snapshot.processing! + (snapshot.unknown ?? 0) } : null;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

interface PiConsoleProps {
  /** Live faculty telemetry for the Flow view. */
  activity?: LiveActivity | null;
  reducedMotion?: boolean;
}

export function PiConsole({ activity, reducedMotion = false }: PiConsoleProps = {}) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"transcript" | "flow">("transcript");
  const firing = flowState(activity).firing;
  const [control] = useState(() => typeof window === "undefined"
    ? null : new URLSearchParams(window.location.hash.slice(1)).get("pi"));
  const [snapshot, setSnapshot] = useState<PiSnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgedSubmission[]>([]);
  const submissionRef = useRef<(Submission & { status?: MessageStatus }) | null>(null);
  const sendingRef = useRef(false);
  const postRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const scrollTopRef = useRef(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const inputId = useId();
  const noteId = useId();
  const sendErrorId = useId();

  useEffect(() => () => postRef.current?.abort(), []);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch("api/pi", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseError(response, `Pi status unavailable (${response.status}).`));
        const next = normalizeSnapshot(await response.json());
        if (!next) throw new Error("Pi returned an invalid status response.");
        if (controller.signal.aborted) return;
        setSnapshot(next);
        setPollError(null);
        setAcknowledgements(previous => previous.filter(message => !next.entries.some(entry => entry.kind === "user" && entry.id === message.id)));
      } catch (error) {
        if (controller.signal.aborted) return;
        setPollError(error instanceof Error ? error.message : "Unable to reach Pi. Retrying…");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!expanded || !transcript) return;
    transcript.scrollTop = transcriptScrollTarget(transcript, scrollTopRef.current, nearBottomRef.current);
  }, [expanded, snapshot, acknowledgements, sending, sendError, pollError]);

  const visibleAcknowledgements = acknowledgements.filter(message => !snapshot?.entries.some(entry => entry.kind === "user" && entry.id === message.id));
  const pending = Math.max(snapshot?.pending ?? 0, visibleAcknowledgements.filter(message => message.status === "queued" || message.status === "processing").length);
  const failedSubmission = submissionRef.current?.status === "failed" && submissionRef.current.text === draft.trim();
  const canSend = Boolean(control && snapshot?.acceptingMessages && !pollError && !sending && !failedSubmission && draft.trim());

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || !control || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const controller = new AbortController();
    postRef.current = controller;
    try {
      const text = draft.trim();
      const submission = submissionRef.current?.text === text
        ? submissionRef.current : { id: crypto.randomUUID(), text };
      submissionRef.current = submission;
      const response = await fetch("api/pi/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Pi-Control": control },
        body: JSON.stringify(submission),
        signal: controller.signal,
      });
      if (response.status !== 202) throw new Error(await responseError(response, `Message could not be queued (${response.status}).`));
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("id" in result) || result.id !== submission.id
        || !("status" in result) || typeof result.status !== "string"
        || !["queued", "processing", "consumed", "failed"].includes(result.status)) {
        throw new Error("Queue confirmation was unclear. Retry uses the same message ID.");
      }
      if (controller.signal.aborted) return;
      const acknowledgement: AcknowledgedSubmission = { ...submission, status: result.status as MessageStatus };
      setAcknowledgements(previous => [...previous.filter(message => message.id !== submission.id), acknowledgement]);
      if (acknowledgement.status === "failed") {
        submissionRef.current = acknowledgement;
        setSendError("Pi reports this message failed. It will not be resubmitted.");
        return;
      }
      setDraft("");
      submissionRef.current = null;
    } catch (error) {
      if (!controller.signal.aborted) setSendError(error instanceof Error ? error.message : "Unable to queue message. You can retry.");
    } finally {
      sendingRef.current = false;
      if (!controller.signal.aborted) setSending(false);
      if (postRef.current === controller) postRef.current = null;
    }
  }

  function collapse() {
    setExpanded(false);
    toggleRef.current?.focus();
  }

  return (
    <aside className={`pi-console${expanded ? " is-expanded" : ""}${view === "flow" ? " is-flow" : ""}`} aria-label="Pi agent console">
      <button ref={toggleRef} type="button" className="pi-console-toggle" aria-expanded={expanded}
        aria-controls={panelId} onClick={() => setExpanded(previous => !previous)}>
        <span className="pi-console-mark" aria-hidden="true">π</span>
        <span className="pi-console-title">Pi console<small>{expanded ? "Novel CLI agent" : "Expand · novel CLI agent"}</small></span>
        <span className="pi-console-badge">{expanded ? pollError ? "Offline" : snapshot?.status ?? "Connecting…" : "Closed"}</span>
        {pending > 0 && <span className="pi-console-badge is-queued">{pending} pending{!expanded ? " · last seen" : ""}</span>}
        {firing > 0 && <span className="pi-console-badge is-firing">{firing} firing</span>}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div id={panelId} className="pi-console-panel" hidden={!expanded} onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          collapse();
        }
      }}>
        <div className="pi-console-status" role="status">
          <span>{pollError ? "Connection interrupted; displayed transcript may be stale. Retrying…"
            : snapshot ? `${snapshot.status} · ${snapshot.acceptingMessages ? "Accepting messages" : "Messages paused"}` : "Connecting to Pi…"}</span>
          {snapshot?.detail && <span>{snapshot.detail}</span>}
          {snapshot?.queued !== undefined && snapshot.processing !== undefined && <span>{snapshot.queued} queued · {snapshot.processing} processing{snapshot.unknown ? ` · ${snapshot.unknown} unknown` : ""}</span>}
        </div>
        {pollError && <p className="pi-console-error">{pollError}</p>}
        <div className="pi-console-tabs" role="tablist" aria-label="Console view">
          {(["transcript", "flow"] as const).map(name => (
            <button key={name} type="button" role="tab" aria-selected={view === name} className={view === name ? "is-active" : ""} onClick={() => setView(name)}>
              {name === "transcript" ? "Transcript" : `Faculty flow${firing ? ` · ${firing}` : ""}`}
            </button>
          ))}
        </div>
        {view === "flow" && <FacultyFlowPanel activity={activity} reducedMotion={reducedMotion} />}
        <div ref={transcriptRef} className="pi-console-transcript" hidden={view !== "transcript"} role="region" aria-label="Pi transcript: commands, status, and messages"
          tabIndex={0} onScroll={event => {
            const transcript = event.currentTarget;
            scrollTopRef.current = transcript.scrollTop;
            nearBottomRef.current = isNearTranscriptBottom(transcript);
          }}>
          {!snapshot?.entries.length && <p className="pi-console-empty">{snapshot ? "No transcript entries yet." : "Waiting for the transcript…"}</p>}
          {snapshot?.entries.map(entry => (
            <article className={`pi-console-entry is-${entry.kind}`} key={entry.id}>
              <header><span>{entry.kind === "command" ? "CLI command" : entry.kind === "assistant" ? "Pi" : entry.kind === "user" ? "You" : "Status"}</span>
                <time dateTime={entry.timestamp}>{entry.timestamp}</time>
                {entry.status && <span className="pi-console-badge">{entry.status}</span>}
              </header>
              <pre>{entry.text}</pre>
            </article>
          ))}
          {visibleAcknowledgements.map(message => (
            <article className="pi-console-entry is-user" key={message.id}>
              <header><span>You</span><span className={`pi-console-badge${message.status === "queued" ? " is-queued" : ""}`}>{message.status === "queued" ? "Queued · awaiting transcript" : message.status === "processing" ? "Processing · awaiting transcript" : message.status === "consumed" ? "Consumed · confirmed by Pi" : "Failed · not retried"}</span></header>
              <pre>{message.text}</pre>
            </article>
          ))}
        </div>
        <form className="pi-console-compose" onSubmit={sendMessage}>
          <label htmlFor={inputId}>Message Pi</label>
          <div className="pi-console-input-row">
            <textarea id={inputId} rows={2} value={draft} disabled={sending} placeholder="Ask the novel CLI agent…"
              aria-describedby={`${noteId}${sendError ? ` ${sendErrorId}` : ""}`} onChange={event => {
                setDraft(event.target.value);
                setSendError(null);
              }} />
            <button type="submit" disabled={!canSend}>{sending ? "Sending…" : failedSubmission ? "Failed" : sendError && submissionRef.current?.text === draft.trim() ? "Retry" : "Send"}</button>
          </div>
          {sendError && <p id={sendErrorId} className="pi-console-error" role="alert">{sendError}{!failedSubmission && " Retry unchanged text to reuse its message ID."}</p>}
          <div className="pi-console-note" id={noteId}>
            {!control && <p>Private control capability required to send messages.</p>}
            {snapshot && !snapshot.acceptingMessages && <p>Sending is paused. The transcript remains available.</p>}
            <p>Queued messages are handled at the next safe tool boundary, which may be after the current run. Queued does not mean consumed.</p>
            <p>Pi is scoped to the novel CLI; this is not an arbitrary shell.</p>
          </div>
          <span className="pi-console-send-state" role="status">{sending ? "Sending message…" : sendError ?? (acknowledgements.length ? `Last acknowledgement: ${acknowledgements.at(-1)!.status}.` : pending > 0 ? `${pending} pending.` : "")}</span>
        </form>
      </div>
    </aside>
  );
}
