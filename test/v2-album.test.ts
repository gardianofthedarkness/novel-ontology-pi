import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorByText, sentenceIndex } from "../src/v2/album.js";

// The book's sentences as the v2 flow cut them, and the same book as the EPUB's own extraction has it: other spacing, a
// front page the book's text lacks, and a picture between two sentences.
const sentences = [
  { id: "b0_s0", text: "The rain kept on all morning over the bridge." },
  { id: "b0_s1", text: "She waited under the station clock." },
  { id: "b0_s2", text: "A train came in at last, an hour late." },
  { id: "b0_s3", text: "He stepped down with nothing in his hands." },
  { id: "b0_s4", text: "The rain kept on all morning over the bridge." },
];
const front = "A NOVEL\n\nContents\n\n";
const album = `${front}The rain kept on all\n morning over the bridge. She waited under the station clock.\n\n[picture]\n\nA train came in at last, an hour late. He stepped down with nothing in his hands. The rain kept on all morning over the bridge.`;

test("a picture is anchored by its words on the book's own sentences, not by offsets", () => {
  const index = sentenceIndex(sentences), at = album.indexOf("[picture]") + "[picture]".length;
  const anchor = anchorByText(album, at, index);
  assert.equal(anchor.sentenceId, "b0_s2", "the sentence its following words begin");
  assert.equal(anchor.by, "after");
});

test("words that occur twice take the longer run that occurs once, from where the last picture was found", () => {
  const index = sentenceIndex(sentences), at = album.indexOf("The rain kept on all morning over the bridge.", front.length + 10);
  const anchor = anchorByText(album, at, index, index.starts[3]);
  assert.equal(anchor.sentenceId, "b0_s4", "the second time those words stand, past the last anchor");
});

test("words not in the book's text: the words before the picture, else none", () => {
  const index = sentenceIndex(sentences);
  const end = anchorByText(`${album}\n\nTHE END BY THE AUTHOR`, album.length, index);
  assert.equal(end.by, "before");
  assert.equal(end.sentenceId, "b0_s4");
  assert.equal(anchorByText("Nothing of this book here at all.", 0, index).sentenceId, null);
});
