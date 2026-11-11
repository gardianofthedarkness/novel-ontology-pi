import type { ChangeProposal } from "./changeset.js";

export function rekeyDuplicateProposalIds(proposals: ChangeProposal[]) {
  const counts = new Map<string, number>();
  for (const proposal of proposals) {
    if (typeof proposal.id !== "string" || !proposal.id.trim()) throw new Error("Missing proposal IDs require explicit investigation, not duplicate-ID repair.");
    counts.set(proposal.id, (counts.get(proposal.id) ?? 0) + 1);
  }
  const reserved = new Set(proposals.map(proposal => proposal.id));
  const renamed: { index: number; from: string; to: string }[] = [];
  const repaired = proposals.map((proposal, index) => {
    if (counts.get(proposal.id) === 1) return proposal;
    let ordinal = 1;
    while (reserved.has(`${proposal.id}__duplicate_${ordinal}`)) ordinal++;
    const id = `${proposal.id}__duplicate_${ordinal}`;
    reserved.add(id);
    renamed.push({ index, from: proposal.id, to: id });
    return { ...proposal, id };
  });
  return { proposals: repaired, renamed };
}
