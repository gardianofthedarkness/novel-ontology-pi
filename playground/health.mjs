import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { repository } from './prepare.mjs';

const home = process.env.PLAYGROUND_HOME ?? join(repository, '.team-playground');
try {
  const active = JSON.parse(await readFile(join(home, 'active.json'), 'utf8'));
  const links = JSON.parse(await readFile(join(active.session, 'links.json'), 'utf8'));
  if (Date.parse(links.expiresAt) <= Date.now()) throw new Error('Expired');
  const url = new URL('api/live', links.readOnlyUrl);
  const status = await new Promise((done, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port: Number(process.env.PLAYGROUND_PORT ?? 5180), path: url.pathname, headers: { Host: url.host }, timeout: 5000 }, response => { response.resume(); response.once('end', () => done(response.statusCode)); });
    outgoing.once('error', reject);
    outgoing.once('timeout', () => outgoing.destroy(new Error('Timeout')));
    outgoing.end();
  });
  if (status !== 200) throw new Error('Unavailable');
  console.log('Team playground healthy');
} catch { console.error('Team playground unavailable or expired'); process.exitCode = 1; }
