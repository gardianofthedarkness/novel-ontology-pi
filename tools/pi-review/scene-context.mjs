const clean = (value, limit = 800) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);

export function sourceRange(references = []) {
  if (!Array.isArray(references)) return undefined;
  const positions = references.flatMap(reference => {
    const match = typeof reference === 'string' && /^b(\d{4,})_s(\d{4,})$/.exec(reference);
    if (!match) return [];
    const block = Number(match[1]), sentence = Number(match[2]);
    return Number.isSafeInteger(block) && Number.isSafeInteger(sentence) ? [{ block, sentence }] : [];
  }).sort((first, second) => first.block - second.block || first.sentence - second.sentence);
  if (!positions.length) return undefined;
  const first = positions[0], last = positions.at(-1);
  return { startBlock: first.block, startSentence: first.sentence, endBlock: last.block, endSentence: last.sentence, complete: positions.length === references.length };
}

export const compareSourceRanges = (first, second) => first && second
  ? first.startBlock - second.startBlock || first.startSentence - second.startSentence || first.endBlock - second.endBlock || first.endSentence - second.endSentence
  : first ? -1 : second ? 1 : 0;
const fallbackOrder = (first, second) => (Number.isFinite(first.chrono) ? first.chrono : 0) - (Number.isFinite(second.chrono) ? second.chrono : 0) || first.id.localeCompare(second.id);

export function sceneContext(inputNodes, inputEdges, scenes, events) {
  const nodes = inputNodes.map((node) => ({ ...node }));
  const edges = inputEdges.map((edge) => ({ ...edge }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const bySentence = new Map();
  const eventRecords = [...new Map(events.map((event) => [event.id, event])).values()].filter((event) => byId.has(event.id));
  const eventRanges = new Map(eventRecords.map(event => [event.id, sourceRange(event.evidence?.sentenceIds)]));
  const eventOrder = (first, second) => compareSourceRanges(eventRanges.get(first.id), eventRanges.get(second.id)) || first.chronologicalOrder - second.chronologicalOrder || first.id.localeCompare(second.id);
  for (const event of eventRecords) {
    const node = byId.get(event.id);
    node.sourceRange = eventRanges.get(event.id);
    if (clean(event.summaryEn)) node.summary = clean(event.summaryEn);
    for (const sentence of event.evidence?.sentenceIds ?? []) {
      const matches = bySentence.get(sentence) ?? [];
      matches.push(event);
      bySentence.set(sentence, matches);
    }
  }
  const link = (from, to, kind, relationLabel, weight) => {
    if (!byId.has(from) || !byId.has(to) || from === to || edges.some((edge) => edge.from === from && edge.to === to && (edge.relationLabel === relationLabel || !edge.derived))) return;
    const endpoints = [byId.get(from), byId.get(to)];
    const state = endpoints.every((node) => node.state === 'canon') ? 'canon' : endpoints.some((node) => node.state === 'held') ? 'held' : 'proposed';
    edges.push({ id: `context:${relationLabel}:${from}:${to}`, from, to, kind, state, parent: endpoints[0].parent, weight, derived: true, relationLabel });
  };
  for (const scene of new Map(scenes.map((entry) => [entry.id, entry])).values()) {
    const node = byId.get(scene.id);
    if (!node) continue;
    node.sourceRange = sourceRange(scene.sentenceIds);
    const matches = new Map();
    for (const sentence of scene.sentenceIds ?? []) for (const event of bySentence.get(sentence) ?? []) {
      if (event.chapterIndex === scene.chapterIndex) matches.set(event.id, event);
    }
    const ordered = [...matches.values()].sort(eventOrder);
    const summaries = ordered.filter((event) => clean(event.summaryEn)).slice(0, 3).map((event) => ({ id: event.id, text: clean(event.summaryEn) }));
    if (clean(scene.summary) || summaries.length) {
      node.label = clean(scene.summary || summaries[0].text, 55);
      node.summary = clean(scene.summary) || summaries[0].text;
      node.relatedSummaries = summaries;
    }
    for (const event of ordered) link(scene.id, event.id, 'contains', 'Shared source coverage', 2.4);
    for (const id of scene.charactersPresent ?? []) link(id, scene.id, 'contains', 'Present in scene', 1.4);
    for (const id of scene.charactersMentioned ?? []) link(id, scene.id, 'cross', 'Mentioned in scene', 0.35);
    if (scene.locationId) link(scene.id, scene.locationId, 'contains', 'Scene location', 1.2);
    for (const [cardIndex, card] of (scene.dialogues ?? []).entries()) {
      const id = `view-card:${scene.id}:${cardIndex}`;
      const members = (card.participantIds ?? []).map(member => byId.get(member)).filter(Boolean);
      const covered = new Set(card.sentenceIds ?? []);
      const matched = ordered.find(event => event.evidence?.sentenceIds?.some(sentence => covered.has(sentence)));
      if (!byId.has(id)) {
        const dialogue = {
          ...node, id, kind: 'dialogue', label: `#${cardIndex + 1} · ${members.length ? members.map(member => member.label).join(' / ') : 'Participants unresolved'}`,
          chrono: cardIndex, sourceRange: sourceRange(card.sentenceIds),
          summary: clean(card.summary || matched?.summaryEn) || undefined, relatedSummaries: undefined,
          dialogue: { cardId: card.id, participantIds: members.map(member => member.id), participantLabels: members.map(member => member.label) },
        };
        nodes.push(dialogue);
        byId.set(id, dialogue);
      }
      link(scene.id, id, 'contains', 'Stored dialogue exchange', 1.4);
      for (const member of members) link(member.id, id, 'contains', 'Dialogue participant', 1.2);
    }
    for (const [turnIndex, turn] of (scene.dialogues ? [] : scene.turns ?? []).entries()) {
      const id = `view-turn:${scene.id}:${turnIndex}`;
      const speaker = byId.get(turn.speakerId);
      const covered = new Set(turn.sentenceIds ?? []);
      const matched = ordered.find((event) => event.evidence?.sentenceIds?.some((sentence) => covered.has(sentence)));
      if (!byId.has(id)) {
        const dialogue = {
          ...node, id, kind: 'dialogue', label: `#${turnIndex + 1}${speaker ? ` · ${speaker.label}` : ''}`,
          chrono: turnIndex, sourceRange: sourceRange(turn.sentenceIds),
          summary: clean(matched?.summaryEn) || undefined, relatedSummaries: undefined,
          dialogue: { turn: turnIndex, speakerId: turn.speakerId ?? null, ...(speaker ? { speakerLabel: speaker.label } : {}) },
        };
        nodes.push(dialogue);
        byId.set(id, dialogue);
      }
      link(scene.id, id, 'contains', 'Stored dialogue turn', 1.4);
      if (speaker) link(speaker.id, id, 'speaks', 'Stored turn speaker', 1.2);
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'character') continue;
    const related = eventRecords.filter((event) => [...event.primaryActors ?? [], ...event.affectedCharacters ?? []].includes(node.id));
    node.relatedSummaries = related.sort(eventOrder).filter((event) => clean(event.summaryEn)).slice(0, 3).map((event) => ({ id: event.id, text: clean(event.summaryEn) }));
  }
  const records = nodes.filter(node => ['scene', 'event', 'dialogue'].includes(node.kind));
  records.sort((first, second) => compareSourceRanges(first.sourceRange, second.sourceRange) || fallbackOrder(first, second));
  records.forEach((node, index) => { node.chrono = index; });
  return { nodes, edges };
}
