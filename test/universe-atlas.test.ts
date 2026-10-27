import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryAdd, libraryDecide, libraryInit, libraryPrepare, libraryPropose, libraryShow, type LibraryOrganization } from "../src/ground/workspace/library.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { sourceHash } from "../src/ground/workspace/source.js";
import { atlasContext, atlasSweep, atlasTree, atlasView, atlasViolation, type AtlasPlace } from "../src/solidifier/atlas/universeAtlas.js";
import { review } from "../src/solidifier/merge/review.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";

const location = (id: string, name: string, properties: Record<string, unknown> = {}) => ({ id, kind: "Location", names: [{ text: name, lang: "zh", kind: "canonical" }], properties, confidence: 1 });
const part = (fromId: string, toId: string) => ({ fromId, toId, type: "PART_OF", properties: {}, confidence: 1 });

// Invented: Star City (星城) with District East (东区) and its hospital, across two books.
async function twoBooks(context: { after: (callback: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "universe-atlas-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "library");
  await libraryInit(directory);
  const books = [
    { text: "星城东区的医院很安静。\n小明走进东区的医院。", entities: [location("city", "星城"), location("east", "东区"), location("hospital", "医院", { generic: true, scopedTo: "east" })], relations: [part("east", "city"), part("hospital", "east")] },
    { text: "东区的医院又来了病人。\n星城下雨了。", entities: [location("east2", "东区"), location("city2", "星城"), location("hospital2", "医院", { generic: true, scopedTo: "east2" })], relations: [part("hospital2", "east2")] },
  ];
  const sources = [], workspaces: string[] = [], texts: string[] = [];
  for (const [index, book] of books.entries()) {
    const file = join(root, `book-${index + 1}.txt`);
    await writeFile(file, book.text);
    const source = (await libraryAdd(directory, file)).source;
    const prepared = await libraryPrepare(directory, source.id);
    const sentences = sectionBlock(await readFile(prepared.storedInput, "utf8"), 0).sentences;
    const scene = { id: "sc_1", chapterIndex: 0, sentenceIds: sentences.map((sentence) => sentence.id), charactersPresent: [], charactersMentioned: [], locationId: book.entities[2].id, turns: [], dialogues: [] };
    for (const [name, rows] of Object.entries({ entities: book.entities, relations: book.relations, scenes: [scene] })) await writeFile(join(prepared.workspace, "ontology", `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    sources.push(source); workspaces.push(prepared.workspace); texts.push(book.text);
  }
  const support = sources.map((source) => [{ sourceId: source.id, field: "filename" as const, quote: source.filename }]);
  const organization: LibraryOrganization = {
    universes: [{ id: "star", title: "星城宇宙", evidence: support[0] }],
    continuities: [{ id: "main", title: "主线", universeId: "star", evidence: support[0] }],
    series: [{ id: "story", title: "星城故事", evidence: support[0] }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, continuityId: "main", seriesId: "story", readingOrder: index + 1, status: "confirmed" as const, evidence: support[index], note: "阅读顺序。" })),
  };
  const proposed = await libraryPropose(directory, organization, (await libraryShow(directory)).revision);
  await libraryDecide(directory, proposed.planId, proposed.revision, "approve", "Synthetic membership review.");
  const bindings = { directory, bindings: sources.map((source, index) => ({ sourceId: source.id, workspace: workspaces[index], inputSha256: sourceHash(texts[index]) })) };
  return { directory, sources, bindings };
}

test("the universe atlas joins the same place across books through the shared gate, and a parent stated in one book reaches the other", async (context) => {
  const { directory, sources, bindings } = await twoBooks(context);
  const env = { NOVEL_SECRETS_DIR: join(tmpdir(), "no-atlas-keys"), NOVEL_CAUSAL_BINDINGS: join(directory, "..", "bindings.json") };
  await writeFile(env.NOVEL_CAUSAL_BINDINGS, JSON.stringify(bindings));
  const atlas = await atlasContext(directory, "star", bindings);
  assert.equal(atlas.places.length, 6);
  const swept = await atlasSweep(atlas, { propose: true });
  assert.equal(swept.proposals.length, 3, "same-name places and the hospital under same-name districts; no Jev, so names only");
  assert.ok(swept.proposals.every((proposal) => proposal.kind === "same_place" && proposal.evidence.a.length && proposal.evidence.b.length));
  const target = { directory, packetId: swept.packetId!, scope: "universe" as const, universeId: "star" };
  const page = await review("show", target, { limit: 20 }, env) as { revision: string; facts: { id: string }[] };
  assert.equal(page.facts.length, 3);
  for (const fact of page.facts) { let offset: number | null = 0; do { offset = ((await review("evidence", target, { factId: fact.id, offset, limit: 20 }, env)) as { page: { nextOffset: number | null } }).page.nextOffset; } while (offset !== null); }
  await review("decide", target, { revision: page.revision, decisions: page.facts.map((fact) => ({ factId: fact.id, verdict: "accept", reason: "两卷原文写的是同一地方。" })) }, env);
  await review("apply", target, { revision: page.revision }, env);
  const view = await atlasView(directory, "star", bindings);
  const east = view.places.find((place) => place.members.includes(`${sources[1].id}::east2`))!;
  assert.equal(east.members.length, 2, "District East is one universe place");
  assert.equal(east.parent, view.places.find((place) => place.members.includes(`${sources[0].id}::city`))!.id, "book 2's District East inherits Star City from book 1");
  assert.equal(east.proposed || east.parentProposed, false);
  assert.equal(view.places.find((place) => place.members.includes(`${sources[1].id}::hospital2`))!.parent, east.id);
  assert.equal((await atlasSweep(await atlasContext(directory, "star", bindings))).candidates, 0, "joined places are not asked again");
});

test("Jev judges cross-book containment; the universe tree refuses a second parent", async (context) => {
  const { directory, sources, bindings } = await twoBooks(context);
  const atlas = await atlasContext(directory, "star", bindings);
  const decisions: DecisionModel = { modelId: "mock-jev", async decide(_state, questions) {
    return questions.map((question) => ({ key: question.key, value: question.options![0], confidence: 0.9, distribution: { [question.options![0]]: 0.9 } }));
  } };
  const swept = await atlasSweep(atlas, { decisions });
  assert.equal(swept.asked, 3);
  assert.ok(swept.proposals.every((proposal) => proposal.method === "jev" && proposal.confidence === 0.9));
  // A place with a parent in each book that are different places cannot be joined.
  const places: AtlasPlace[] = [
    { qualified: "a::east", sourceId: "a", entityId: "east", label: "东区", names: ["东区"], generic: false, scopedTo: null, parent: "a::city", scenes: 1 },
    { qualified: "a::city", sourceId: "a", entityId: "city", label: "星城", names: ["星城"], generic: false, scopedTo: null, parent: null, scenes: 0 },
    { qualified: "b::east", sourceId: "b", entityId: "east", label: "东区", names: ["东区"], generic: false, scopedTo: null, parent: "b::harbour", scenes: 1 },
    { qualified: "b::harbour", sourceId: "b", entityId: "harbour", label: "港城", names: ["港城"], generic: false, scopedTo: null, parent: null, scenes: 0 },
  ];
  const fake = { ...atlas, places, byQualified: new Map(places.map((place) => [place.qualified, place])) };
  assert.match(atlasViolation(fake, [], [{ kind: "same_place", a: "a::east", b: "b::east" }])!, /two parents/);
  assert.match(atlasViolation(fake, [], [{ kind: "part_of", a: "a::east", b: "b::harbour" }])!, /exactly one parent/);
  assert.equal(atlasViolation(fake, [], [{ kind: "part_of", a: "b::harbour", b: "a::city" }]), null);
  const tree = atlasTree(places, [{ kind: "part_of", a: "b::harbour", b: "a::city" }]);
  assert.equal(tree.parent.get("b::harbour"), "a::city");
  assert.ok(sources.length === 2);
});
