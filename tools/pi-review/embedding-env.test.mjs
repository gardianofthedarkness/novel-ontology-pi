import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddingEnvironment } from './embedding-env.mjs';

test('host forwards only explicitly configured embedding settings to its CLI', () => {
  assert.deepEqual(embeddingEnvironment({ EMBEDDING_MODEL: 'local-model', EMBEDDING_BASE_URL: 'http://127.0.0.1:8194/v1', EMBEDDING_API_KEY: '', UNRELATED_SECRET: 'private' }), {
    EMBEDDING_MODEL: 'local-model', EMBEDDING_BASE_URL: 'http://127.0.0.1:8194/v1',
  });
});
