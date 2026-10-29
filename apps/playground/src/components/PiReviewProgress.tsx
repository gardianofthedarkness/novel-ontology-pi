import type { LiveActivity } from "../data/liveActivity";

const labels: Record<string, string> = { facts: "Semantic facts", evidence: "Source evidence", source: "Original source", "source-count": "Source line count", proposals: "Proposals", notes: "Review notes", summary: "Packet summary", decide: "Record decisions", revise: "Repair proposal", approve: "Apply reviewed packet", hold: "Hold packet" };
const fieldLabels: Record<string, string> = { identity: "Identity", alias: "Alias", actors: "Event participants", presence: "Presence", mention: "Mention", location: "Location", turn: "Legacy attribution", "dialogue-member": "Dialogue participants", relation: "Relationship", state: "Character state" };
const kindLabels: Record<string, string> = { "time-place": "Story time & places", causality: "Causality", book: "Book review", identity: "Shared character list", calendar: "Universe calendar", places: "Places across books", "universe-causality": "Cross-book causality", library: "Library organization" };
const fieldLabelsExtra: Record<string, string> = { "identity-match": "Same character?", "calendar-year": "Calendar year" };
/** Where the review is: a block of a book, or what a book or universe packet reviews. */
const locationLabel = (review: NonNullable<LiveActivity["review"]>) => review.blockId
  ? `Book ${review.volume} · Chapter ${review.chapterIndex} · ${review.blockId}`
  : [kindLabels[review.kind ?? ""] ?? "Review", review.volume != null ? `Book ${review.volume}` : review.universeId ? `universe ${review.universeId}` : null].filter(Boolean).join(" · ");
const positionLabel = (positions: number[]) => positions.every((position, index) => !index || position === positions[index - 1] + 1) ? positions.length > 1 ? `${positions[0]}–${positions.at(-1)}` : String(positions[0]) : positions.join(", ");

export function PiReviewProgress({ review }: { review?: LiveActivity["review"] }) {
  return <section className="pi-review-progress" aria-label="Pi merge review progress">
    <details>
      <summary>Pi review · {review ? `${review.blockId ? review.changesetId : kindLabels[review.kind ?? ""] ?? review.changesetId} · ${labels[review.phase] ?? review.phase}${review.factPositions?.length ? ` ${positionLabel(review.factPositions)}` : review.offset != null && review.pageCount && review.total != null ? ` ${review.offset + 1}–${Math.min(review.offset + review.pageCount, review.total)} / ${review.total}` : ""} · ${review.active ? review.status === "requested" ? "tool requested" : review.status === "ok" ? "result received" : review.status : "last observed"}` : "waiting for review telemetry"}</summary>
      {review ? <div>
        <p>{locationLabel(review)}{review.revision ? ` · revision ${review.revision.slice(0, 8)}` : ""}</p>
        {review.sourceStart != null && <p>Source lines {review.sourceStart}–{review.sourceEnd}</p>}
        {review.offset != null && review.total != null && <p>{labels[review.phase] ?? review.phase}: {review.total === 0 ? "0" : `${review.offset + 1}–${Math.min(review.offset + (review.pageCount ?? 0), review.total)}`} / {review.total}</p>}
        {!!review.factIds?.length && <p>{review.factIds.length} fact{review.factIds.length === 1 ? "" : "s"} in this tool action{review.factPositions?.length ? ` · positions ${positionLabel(review.factPositions)}` : ""}</p>}
        {review.totalFacts != null && <p>{review.inspectedFacts ?? 0} / {review.totalFacts} facts observed read in this revision — reading is not acceptance.</p>}
        {!!review.fields?.length && <p>{review.fields.map(field => fieldLabels[field] ?? fieldLabelsExtra[field] ?? field).join(" · ")}</p>}
        {review.accepted != null && <p>{review.accepted} accepted · {review.rejected ?? 0} rejected · {review.held ?? 0} explicit holds{review.unreviewed != null ? ` · ${review.unreviewed} undecided` : ""}</p>}
        <p className="telemetry-note">Actual scoped tool requests/results; no model reasoning or private review reasons. Graph highlights locate the containing scenes without entering record timelines.</p>
      </div> : <p>No detailed review location is available for this action. Extraction activity and Pi chat are shown separately.</p>}
    </details>
  </section>;
}
