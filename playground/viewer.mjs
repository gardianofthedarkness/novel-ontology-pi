import { readFile } from 'node:fs/promises';
import { createViewer } from '../tools/pi-review/serve.mjs';
import { snapshot } from '../tools/pi-review/snapshot.mjs';
import { recordSource } from '../tools/pi-review/record-source.mjs';
import { sectionBlock } from '../dist/src/digger/intake/sectioning.js';

const rows = async filename => (await readFile(filename, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);

export async function createTeamViewer({ prepared, mode, expiresAt, runtime, dist }) {
  const control = mode === 'agent' ? JSON.parse(await readFile(`${runtime}/pi-control.json`, 'utf8')) : null;
  const volume = mode === 'agent' ? JSON.parse(await readFile(`${runtime}/live-volumes.json`, 'utf8'))[0] : { id: 1, workspace: prepared.reference, metadataDirectory: prepared.metadata };
  const agentEvents = `${runtime}/pi-events.jsonl`;
  const viewer = await createViewer({ port: 0, expiresAt, dist, watchPaths: [volume.workspace, runtime], ...(control ? { console: { directory: `${runtime}/pi-console`, agentEvents, controlToken: control.token } } : {}), readLive: async ({ activityAfter }) => {
    const data = await snapshot(volume.workspace, volume.metadataDirectory, { volume: volume.id, activityAfter, agentEvents, jobStatus: mode === 'agent', jobLabel: mode === 'agent' ? 'Synthetic source / live Pi / fresh test database' : 'Original synthetic fixture / illustrative annotations / not a Pi extraction' });
    return { ...data, ...(mode === 'view' ? { status: 'idle', stage: 0, label: 'Illustrative authored snapshot · no model or approval run' } : {}), availableVolumes: [volume.id] };
  } });
  const handler = viewer.server.listeners('request')[0];
  viewer.server.removeAllListeners('request');
  viewer.server.on('request', async (request, response) => {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) { handler(request, response); return; }
    let url;
    try { url = new URL(request.url, viewer.origin); } catch { response.writeHead(400).end(); return; }
    if (url.pathname !== `${viewer.privatePath}api/record-source`) { handler(request, response); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.headers.host !== new URL(viewer.origin).host || request.method !== 'GET' || request.socket.localAddress !== '127.0.0.1') { response.writeHead(403).end(); return; }
    if (Date.now() >= Date.parse(expiresAt)) { response.writeHead(410).end(); return; }
    const id = url.searchParams.get('id');
    if (!id || id.length > 512) { response.writeHead(400).end(); return; }
    try {
      const data = await recordSource({ id, scenes: await rows(`${volume.workspace}/ontology/scenes.jsonl`), events: await rows(`${volume.workspace}/ontology/events.jsonl`), sectionBlock, readBlock: index => readFile(`${volume.metadataDirectory}/b${String(index + 1).padStart(4, '0')}.txt`, 'utf8') });
      if (!data) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
    } catch { response.writeHead(404).end(); }
  });
  return { ...viewer, readOnlyUrl: `${viewer.url}&source=1`, operatorUrl: control ? `${viewer.url}&source=1#pi=${control.token}` : `${viewer.url}&source=1` };
}
