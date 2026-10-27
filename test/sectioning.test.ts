import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionBlock } from "../src/digger/intake/sectioning.js";

test("CJK sentences split on terminal punctuation, quotes absorbed", () => {
  const text = "御坂美琴走进咖啡店。「你来了。」她说道。窗外下着雨。";
  const { sentences } = sectionBlock(text, 0);
  // Quote and its attribution tag are separate sentences at this stage;
  // stitching them into one dialogue unit is the dialogue patch's job.
  assert.equal(sentences.length, 4);
  assert.ok(sentences[0].text.endsWith("。"));
  assert.ok(sentences[1].text.includes("你来了"));
  assert.ok(sentences[1].text.includes("。」"));
  // IDs are stable and offsets are ordered
  assert.equal(sentences[0].id, "b0000_s0000");
  assert.ok(sentences[1].startOffset > sentences[0].startOffset);
});

test("English abbreviations and decimals do not split", () => {
  const text = "Dr. Smith paid 3.5 dollars. He left at once.";
  const { sentences } = sectionBlock(text, 1);
  assert.equal(sentences.length, 2);
  assert.ok(sentences[0].text.startsWith("Dr. Smith"));
});

test("paragraphs are tracked", () => {
  const text = "第一段。\n\n第二段开始！真的吗？";
  const { sentences, paragraphCount } = sectionBlock(text, 2);
  assert.equal(paragraphCount, 2);
  assert.equal(sentences.length, 3);
  assert.equal(sentences[2].paragraphIndex, 1);
});

test("sentence offsets preserve the full original paragraph separators", () => {
  for (const separator of ["\n", "\n\n", "\n\n\n\n", "\n \t\n", "\r\n", "\r\n\r\n", "\n　\n"]) {
    const text = `　甲。${separator} 乙！${separator}😀丙？\n\n`;
    const { sentences, paragraphCount } = sectionBlock(text, 7);
    assert.equal(paragraphCount, 3);
    assert.deepEqual(sentences.map(sentence => ({ id: sentence.id, index: sentence.index, paragraph: sentence.paragraphIndex, text: sentence.text })), [
      { id: "b0007_s0000", index: 0, paragraph: 0, text: "甲。" },
      { id: "b0007_s0001", index: 1, paragraph: 1, text: "乙！" },
      { id: "b0007_s0002", index: 2, paragraph: 2, text: "😀丙？" },
    ]);
    for (const sentence of sentences) {
      assert.equal(text.slice(sentence.startOffset, sentence.endOffset), sentence.text, JSON.stringify(separator));
      assert.equal(sentence.startOffset, text.indexOf(sentence.text));
    }
  }
});

test("repeated paragraphs and leading blank lines keep exact ordered spans", () => {
  const text = "\n\n同じ。\n\n\n同じ。\n \t\n同じ。";
  const { sentences } = sectionBlock(text, 2);
  assert.deepEqual(sentences.map(sentence => sentence.paragraphIndex), [1, 2, 3]);
  let previousEnd = 0;
  for (const sentence of sentences) {
    assert.equal(sentence.startOffset, text.indexOf(sentence.text, previousEnd));
    assert.equal(text.slice(sentence.startOffset, sentence.endOffset), sentence.text);
    previousEnd = sentence.endOffset;
  }
  assert.deepEqual(sectionBlock("", 0), { sentences: [], paragraphCount: 0 });
  assert.deepEqual(sectionBlock("\n \t\n", 0), { sentences: [], paragraphCount: 0 });
});
