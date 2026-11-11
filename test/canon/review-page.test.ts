import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newChangeSet } from "../../src/canon/gate/changeset.js";
import { listChangeSets, saveChangeSet } from "../../src/canon/gate/changesetStore.js";
import { reviewPage } from "../../src/canon/gate/reviewPage.js";

const execute = promisify(execFile);

test("review pagination covers every proposal and note, including the final partial page", () => {
  const changeset = newChangeSet("b0001");
  changeset.proposals = Array.from({ length: 43 }, (_, index) => ({ id: `p${index}`, kind: "set_state_change", payload: {}, confidence: 0.7, provenance: { blockId: "b0001", sentenceIds: [], patchId: "test" } }));
  changeset.reviewNotes = { one: "first", two: "second" };
  const ids = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = reviewPage(changeset, { offset, limit: 20 });
    assert.ok("proposals" in page && page.proposals);
    ids.push(...page.proposals.map((proposal) => proposal.id));
    offset = page.page!.nextOffset;
  }
  assert.deepEqual(ids, changeset.proposals.map((proposal) => proposal.id));
  const notePage = reviewPage(changeset, { notes: true, offset: 1, limit: 1 });
  assert.ok("reviewNotes" in notePage);
  assert.deepEqual(notePage.reviewNotes, { two: "second" });
  assert.equal(reviewPage(changeset, { summary: true }).totalProposals, 43);
  for (const options of [{ offset: -1 }, { limit: 0 }, { limit: 101 }, { offset: NaN }]) assert.throws(() => reviewPage(changeset, options));
});

