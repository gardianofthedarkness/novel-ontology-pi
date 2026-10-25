import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePreview } from './dev-preview.mjs';

const scope = { origin: 'https://example.trycloudflare.com', privatePath: '/view/synthetic-private-path/', expiresAt: new Date(Date.now() + 60000).toISOString() };
const request = (url, method = 'GET', headers = {}) => ({ url, method, headers: { host: 'example.trycloudflare.com', ...headers } });

test('private hot preview authenticates every HTTP and WebSocket entry', () => {
  assert.equal(authorizePreview(request(`${scope.privatePath}src/main.tsx`), scope), 200);
  assert.equal(authorizePreview(request('/'), scope), 401);
  assert.equal(authorizePreview(request('/@fs/private/source.txt'), scope), 401);
  assert.equal(authorizePreview(request(`${scope.privatePath}../source.txt`), scope), 401);
  assert.equal(authorizePreview(request(scope.privatePath, 'GET', { host: 'evil.example' }), scope), 403);
  assert.equal(authorizePreview(request(scope.privatePath), { ...scope, expiresAt: '2020-01-01' }), 410);
  const upgrade = { ...scope, upgrade: true };
  assert.equal(authorizePreview(request(`${scope.privatePath}__hmr`, 'GET', { origin: scope.origin }), upgrade), 200);
  assert.equal(authorizePreview(request(`${scope.privatePath}__hmr`, 'GET', { origin: 'https://evil.example' }), upgrade), 403);
  assert.equal(authorizePreview(request(`${scope.privatePath}src/main.tsx`, 'GET', { origin: scope.origin }), upgrade), 403);
});

test('only an exact authorized frontend origin can forward a Pi message', () => {
  const path = `${scope.privatePath}api/pi/messages`;
  assert.equal(authorizePreview(request(path, 'POST', { origin: scope.origin }), scope), 200);
  assert.equal(authorizePreview(request(path, 'POST'), scope), 403);
  assert.equal(authorizePreview(request(path, 'POST', { origin: 'https://evil.example' }), scope), 403);
  assert.equal(authorizePreview(request(path), scope), 403);
  assert.equal(authorizePreview(request(`${scope.privatePath}src/main.tsx`, 'POST', { origin: scope.origin }), scope), 405);
});
