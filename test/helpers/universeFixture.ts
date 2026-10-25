import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryAdd, libraryDecide, libraryInit, libraryPrepare, libraryPropose, libraryShow, type LibraryOrganization, type LibrarySource } from "../../src/ground/workspace/library.js";
import { sectionBlock } from "../../src/digger/intake/sectioning.js";
import { sourceHash } from "../../src/ground/workspace/source.js";

export async function universeFixture(context: { after: (callback: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "universe-causality-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "library");
  await libraryInit(directory);
  const sources: LibrarySource[] = [], workspaces: string[] = [], originals: string[] = [];
  const texts = ["世界甲第一卷。\n小明打开了水闸。\n小红说：「水将流向城镇。」", "世界甲第二卷。\n由于小明打开水闸，城镇进水。\n小红说：「快关上水闸！」", "世界甲另一连续性。\n小明仍在沉睡。\n小红看着水闸。", "世界乙。\n这里也有小明。\n小红在这里。", "世界甲支线。\n小红在城镇救人。\n小明向她呼救。", "世界甲未处理卷。\n小明尚未被抽取。"];
  for (const [index, text] of texts.entries()) {
    const file = join(root, `volume-${index + 1}.txt`);
    await writeFile(file, text);
    const source = (await libraryAdd(directory, file)).source;
    const prepared = await libraryPrepare(directory, source.id);
    const sentences = sectionBlock(await readFile(prepared.storedInput, "utf8"), 0).sentences;
    const entity = { id: "char_1", kind: "Character", names: [{ text: "小明", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 };
    const event = { id: "ev_1", chapterIndex: 0, chronologicalOrder: 0, timelineId: "tl_canon", summaryEn: `摘要${index + 1}`, eventType: "action", importance: 0.5, primaryActors: ["char_1"], affectedCharacters: [], evidence: { sentenceIds: [sentences[1].id], text: sentences[1].text }, confidence: 1 };
    const scene = { id: "sc_1", chapterIndex: 0, sentenceIds: sentences.map(sentence => sentence.id), charactersPresent: ["char_1"], charactersMentioned: [], locationId: null, turns: [], dialogues: [{ id: "card_1", sentenceIds: [sentences.at(-1)!.id], participantIds: ["char_1"], summary: "原文对话" }] };
    if (index !== 5) for (const [file, rows] of Object.entries({ entities: [entity], events: [event], scenes: [scene] })) await writeFile(join(prepared.workspace, "ontology", `${file}.jsonl`), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    sources.push(source); workspaces.push(prepared.workspace); originals.push(text);
  }
  const support = sources.map(source => [{ sourceId: source.id, field: "filename" as const, quote: source.filename }]);
  const organization: LibraryOrganization = {
    universes: [{ id: "world", title: "世界甲", evidence: support[0] }, { id: "other", title: "世界乙", evidence: support[3] }],
    continuities: [{ id: "main", title: "主线", universeId: "world", evidence: support[0] }, { id: "alternate", title: "另一连续性", universeId: "world", evidence: support[2] }, { id: "unrelated", title: "主线", universeId: "other", evidence: support[3] }],
    series: [{ id: "story", title: "主故事", evidence: support[0] }, { id: "side", title: "支线", evidence: support[4] }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, continuityId: index === 2 ? "alternate" : index === 3 ? "unrelated" : "main", seriesId: index === 4 ? "side" : "story", readingOrder: index + 1, status: "confirmed", evidence: support[index], note: "阅读顺序，不代表故事时间。" })),
  };
  const proposed = await libraryPropose(directory, organization, (await libraryShow(directory)).revision);
  await libraryDecide(directory, proposed.planId, proposed.revision, "approve", "Synthetic membership review.");
  const bindings = { directory, bindings: sources.map((source, index) => ({ sourceId: source.id, workspace: workspaces[index], inputSha256: sourceHash(originals[index]) })) };
  return { root, directory, sources, workspaces, originals, organization, bindings };
}
