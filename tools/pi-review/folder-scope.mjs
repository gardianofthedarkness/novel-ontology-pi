/** What Pi may run while it arranges a folder for Novel Console (folder-arrange.mjs). */
import { resolve } from 'node:path';

// The verbs that sort books or read what was found; a reading, the keys, an import, links and the server are not Pi's.
export const VERBS = new Set(['basics', 'show', 'scan', 'universe', 'put', 'take', 'chapters', 'cast', 'who', 'refs', 'line', 'problems']);

/** Shell words of one command; null when it holds a pipe, a join, a redirect, an expansion or an open quote. */
export function words(command) {
  const out = []; let word = null, quote = null;
  for (let at = 0; at < command.length; at++) {
    const char = command[at];
    if (quote === "'") { if (char === "'") quote = null; else word += char; continue; }
    if (quote === '"') {
      if (char === '"') { quote = null; continue; }
      if (char === '$' || char === '`') return null;
      if (char === '\\' && '"\\$`'.includes(command[at + 1] ?? '')) { word += command[++at]; continue; }
      word += char; continue;
    }
    if (/\s/.test(char)) { if (word !== null) { out.push(word); word = null; } continue; }
    if ('|&;<>$`(){}*?~#'.includes(char)) return null;
    if (char === "'" || char === '"') { quote = char; word ??= ''; continue; }
    if (char === '\\') { word = (word ?? '') + (command[++at] ?? ''); continue; }
    word = (word ?? '') + char;
  }
  return quote ? null : (word !== null && out.push(word), out);
}

/** What one command may do: run the novel command on this folder, or read the skill. Throws Pi's refusal. */
export function permit(command, scope) {
  const args = words(command.trim());
  const usage = `Run ONE command per call, no pipes or joins: ${scope.novel} folder <verb> "${scope.folder}" ... (verbs: ${[...VERBS].join(', ')}), or cat "${scope.skill}".`;
  if (!args?.length) throw new Error(`Not a plain command. ${usage}`);
  if (args[0] === 'cat' && args.length === 2 && resolve(args[1]) === scope.skill) return { kind: 'read' };
  if (args[0] === 'sed' && args.length === 4 && args[1] === '-n' && /^\d+,\d+p$/.test(args[2]) && resolve(args[3]) === scope.skill) return { kind: 'read', lines: args[2].slice(0, -1).split(',').map(Number) };
  if (args[0] !== scope.novel && args[0] !== 'novel') throw new Error(`Only the novel command runs here. ${usage}`);
  if (args[1] !== 'folder') throw new Error(`Only "novel folder" commands run here. ${usage}`);
  if (!VERBS.has(args[2])) throw new Error(`"novel folder ${args[2] ?? ''}" is not for arranging (a reading, the keys or an import is the user's). ${usage}`);
  if (resolve(args[3] ?? '') !== scope.folder) throw new Error(`Work on this folder only: "${scope.folder}". ${usage}`);
  return { kind: 'novel', args: args.slice(1) };
}

