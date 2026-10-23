export async function recordSource({ id, scenes, events, readBlock, sectionBlock }) {
  const turnId = /^view-turn:(.+):(\d+)$/.exec(id);
  const scene = scenes.find((entry) => entry.id === (turnId?.[1] ?? id));
  const turn = turnId && scene?.turns?.[Number(turnId[2])];
  if (turnId && !turn) return null;
  const event = !scene && events.find((entry) => entry.id === id);
  const references = turn ? turn.sentenceIds : scene ? scene.sentenceIds : event?.evidence?.sentenceIds;
  if (!references?.length) return null;
  const requested = [...new Set(references)];
  const located = [];
  let missing = 0;
  const blocks = new Map();
  for (const reference of requested) {
    const parsed = /^b(\d{4,})_s(\d{4,})$/.exec(reference);
    if (!parsed) { missing++; continue; }
    const blockIndex = Number(parsed[1]);
    if (!Number.isSafeInteger(blockIndex) || blockIndex > 1000000) { missing++; continue; }
    if (!blocks.has(blockIndex)) {
      try {
        const text = await readBlock(blockIndex);
        const spans = new Map();
        let cursor = 0;
        for (const sentence of sectionBlock(text, blockIndex).sentences) {
          const start = text.indexOf(sentence.text, cursor);
          if (start < 0) throw new Error('Source provenance mismatch');
          const end = start + sentence.text.length;
          spans.set(sentence.id, { blockIndex, index: sentence.index, start, end, text });
          cursor = end;
        }
        blocks.set(blockIndex, spans);
      } catch { blocks.set(blockIndex, new Map()); }
    }
    const span = blocks.get(blockIndex).get(reference);
    if (span) located.push(span); else missing++;
  }
  located.sort((first, second) => first.blockIndex - second.blockIndex || first.index - second.index);
  const ranges = [];
  for (const span of located) {
    const previous = ranges.at(-1);
    if (previous && previous.blockIndex === span.blockIndex && previous.last + 1 === span.index) { previous.end = span.end; previous.last = span.index; }
    else ranges.push({ ...span, last: span.index });
  }
  const segments = ranges.map((range) => range.text.slice(range.start, range.end));
  const text = segments.join('\n\n');
  if (text.length > 300000) return { id, complete: false, message: 'This segment exceeds the local viewer size limit.' };
  return { id, kind: turn ? 'turn' : scene ? 'scene' : 'event', text, complete: missing === 0, contiguous: segments.length <= 1, segments, missing };
}
