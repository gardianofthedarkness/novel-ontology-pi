import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const requireFrontend = createRequire(new URL('../apps/playground/package.json', import.meta.url));
const { createElement } = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
const source = await fs.readFile(new URL('../apps/playground/src/components/PiReviewProgress.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: requireFrontend });
const render = review => renderToStaticMarkup(createElement(module.exports.PiReviewProgress, { review }));

test('review panel displays exact observed page and counts, distinguishing read coverage from acceptance', () => {
  const html = render({ active: true, volume: 2, chapterIndex: 3, blockId: 'b0001', changesetId: 'cs_b0001', phase: 'facts', status: 'ok', offset: 20, pageCount: 2, total: 100, totalFacts: 100, inspectedFacts: 22, accepted: 7, rejected: 2, held: 1, unreviewed: 90, fields: ['identity', 'dialogue-member'], factIds: ['PRIVATE-ID'], nodeIds: [] });
  assert.match(html, /21–22 \/ 100/);
  assert.match(html, /22 \/ 100 facts observed read/);
  assert.match(html, /reading is not acceptance/);
  assert.match(html, /7 accepted/);
  assert.match(html, /Identity · Dialogue participants/);
  assert.ok(!html.includes('PRIVATE-ID'));
});

test('missing telemetry, inactive history and pending requests are never presented as current successful review', () => {
  assert.match(render(null), /waiting for review telemetry/);
  const review = { volume: 2, chapterIndex: 3, blockId: 'b0001', changesetId: 'cs_b0001', phase: 'decide', status: 'requested', active: true, factPositions: [3, 7, 9], nodeIds: [] };
  assert.match(render(review), /tool requested/);
  assert.match(render(review), /3, 7, 9/);
  assert.match(render({ ...review, active: false }), /last observed/);
});
