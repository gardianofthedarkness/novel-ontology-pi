import type { PlaceMention } from "./vocabulary.js";

/**
 * Stated containment (time-place faculty, phase 2): inside one sentence, a
 * place written directly after a named place, or joined to it by 的/之/里/内/中,
 * is inside that place ("东京都新宿区", "新宿区的车站前", "星城东区").
 * The vocabulary model may also say so (`within`), which is accepted only
 * when it names another place found in the same sentence. The parent must be
 * a proper name: a generic place ("车站前") never contains anything here.
 * These are proposals for the shared gate, not canon.
 */
export interface StatedContainment { child: PlaceMention; parent: PlaceMention; via: "adjacent" | "llm" }

const JOIN = /^(?:的|之|里的|内的|中的|裡的|內的|里|内|中|裡|內)?$/;

export function statedContainment(mentions: PlaceMention[], sentenceText: (sentenceId: string) => string | undefined): StatedContainment[] {
  const found: StatedContainment[] = [];
  const bySentence = new Map<string, PlaceMention[]>();
  for (const mention of mentions) bySentence.set(mention.sentenceId, [...(bySentence.get(mention.sentenceId) ?? []), mention]);
  for (const [sentenceId, list] of bySentence) {
    const text = sentenceText(sentenceId) ?? "";
    const sorted = [...list].sort((first, second) => first.start - second.start || second.end - first.end);
    for (const child of sorted) {
      const differs = (parent: PlaceMention) => parent !== child && parent.specific && parent.text !== child.text && (parent.end <= child.start || parent.start >= child.end);
      const stated = child.within ? sorted.find((parent) => parent.text === child.within && differs(parent)) : undefined;
      const before = sorted.filter((parent) => differs(parent) && parent.end <= child.start).at(-1);
      const adjacent = before && JOIN.test(text.slice(before.end, child.start)) ? before : undefined;
      if (adjacent) found.push({ child, parent: adjacent, via: "adjacent" });
      else if (stated) found.push({ child, parent: stated, via: "llm" });
    }
  }
  return found;
}
