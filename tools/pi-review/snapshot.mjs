import { readFile, readdir } from 'node:fs/promises';
import { root, novel, agentEvents } from './config.mjs';
import { runOutcome } from './run-outcome.mjs';
import { sceneContext, sourceRange, compareSourceRanges } from './scene-context.mjs';
import { liveActivity } from './live-activity.mjs';
import { timePlaceProjection } from './time-place.mjs';
import { readStrandAnswers } from './strand-answers.mjs';
import { sessionReviewProgress } from './review-progress.mjs';
import { albumProjection } from './album.mjs';
import { calendarView } from './calendar-view.mjs';

/** The book's own calendar for its story view (a universe view gets the universe's). */
const withCalendar = async (projection, title) => projection.available ? { ...projection, calendar: await calendarView({ books: [{ sourceId: 'book', title: title ?? 'This book', readingOrder: null, continuityId: null, volume: null, times: projection.times }] }).catch(() => null) } : projection;

async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}
async function rows(path) {
  try { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const fold = (entries) => [...new Map(entries.map((entry) => [entry.id, entry])).values()];
const text = (value, max = 180) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

export async function snapshot(directory = novel, runtime = `${root}runtime`, options = {}) {
  const [chapterRecords, entities, events, scenes, relations, processing, agentRecords, maintenance] = await Promise.all([
    json(`${runtime}/chapters.json`, []), rows(`${directory}/ontology/entities.jsonl`), rows(`${directory}/ontology/events.jsonl`),
    rows(`${directory}/ontology/scenes.jsonl`), rows(`${directory}/ontology/relations.jsonl`), rows(`${directory}/events.jsonl`), rows(options.agentEvents ?? (runtime === `${root}runtime` ? agentEvents : `${runtime}/pi-events.jsonl`)), rows(`${directory}/maintenance.jsonl`),
  ]);
  const chapters = chapterRecords.map((chapter) => ({ ...chapter, blockIds: chapter.blockIds ?? [chapter.blockId] }));
  const blockChapters = new Map(chapters.flatMap((chapter) => chapter.blockIds.map((id) => [id, chapter.index])));
  const agent = options.volume ? agentRecords.filter((record) => record.volume === options.volume || !record.volume && options.volume === 1 || options.jobStatus && record.type === 'pi.status') : agentRecords;
  const files = await readdir(`${directory}/changesets`).catch(() => []);
  const changesets = (await Promise.all(files.filter((file) => /^cs_b\d+\.json$/.test(file)).map((file) => json(`${directory}/changesets/${file}`, null)))).filter((entry) => entry && blockChapters.has(entry.blockId));
  const causalSets = (await Promise.all(files.filter(file => /^cs_causality_(agent|sweep)_\d+\.json$/.test(file)).map(file => json(`${directory}/changesets/${file}`, null)))).filter(entry => entry && entry.status !== 'approved');
  // Time-place proposals still awaiting review: shown live as proposed periods/places.
  const timePlacePending = (await Promise.all(files.filter(file => /^cs_timeplace_[\w-]+\.json$/.test(file)).map(file => json(`${directory}/changesets/${file}`, null)))).filter(entry => entry && entry.status === 'pending_review').flatMap(entry => entry.proposals ?? []);
  const drafts = (await Promise.all([...blockChapters.keys()].map((blockId) => json(`${directory}/working/${blockId}.json`, null)))).filter(Boolean);
  const entityMap = new Map(fold(entities).map((entity) => [entity.id, entity]));
  const eventMap = new Map(fold(events).map((event) => [event.id, event]));
  const sceneMap = new Map(fold(scenes).map((scene) => [scene.id, scene]));
  const allNodes = new Map();
  const interiors = {};
  const laneNodes = [];
  const laneEdges = [];
  const bigEventLabels = {};
  const gates = [];
  const albumScenes = [];
  const provenanceChapter = new Map();
  const proposedCausal = [];
  for (const packet of causalSets) {
    const state = ['held', 'revision_requested'].includes(packet.status) ? 'held' : 'proposed';
    for (const proposal of packet.proposals) if (proposal.kind === 'add_relation' && proposal.payload?.type === 'CAUSES') proposedCausal.push({ relation: proposal.payload, state });
    gates.push({ id: packet.id, label: `Causality · ${packet.id}`, status: state === 'held' ? 'held' : 'pending', nodeIds: packet.proposals.map(proposal => proposal.id), deferred: 0 });
  }
  for (const changeset of changesets) {
    const chapterIndex = blockChapters.get(changeset.blockId);
    for (const proposal of changeset.proposals) if (proposal.payload?.id) provenanceChapter.set(proposal.payload.id, chapterIndex);
  }
  for (const chapter of chapters) {
    const chapterId = `chapter_${chapter.index}`;
    const chapterSets = changesets.filter((entry) => chapter.blockIds.includes(entry.blockId));
    const workingDrafts = drafts.filter((entry) => {
      const packet = chapterSets.find((changeset) => changeset.blockId === entry.blockId);
      return chapter.blockIds.includes(entry.blockId) && entry.stage !== 'gate' && packet?.status !== 'approved' && (!packet || entry.updatedAt > packet.createdAt);
    });
    const workingBlocks = new Set(workingDrafts.map((draft) => draft.blockId));
    const proposed = [...chapterSets.filter((entry) => entry.status !== 'approved' && !workingBlocks.has(entry.blockId)).flatMap((entry) => entry.proposals), ...workingDrafts.flatMap((draft) => draft.proposals)];
    const state = workingDrafts.length ? 'proposed' : chapterSets.some((entry) => ['held', 'revision_requested'].includes(entry.status)) ? 'held' : chapterSets.length === chapter.blockIds.length && chapterSets.every((entry) => entry.status === 'approved') ? 'canon' : 'proposed';
    const chapterTitle = chapter.title.match(/^[^A-Za-z]+/)?.[0] ?? chapter.title;
    const chapterNode = { id: chapterId, label: `Chapter ${chapter.index} · ${text(chapterTitle, 40)}`, subLabel: chapterSets.length || workingDrafts.length ? `${chapterSets.length}/${chapter.blockIds.length} blocks reviewed · ${state}` : 'Not processed', kind: 'bigEvent', state, parent: null, lane: 'canon', chrono: chapter.index, lanePos: [chapter.index * 210, 0, 0], interiorPos: [0, 0, 0] };
    laneNodes.push(chapterNode);
    allNodes.set(chapterId, chapterNode);
    bigEventLabels[chapterId] = chapterNode.label;
    const nodes = [];
    const edges = [];
    const add = (payload, category, nodeState) => {
      if (!payload?.id || nodes.some((node) => node.id === payload.id)) return;
      if (category === 'scene') albumScenes.push(payload);
      const name = category === 'entity' ? payload.names?.find((form) => form.kind === 'canonical')?.text ?? payload.names?.[0]?.text : category === 'event' ? payload.summaryEn : payload.label ?? `Scene ${payload.id}`;
      const kind = category === 'entity' ? payload.kind === 'Character' ? 'character' : 'location' : category === 'event' ? payload.eventType === 'dialogue' ? 'dialogue' : 'event' : 'scene';
      const chrono = category === 'event' ? payload.chronologicalOrder : category === 'scene' ? nodes.filter((node) => node.kind === 'scene').length : nodes.length;
      const range = sourceRange(category === 'event' ? payload.evidence?.sentenceIds : category === 'scene' ? payload.sentenceIds : []);
      const node = { id: payload.id, label: text(name || payload.id, 100), subLabel: `${category === 'entity' ? payload.kind : category} · ${nodeState} · ${payload.id}`, kind, state: nodeState, parent: chapterId, lane: 'canon', chrono: Number(chrono ?? 0), ...(range ? { sourceRange: range } : {}), lanePos: [0, 0, 0], interiorPos: [0, 0, 0] };
      nodes.push(node);
      allNodes.set(node.id, node);
    };
    for (const entity of entityMap.values()) {
      const ownChapter = provenanceChapter.get(entity.id);
      const presentInChapter = [...eventMap.values()].some((event) => event.chapterIndex === chapter.index && [...(event.primaryActors ?? []), ...(event.affectedCharacters ?? [])].includes(entity.id)) || [...sceneMap.values()].some((scene) => scene.chapterIndex === chapter.index && (scene.locationId === entity.id || (scene.charactersPresent ?? []).includes(entity.id) || scene.dialogues?.some(card => card.participantIds.includes(entity.id))));
      if (ownChapter === chapter.index || presentInChapter) add(entity, 'entity', 'canon');
    }
    for (const event of eventMap.values()) if (event.chapterIndex === chapter.index) add(event, 'event', 'canon');
    for (const scene of sceneMap.values()) if (scene.chapterIndex === chapter.index) add(scene, 'scene', 'canon');
    if (proposed.length) {
      for (const proposal of proposed) {
        if (proposal.kind === 'upsert_entity' && !entityMap.has(proposal.payload.id)) {
          if (proposal.payload.needsExtraction && proposal.payload.candidateName) add({ id: `draft:${proposal.id}`, kind: 'Character', names: [{ text: `${proposal.payload.candidateName} · candidate`, kind: 'canonical' }] }, 'entity', 'proposed');
          else add(proposal.payload, 'entity', state);
        }
        if (proposal.kind === 'create_event' && !eventMap.has(proposal.payload.id)) add(proposal.payload, 'event', state);
        if (proposal.kind === 'create_scene' && !sceneMap.has(proposal.payload.id)) add(proposal.payload, 'scene', state);
      }
    }
    const draftLinks = [];
    for (const draft of workingDrafts) {
      const remainingSpans = draft.sceneSpans.slice(draft.completedScenes);
      const completed = new Set(draft.sceneSpans.slice(0, draft.completedScenes).flat());
      const attached = new Set();
      const addDialogue = (unit, parentId) => {
        const dialogueId = `draft:${draft.blockId}:dialogue:${unit[0]}`;
        const turn = draft.turns.find(entry => entry.sentenceIds.includes(unit[0]));
        if (!attached.has(unit[0])) add({ id: dialogueId, summaryEn: `Dialogue exchange · ${unit.length} sentence${unit.length === 1 ? '' : 's'} · ${draft.dialogueCards ? 'participant membership' : turn?.speakerId ? 'legacy speaker attributed' : 'membership pending'}`, eventType: 'dialogue', evidence: { sentenceIds: unit } }, 'event', 'proposed');
        attached.add(unit[0]);
        if (parentId) draftLinks.push([parentId, dialogueId, 'contains']);
        if (turn?.speakerId && entityMap.has(turn.speakerId)) {
          add(entityMap.get(turn.speakerId), 'entity', 'canon');
          draftLinks.push([turn.speakerId, dialogueId, 'speaks']);
        }
      };
      for (const [index, span] of remainingSpans.entries()) {
        const id = `draft:${draft.blockId}:scene:${span[0]}`;
        add({ id, label: `Scene draft ${draft.completedScenes + index + 1} · Jev`, sentenceIds: span }, 'scene', 'proposed');
        for (const unit of draft.dialogueUnits.filter((unit) => span.includes(unit[0]))) {
          addDialogue(unit, id);
        }
      }
      for (const unit of draft.dialogueUnits) if (!attached.has(unit[0]) && !completed.has(unit[0])) addDialogue(unit, null);
      // Entity candidates found by faculties ahead of extraction: known
      // entities light up in place; new ones appear as proposed candidates
      // beside the draft scene where they were first seen. Once extraction
      // has minted what a candidate became, only that entity is drawn.
      for (const candidate of draft.entityCandidates ?? []) {
        const span = remainingSpans.find((entry) => entry.includes(candidate.firstSentenceId));
        const sceneId = span ? `draft:${draft.blockId}:scene:${span[0]}` : null;
        let id;
        if (candidate.existingId) {
          if (!entityMap.has(candidate.existingId)) continue;
          add(entityMap.get(candidate.existingId), 'entity', 'canon');
          id = candidate.existingId;
        } else {
          if (candidate.resolvedId && nodes.some((node) => node.id === candidate.resolvedId)) continue;
          id = `draft:${draft.blockId}:entity:${candidate.key}`;
          add({ id, kind: candidate.kind, names: [{ text: candidate.name, kind: 'canonical' }] }, 'entity', 'proposed');
        }
        if (sceneId) draftLinks.push([sceneId, id, 'speaks']);
      }
      for (let index = 1; index < remainingSpans.length; index++) draftLinks.push([`draft:${draft.blockId}:scene:${remainingSpans[index - 1][0]}`, `draft:${draft.blockId}:scene:${remainingSpans[index][0]}`, 'flow']);
    }
    const ids = new Set(nodes.map((node) => node.id));
    const addEdge = (from, to, kind, edgeState, suffix, extra = {}) => {
      if (!ids.has(from) || !ids.has(to) || from === to) return;
      const id = `${chapterId}:${suffix}:${from}:${to}`;
      if (!edges.some((edge) => edge.id === id)) edges.push({ id, from, to, kind, state: edgeState, parent: chapterId, ...extra });
    };
    for (const [from, to, kind] of draftLinks) addEdge(from, to, kind, 'proposed', 'working-decision');
    const proposedRelations = proposed.filter((proposal) => proposal.kind === 'add_relation').map((proposal) => proposal.payload);
    for (const relation of [...relations, ...proposedRelations]) addEdge(relation.fromId, relation.toId, relation.type === 'CAUSES' || relation.type === 'PRECEDES' ? 'flow' : 'speaks', proposedRelations.includes(relation) ? state : 'canon', relation.type, { relationType: relation.type });
    for (const relation of proposedRelations) if (relation.type === 'CAUSES') proposedCausal.push({ relation, state });
    const allEvents = [...eventMap.values(), ...proposed.filter((proposal) => proposal.kind === 'create_event').map((proposal) => proposal.payload)];
    const ordered = fold(allEvents).filter((event) => event.chapterIndex === chapter.index && ids.has(event.id)).sort((first, second) => compareSourceRanges(allNodes.get(first.id)?.sourceRange, allNodes.get(second.id)?.sourceRange) || first.chronologicalOrder - second.chronologicalOrder || first.id.localeCompare(second.id));
    for (let index = 1; index < ordered.length; index++) addEdge(ordered[index - 1].id, ordered[index].id, 'flow', state, 'narrative-order');
    const allScenes = [...sceneMap.values(), ...proposed.filter((proposal) => proposal.kind === 'create_scene').map((proposal) => proposal.payload)];
    interiors[chapterId] = sceneContext(nodes, edges, allScenes, allEvents);
    const projected = new Map(interiors[chapterId].nodes.map(node => [node.id, node]));
    const overview = nodes.filter((node) => node.state !== 'canon').slice(-6).map(node => projected.get(node.id));
    for (const node of overview) {
      if (laneNodes.some((entry) => entry.id === node.id)) continue;
      laneNodes.push(node);
      laneEdges.push({ id: `working-parent:${chapterId}:${node.id}`, from: chapterId, to: node.id, kind: 'contains', state: node.state, parent: chapterId });
    }
    for (const changeset of chapterSets.filter((entry) => !workingBlocks.has(entry.blockId))) {
      const applied = processing.map((record) => record.event).findLast((event) => event.type === 'changeset.applied' && event.changesetId === changeset.id);
      const deferred = (applied?.unsupportedProposalIds?.length ?? 0) + (applied?.deferredFactIds?.length ?? 0);
      gates.push({ id: changeset.id, label: `Chapter ${chapter.index} · ${changeset.id}`, status: changeset.status === 'approved' ? deferred ? 'applied' : 'merged' : changeset.status === 'held' ? 'held' : 'pending', nodeIds: changeset.proposals.map((proposal) => proposal.id), deferred });
    }
  }
  // Stored CAUSES relations, typed and directional, with each endpoint's
  // chapter so the viewer can project cross-chapter links instead of
  // dropping them. Endpoints that are not projected events are counted,
  // never guessed. No causality is inferred from order or adjacency.
  // Canon dialogue cards are not world nodes, so they resolve through
  // their owning scene: the map below lets the viewer project a dialogue
  // endpoint onto its scene's sphere (same projection idea as hidden
  // events) instead of dropping the link as unresolved.
  const dialogueScenes = {};
  const dialogueChapter = {};
  for (const scene of sceneMap.values()) for (const card of scene.dialogues ?? []) {
    dialogueScenes[card.id] = scene.id;
    dialogueChapter[card.id] = `chapter_${scene.chapterIndex}`;
  }
  for (const changeset of changesets) for (const proposal of changeset.proposals) {
    if (proposal.kind !== 'create_scene') continue;
    const chapterIndex = blockChapters.get(changeset.blockId);
    if (chapterIndex === undefined) continue;
    for (const card of proposal.payload.dialogues ?? []) if (!dialogueScenes[card.id]) {
      dialogueScenes[card.id] = proposal.payload.id;
      dialogueChapter[card.id] = `chapter_${chapterIndex}`;
    }
  }
  const causalLinks = [];
  let causalUnresolved = 0;
  for (const { relation, state: linkState } of [...fold(relations.map((relation) => ({ ...relation, id: `${relation.fromId}>${relation.toId}>${relation.type}` }))).map((relation) => ({ relation, state: 'canon' })), ...proposedCausal]) {
    if (relation.type !== 'CAUSES') continue;
    const from = allNodes.get(relation.fromId) ?? (dialogueChapter[relation.fromId] ? { kind: 'dialogue', parent: dialogueChapter[relation.fromId] } : undefined);
    const to = allNodes.get(relation.toId) ?? (dialogueChapter[relation.toId] ? { kind: 'dialogue', parent: dialogueChapter[relation.toId] } : undefined);
    if (!['event', 'dialogue'].includes(from?.kind) || !['event', 'dialogue'].includes(to?.kind) || !from.parent || !to.parent) { causalUnresolved++; continue; }
    const id = `causes:${relation.fromId}:${relation.toId}`;
    if (!causalLinks.some((link) => link.id === id)) causalLinks.push({ id, from: relation.fromId, to: relation.toId, fromChapter: from.parent, toChapter: to.parent, state: linkState });
  }
  for (let index = 1; index < chapters.length; index++) laneEdges.push({ id: `chapter-order-${index}`, from: `chapter_${chapters[index - 1].index}`, to: `chapter_${chapters[index].index}`, kind: 'flow', state: 'canon', parent: null });
  const journal = [];
  for (const record of processing) {
    const event = record.event;
    let label = '';
    let tone = 'plain';
    if (event.type === 'block.started') label = `CLI started ${event.blockId}`;
    if (event.type === 'sectioned') label = `${event.blockId} sectioned · ${event.sentences} sentences`;
    if (event.type === 'proposal.added') { label = `${event.proposal.kind} proposed · ${Math.round(event.proposal.confidence * 100)}% · ${event.proposal.id}`; tone = 'jev'; }
    if (event.type.startsWith('changeset.')) { label = `${event.changesetId} · ${event.type.slice(10)}${event.type === 'changeset.applied' ? ` · ${event.processed - event.unsupportedProposalIds.length} supported / ${event.unsupportedProposalIds.length} deferred · ${event.deferredFactIds?.length ?? 0} facts held` : ''}`; tone = event.type === 'changeset.held' ? 'warn' : 'ok'; }
    if (event.type === 'graph.rebuilt') { label = `Graph rebuilt · ${event.counts.entities} entities · ${event.counts.events} events · ${event.counts.relations} relations`; tone = 'ok'; }
    if (label) journal.push({ id: `cli-${record.id}`, timestamp: record.timestamp, text: text(label, 220), tone });
  }
  const callLabels = new Map(agent.filter(record => record.label && record.call).map(record => [record.call, record.label]));
  for (const record of agent) {
    const label = record.type === 'pi.status' && record.status === 'review' ? 'Pi paused at the merge gate · see Review for status' : record.label ?? callLabels.get(record.call);
    if (!label) continue;
    journal.push({ id: record.id, timestamp: record.timestamp, text: text(`${label}${record.type === 'pi.command' ? ` · ${record.status}` : ''}`, 230), tone: record.status === 'error' ? 'warn' : record.type === 'system1.call' ? 'jev' : record.status === 'ok' ? 'ok' : 'plain' });
  }
  for (const [index, record] of maintenance.entries()) journal.push({ id: `fix-${index}`, timestamp: record.ts, text: text(`Pi repair / ${record.op} · ${record.args?.blockId ?? 'ontology'} · audited CLI operation`, 180), tone: 'ok' });
  for (const draft of drafts) if (draft.stage !== 'gate') journal.push({ id: `draft-${draft.blockId}`, timestamp: draft.updatedAt, text: `${draft.blockId} working draft · ${draft.patchId} · ${draft.sceneSpans.length} scene decisions · ${draft.dialogueUnits.length} dialogue decisions · ${draft.proposals.length} proposals · not canon`, tone: 'jev' });
  journal.sort((first, second) => first.timestamp.localeCompare(second.timestamp));
  const piState = agent.findLast((record) => record.type === 'pi.status');
  const activeCall = agent.findLast((record) => record.stage !== undefined || record.type === 'pi.command');
  const expectedBlocks = blockChapters.size;
  const computedOutcome = runOutcome(changesets, processing, expectedBlocks, 'blocks');
  const outcome = computedOutcome.status === 'complete' || ['review', 'complete'].includes(piState?.status) ? computedOutcome : null;
  const finalizing = computedOutcome.status === 'complete' && piState?.status === 'working' && options.volume === options.activeVolume && options.volume !== undefined;
  const status = finalizing ? 'working' : outcome?.status ?? piState?.status ?? 'idle';
  const publicStatus = outcome ? await json(`${runtime}/public-status.json`, null) : null;
  const stage = status === 'working' ? activeCall?.stage ?? (activeCall?.label.includes('ingest') ? 1 : 4) : status === 'complete' || status === 'review' ? 4 : 0;
  const lastBlock = processing.findLast((record) => record.event.type === 'block.started')?.event.blockId;
  return {
    activity: liveActivity({ processing, agent, drafts, changesets: [...changesets, ...causalSets], interiors, blockChapters, dialogueScenes, afterId: options.activityAfter, reviewProgress: await sessionReviewProgress(runtime) }),
    world: { laneNodes, laneEdges, interiors, bigEventLabels, causal: { links: causalLinks, unresolved: causalUnresolved, dialogueScenes } }, gates,
    timePlace: await withCalendar(timePlaceProjection({ entities: [...entityMap.values()], scenes: [...sceneMap.values()], relations, events: [...eventMap.values()], pending: timePlacePending, strands: await readStrandAnswers(directory) }), (await json(`${directory}/ontology/manifest.json`, null))?.title), feed: journal.slice(-180).map((entry, index) => ({ ...entry, id: index + 1 })),
    status, stage, label: causalSets.length ? `${causalSets.length} causal packet${causalSets.length === 1 ? '' : 's'} awaiting review · not canon` : finalizing ? `${computedOutcome.applied}/${expectedBlocks} blocks applied · Pi final checks · ${computedOutcome.deferred} proposals deferred` : outcome?.label ?? piState?.label ?? 'Fresh database ready · waiting for you to open the viewer',
    workSite: `chapter_${blockChapters.get(lastBlock) ?? chapters[0]?.index ?? 0}`,
    volume: options.volume ?? 1,
    jobLabel: options.jobLabel ?? 'Full volume',
    expectedBlocks,
    summary: outcome?.held.includes(publicStatus?.changesetId) ? text(publicStatus.detail, 500) : null,
    reasonCodes: outcome?.held.includes(publicStatus?.changesetId) ? publicStatus.reasonCodes : [],
    counts: { entities: entityMap.size, events: eventMap.size, scenes: sceneMap.size, relations: relations.length, repairs: maintenance.length, ghosts: Object.values(interiors).flatMap((interior) => interior.nodes).filter((node) => node.state !== 'canon').length },
    chapters: chapters.map((chapter) => ({ index: chapter.index, title: chapter.title, characters: chapter.characters })),
    album: await albumProjection(directory, new Map([...entityMap.values()].map((entity) => [entity.id, entity.names?.find((form) => form.kind === 'canonical')?.text ?? entity.names?.[0]?.text ?? entity.id])), albumScenes),
    updatedAt: new Date().toISOString(),
  };
}
