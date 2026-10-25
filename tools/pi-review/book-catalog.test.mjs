import test from 'node:test';
import assert from 'node:assert/strict';
import { bookCatalog, sourceBasename } from './book-catalog.mjs';

test('book catalog exposes only id, title and source basename', () => {
  const volumes = [
    { id: 1, workspace: '/Users/owner/runtime/novel', metadataDirectory: '/Users/owner/runtime/volume-1', title: '创约·魔法禁书目录1', sourceFiles: ['创约·魔禁 01.epub'] },
    { id: 2, workspace: '/Users/owner/runtime/book-2', metadataDirectory: '/Users/owner/runtime/volume-2' },
    { id: 9, workspace: '/Users/owner/runtime/book-9', metadataDirectory: '/Users/owner/runtime/volume-9' },
  ];
  const catalog = [{ id: 2, title: '创约·魔法禁书目录2', aliases: ['/Users/owner/Downloads/novel/新约/创约·魔禁 02.epub', '/Users/owner/sandbox/创约·魔禁 02.epub'] }];
  const books = bookCatalog(volumes, catalog);
  assert.deepEqual(books, [
    { id: 1, title: '创约·魔法禁书目录1', sourceFile: '创约·魔禁 01.epub' },
    { id: 2, title: '创约·魔法禁书目录2', sourceFile: '创约·魔禁 02.epub' },
    { id: 9, title: 'Book 9', sourceFile: null },
  ]);
  assert.doesNotMatch(JSON.stringify(books), /\/Users|workspace|metadata/);
});

test('source basenames strip directories and control characters', () => {
  assert.equal(sourceBasename('C:\\books\\vol\u0007 2.epub'), 'vol  2.epub');
  assert.equal(sourceBasename('/a/b/'), '');
  assert.equal(sourceBasename(42), '');
});
