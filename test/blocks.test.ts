import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cutBlocks, splitChapters } from "../src/text/blocks.js";

const fixture = fileURLToPath(
  new URL("../../test/fixtures/sample-novel.txt", import.meta.url),
);

test("splitChapters finds front matter + 3 titled chapters", async () => {
  const text = await readFile(fixture, "utf8");
  const chapters = splitChapters(text);
  assert.equal(chapters.length, 4);
  assert.equal(chapters[0].title, null);
  assert.match(chapters[1].title ?? "", /第一章/);
  assert.match(chapters[2].title ?? "", /第二章/);
  assert.match(chapters[3].title ?? "", /第三章/);
  // Chapters tile the source exactly.
  assert.equal(chapters.map((c) => c.text).join(""), text);
});

test("cutBlocks respects size cap and stays consistent with source", async () => {
  const text = await readFile(fixture, "utf8");
  const blocks = cutBlocks(text, 200);
  assert.ok(blocks.length >= 4, `expected >=4 blocks, got ${blocks.length}`);
  blocks.forEach((b, i) => {
    assert.equal(b.id, `b${String(i + 1).padStart(4, "0")}`);
    assert.equal(b.text, text.slice(b.startOffset, b.endOffset));
    assert.equal(b.charCount, b.endOffset - b.startOffset);
    assert.ok(b.charCount <= 200, `block ${b.id} too big: ${b.charCount}`);
  });
  // Chapter indices never go backwards.
  for (let i = 1; i < blocks.length; i++) {
    assert.ok(blocks[i].chapterIndex >= blocks[i - 1].chapterIndex);
  }
});

test("one big target keeps one block per chapter", async () => {
  const text = await readFile(fixture, "utf8");
  const blocks = cutBlocks(text, 100000);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[3].chapterTitle?.includes("第三章"), true);
});

const BODY = "这是一个足够长的正文段落，用来证明章节里确实有内容存在，不会被误判为空章节。";

test("K1: clustered credit lines (第一章：<names>) are not chapter boundaries", () => {
  const text = [
    "制作信息",
    "第一章：译者甲",
    "行间一：译者乙",
    "第二章：译者乙、译者丙",
    "行间二：译者甲",
    "第三章：译者丙",
    "简介",
    BODY,
    "第一章",
    "启程",
    BODY,
    "第二章",
    "归途",
    BODY,
  ].join("\n");
  const chapters = splitChapters(text);
  // Front matter (credits + intro) + the two real chapters only.
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, null);
  assert.match(chapters[0].text, /第一章：译者甲/); // credit folds into front matter
  assert.equal(chapters.map((c) => c.text).join(""), text); // still tiles exactly
  const blocks = cutBlocks(text, 100000);
  assert.ok(blocks.every((b) => b.charCount >= 40), "no micro blocks");
});

test("K1 guard: a lone colon-titled chapter stays a heading", () => {
  const text = ["第一章：启程", BODY, BODY, "第二章：归途", BODY, BODY].join("\n");
  const chapters = splitChapters(text);
  assert.equal(chapters.length, 2);
  assert.match(chapters[0].title ?? "", /第一章：启程/);
  assert.match(chapters[1].title ?? "", /第二章：归途/);
});

test("K2: combined title line + bare duplicate heading make one chapter, no orphan block", () => {
  const text = [
    "序章　在平安夜最初的交叉点",
    "序章",
    "在平安夜最初的交叉点",
    BODY,
    "第一章",
    "如同游乐场一般",
    BODY,
  ].join("\n");
  const chapters = splitChapters(text);
  assert.equal(chapters.length, 3); // the combined line survives only as front matter
  assert.equal(chapters[0].title, null);
  assert.match(chapters[0].text, /序章　在平安夜最初的交叉点/);
  assert.match(chapters[1].title ?? "", /^序章$/);
  const blocks = cutBlocks(text, 100000);
  assert.equal(blocks.length, 2); // the orphan title block merges forward into the prologue's block
  assert.ok(blocks.every((b) => b.charCount >= 40), "no 12–13-char orphan block");
});

test("K2: a table-of-contents run of bare headings opens no chapters", () => {
  const text = [
    "目录",
    "第一章",
    "",
    "第二章",
    "",
    "第三章",
    "第一章",
    "正文开始",
    BODY,
    "第二章",
    "继续",
    BODY,
    "第三章",
    "结尾",
    BODY,
  ].join("\n");
  const chapters = splitChapters(text);
  assert.equal(chapters.length, 4); // front matter (incl. TOC) + 3 real chapters
  assert.equal(chapters.map((c) => c.text).join(""), text);
});
