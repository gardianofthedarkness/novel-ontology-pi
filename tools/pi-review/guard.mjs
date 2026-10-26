export function tokenize(command) {
  const tokens = [];
  let value = '';
  let quote = null;
  let started = false;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && quote === '"') {
        if (++index >= command.length) throw new Error('Unclosed escape');
        value += command[index];
      } else value += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (character === '\\') {
      if (++index >= command.length) throw new Error('Unclosed escape');
      value += command[index];
      started = true;
    } else if (/\s/.test(character)) {
      if (character === '\n' || character === '\r') throw new Error('One command per call');
      if (started) tokens.push(value);
      value = '';
      started = false;
    } else {
      if (/[;&|<>`$(){}*?\[\]#]/.test(character)) throw new Error('Shell operators and expansions are disabled');
      value += character;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed quote');
  if (started) tokens.push(value);
  return tokens;
}

export function authorize(command, scope) {
  const { novel, input, skill, sourcePaths, blockIds, maxBlocks } = scope;
  const tokens = tokenize(command);
  if (tokens[0] === 'wc' && tokens[1] === '-l' && tokens.length === 3 && sourcePaths.includes(tokens[2])) {
    return { kind: 'read', path: tokens[2], count: true, label: 'Count source lines' };
  }
  if (tokens[0] === 'sed' && tokens[1] === '-n' && tokens.length === 4 && sourcePaths.includes(tokens[3])) {
    const range = tokens[2].match(/^(\d+),(\d+)p$/);
    if (!range || Number(range[1]) < 1 || Number(range[2]) < Number(range[1]) || Number(range[2]) - Number(range[1]) >= 150) throw new Error('Source reads allow 1–150 lines per page');
    return { kind: 'read', path: tokens[3], start: Number(range[1]), end: Number(range[2]), label: `Read source lines ${range[1]}–${range[2]}` };
  }
  if (tokens[0] === 'cat' && tokens.length === 2 && sourcePaths.includes(tokens[1])) {
    return { kind: 'read', path: tokens[1], label: tokens[1] === skill ? 'Read ontology skill' : 'Read supplied source/reference' };
  }
  if (tokens.shift() !== 'novel') throw new Error('Use only novel commands or cat of the supplied skill/source block');
  const [verb, operation] = tokens;
  const changesetIds = [...blockIds.map(id => `cs_${id}`), ...(scope.causalityChangesetIds ?? [])];
  if (scope.reviewProtocol === 'review-v1' && (
    verb === 'changeset' && ['facts', 'decide', 'approve'].includes(operation) && tokens[2] === novel
    || verb === 'library' && operation === 'decide' && tokens[2] === scope.library?.directory
    || verb === 'causality' && operation === 'universe' && tokens[2] === 'decide' && tokens[3] === scope.library?.directory
  )) throw new Error('Use novel review show|evidence|decide|apply with --scope book|universe|library; every faculty shares the same gate.');
  if (verb === 'review') {
    const allowed = {
      show: ['--scope', '--universe', '--offset', '--limit'],
      evidence: ['--scope', '--universe', '--fact', '--offset', '--limit'],
      decide: ['--scope', '--universe', '--revision', '--decisions'],
      apply: ['--scope', '--universe', '--revision'],
    };
    if (!Object.hasOwn(allowed, operation)) throw new Error('Use review show|evidence|decide|apply');
    const flags = new Map();
    for (let index = 4; index < tokens.length; index += 2) {
      if (!allowed[operation].includes(tokens[index]) || flags.has(tokens[index]) || !tokens[index + 1]) throw new Error('Review options require unique bounded values');
      flags.set(tokens[index], tokens[index + 1]);
    }
    const kind = flags.get('--scope') ?? 'book';
    const assigned = kind === 'book' ? tokens[2] === novel && changesetIds.includes(tokens[3]) && !flags.has('--universe')
      : kind === 'library' ? tokens[2] === scope.library?.directory && /^plan_[a-f0-9]{64}$/.test(tokens[3] ?? '') && !flags.has('--universe')
      : kind === 'universe' && tokens[2] === scope.library?.directory && /^uc_[a-f0-9]{64}$/.test(tokens[3] ?? '') && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(flags.get('--universe') ?? '');
    if (!assigned) throw new Error('Review target is outside the assigned scope');
    for (const name of ['--offset', '--limit']) if (flags.has(name) && (!/^\d+$/.test(flags.get(name)) || !Number.isSafeInteger(Number(flags.get(name))) || Number(flags.get(name)) < (name === '--limit' ? 1 : 0) || name === '--limit' && Number(flags.get(name)) > 20)) throw new Error('Review page exceeds its budget');
    if (operation === 'evidence' && (!flags.get('--fact') || flags.get('--fact').length > 2000)) throw new Error('Use --fact from review show');
    if (['decide', 'apply'].includes(operation) && !/^[a-f0-9]{64}$/.test(flags.get('--revision') ?? '')) throw new Error('Review mutation requires the current revision');
    if (operation === 'decide') {
      const raw = flags.get('--decisions') ?? '';
      if (Buffer.byteLength(raw) > 64000 || !Array.isArray(JSON.parse(raw)) || JSON.parse(raw).length > 50) throw new Error('Review decisions exceed their budget');
    }
    if (['show', 'evidence'].includes(operation) && !flags.has('--limit')) tokens.push('--limit', '10');
    return { kind: 'cli', args: tokens, label: `novel review ${operation}` };
  }
  let valid = false;
  if (verb === 'causality' && operation === 'universe') {
    const sub = tokens[2], library = scope.library;
    if (!library || tokens[3] !== library.directory || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(tokens[4] ?? '')) throw new Error('Universe causality requires the assigned reviewed library');
    const count = ['evidence', 'propose'].includes(sub) ? 2 : ['show', 'decide'].includes(sub) ? 1 : 0;
    const values = tokens.slice(5, 5 + count);
    if (values.length !== count || values.some(value => count === 2 ? !/^doc_[a-f0-9]{64}::[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,511}$/.test(value) : !/^uc_[a-f0-9]{64}$/.test(value))) throw new Error('Invalid qualified causal endpoint/packet');
    const allowed = { candidates: ['--offset', '--limit'], sweep: ['--offset', '--limit', '--revision'], evidence: ['--offset', '--limit', '--packet'], propose: ['--revision', '--reason'], show: ['--offset', '--limit'], decide: ['--revision', '--decisions'], list: ['--offset', '--limit'] };
    if (!Object.hasOwn(allowed, sub)) throw new Error('Unsupported universe causal operation');
    const flags = new Map();
    for (let index = 5 + count; index < tokens.length; index += 2) {
      if (!allowed[sub].includes(tokens[index]) || !tokens[index + 1] || flags.has(tokens[index])) throw new Error('Universe causal options require unique bounded values');
      flags.set(tokens[index], tokens[index + 1]);
    }
    for (const [name, value] of flags) {
      if (['--offset', '--limit'].includes(name) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (name === '--limit' ? 1 : 0) || Number(value) > (name === '--limit' ? 20 : 500))) throw new Error('Universe causal page exceeds its budget');
      if (name === '--packet' && !/^uc_[a-f0-9]{64}$/.test(value)) throw new Error('Invalid universe causal packet');
      if (name === '--revision' && !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid universe causal revision');
      if (name === '--reason' && (!value.trim() || value.length > 2000)) throw new Error('Causal reason exceeds its budget');
      if (name === '--decisions' && (Buffer.byteLength(value) > 64000 || !Array.isArray(JSON.parse(value)))) throw new Error('Causal decisions require a bounded JSON array');
    }
    if (['sweep', 'propose', 'decide'].includes(sub) && !flags.has('--revision') || sub === 'propose' && !flags.has('--reason') || sub === 'decide' && !flags.has('--decisions')) throw new Error('Universe causal mutation needs its current revision and explicit arguments');
    if (['candidates', 'sweep', 'evidence', 'show', 'list'].includes(sub) && !flags.has('--limit')) tokens.push('--limit', '10');
    return { kind: 'cli', args: tokens, label: `novel causality universe ${sub}` };
  }
  if (verb === 'causality') {
    const base = ['propose', 'evidence'].includes(operation) ? 5 : 3;
    const flags = new Map();
    for (let index = base; index < tokens.length; index += 2) {
      if (!tokens[index].startsWith('--') || !tokens[index + 1] || flags.has(tokens[index])) throw new Error('Causality options require unique values');
      flags.set(tokens[index], tokens[index + 1]);
    }
    const only = names => [...flags.keys()].every(name => names.includes(name));
    const number = (name, max, min = 0) => !flags.has(name) || /^\d+$/.test(flags.get(name)) && Number.isSafeInteger(Number(flags.get(name))) && Number(flags.get(name)) >= min && Number(flags.get(name)) <= max;
    const unit = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,255}$/.test(value);
    valid = tokens[2] === novel;
    if (operation === 'candidates') valid &&= only(['--unit', '--chapter', '--limit']) && (!flags.has('--unit') || unit(flags.get('--unit'))) && number('--chapter', Number.MAX_SAFE_INTEGER);
    else if (operation === 'sweep') valid &&= only(['--limit']);
    else if (operation === 'evidence') valid &&= unit(tokens[3]) && unit(tokens[4]) && only(['--changeset', '--offset', '--limit']) && number('--offset', Number.MAX_SAFE_INTEGER) && (!flags.has('--changeset') || changesetIds.includes(flags.get('--changeset')));
    else if (operation === 'propose') valid &&= unit(tokens[3]) && unit(tokens[4]) && only(['--reason']) && (!flags.has('--reason') || flags.get('--reason').trim().length > 0 && flags.get('--reason').length <= 2000);
    else valid = false;
    valid &&= number('--limit', 20, 1);
    if (!valid) throw new Error('Causality command outside the assigned bounded scope');
    if (['candidates', 'sweep', 'evidence'].includes(operation) && !flags.has('--limit')) tokens.push('--limit', '10');
    return { kind: 'cli', args: tokens, label: `novel causality ${operation}` };
  }
  if (verb === 'library') {
    const library = scope.library;
    if (!library || tokens[2] !== library.directory) throw new Error('Library path is not assigned');
    const sourceId = /^doc_[a-f0-9]{64}$/;
    const planId = /^plan_[a-f0-9]{64}$/;
    const revision = /^[a-f0-9]{64}$/;
    const base = ['evidence', 'plan', 'decide'].includes(operation) ? 4 : 3;
    const flags = new Map();
    for (let index = base; index < tokens.length; index += 2) {
      if (!tokens[index].startsWith('--') || !tokens[index + 1] || flags.has(tokens[index])) throw new Error('Library options require unique values');
      flags.set(tokens[index], tokens[index + 1]);
    }
    const only = names => [...flags.keys()].every(name => names.includes(name));
    const number = (name, maximum, minimum = 0) => !flags.has(name) || /^\d+$/.test(flags.get(name)) && Number.isSafeInteger(Number(flags.get(name))) && Number(flags.get(name)) >= minimum && Number(flags.get(name)) <= maximum;
    if (operation === 'show') valid = only(['--series', '--universe', '--continuity', '--offset', '--limit']) && ['--series', '--universe', '--continuity'].filter(name => flags.has(name)).length <= 1 && ['--series', '--universe', '--continuity'].every(name => !flags.has(name) || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(flags.get(name)));
    if (operation === 'plan') valid = planId.test(tokens[3] ?? '') && only(['--offset', '--limit']);
    if (operation === 'evidence') valid = sourceId.test(tokens[3] ?? '') && library.bindings.some(binding => binding.sourceId === tokens[3]) && only(['--offset', '--limit']) && number('--limit', 2000, 1);
    if (operation === 'propose') {
      valid = flags.size === 2 && only(['--organization', '--revision']) && revision.test(flags.get('--revision') ?? '') && Buffer.byteLength(flags.get('--organization') ?? '') <= 2 * 1024 * 1024;
      if (valid) { const value = JSON.parse(flags.get('--organization')); valid = !!value && typeof value === 'object' && !Array.isArray(value); }
    }
    if (operation === 'decide') valid = planId.test(tokens[3] ?? '') && flags.size === 3 && only(['--revision', '--decision', '--reason']) && revision.test(flags.get('--revision') ?? '') && ['approve', 'hold', 'reject'].includes(flags.get('--decision')) && !!flags.get('--reason')?.trim() && flags.get('--reason').length <= 2000;
    if (operation === 'history') valid = tokens.length === 3;
    valid &&= number('--offset', Number.MAX_SAFE_INTEGER);
    if (['show', 'plan'].includes(operation)) {
      valid &&= number('--limit', 20, 1);
      if (!flags.has('--offset')) tokens.push('--offset', '0');
      if (!flags.has('--limit')) tokens.push('--limit', '10');
    }
    if (!valid) throw new Error('Library command outside the assigned organization scope; registration, preparation and arbitrary files are unavailable');
    return { kind: 'cli', args: tokens, label: `novel library ${operation}` };
  }
  if (verb === 'help' || verb === 'config') valid = tokens.length === 1;
  if (verb === 'init') valid = tokens.length === 2 && operation === novel;
  if (verb === 'album') {
    valid = tokens[2] === novel && ((['list', 'portraits'].includes(operation) && tokens.length === 3)
      || operation === 'import' && tokens.length === 4 && scope.album?.importAllowed === true && tokens[3] === scope.album.epub);
  }
  if (verb === 'ingest') {
    const options = tokens.slice(3);
    valid = operation === novel && tokens[2] === input;
    const seen = new Set();
    for (let index = 0; index < options.length; index += 2) {
      const option = options[index];
      if (seen.has(option)) valid = false;
      seen.add(option);
      if (option === '--block-size') valid &&= options[index + 1] === '24000';
      else if (option === '--max-blocks') valid &&= /^\d+$/.test(options[index + 1] ?? '') && Number(options[index + 1]) >= 1 && Number(options[index + 1]) <= maxBlocks;
      else valid = false;
    }
  }
  if (verb === 'changeset') valid = tokens[2] === novel && (
    (operation === 'list' && tokens.length === 3) ||
    (['show', 'approve', 'hold'].includes(operation) && tokens.length === 4 && changesetIds.includes(tokens[3]))
  );
  if (verb === 'changeset' && operation === 'show' && tokens[2] === novel && changesetIds.includes(tokens[3])) {
    const options = tokens.slice(4);
    valid = options.length > 0;
    for (let index = 0; index < options.length; index++) {
      if (['--summary', '--notes'].includes(options[index])) continue;
      if (['--offset', '--limit'].includes(options[index]) && /^\d+$/.test(options[index + 1] ?? '')) { index++; continue; }
      valid = false;
    }
    const limitIndex = options.indexOf('--limit');
    if (limitIndex >= 0 && (Number(options[limitIndex + 1]) < 1 || Number(options[limitIndex + 1]) > 20)) valid = false;
  }
  if (verb === 'match') valid = tokens.length === 4 && operation === novel && tokens[2] === '--changeset' && blockIds.map((id) => `cs_${id}`).includes(tokens[3]);
  if (verb === 'changeset' && operation === 'revise') {
    const options = tokens.slice(4);
    valid = tokens[2] === novel && blockIds.map((id) => `cs_${id}`).includes(tokens[3]) && options.length === 4 && new Set([options[0], options[2]]).size === 2 && [options[0], options[2]].every((flag) => ['--edits', '--reason'].includes(flag)) && !!options[1] && !!options[3];
  }
  if (verb === 'changeset' && operation === 'facts') {
    valid = tokens[2] === novel && blockIds.map(id => `cs_${id}`).includes(tokens[3]);
    const options = tokens.slice(4);
    const seen = new Set();
    for (let index = 0; index < options.length; index++) {
      const option = options[index];
      if (seen.has(option)) valid = false;
      seen.add(option);
      if (option === '--summary') continue;
      if (['--offset', '--limit'].includes(option) && /^\d+$/.test(options[index + 1] ?? '')) { if (option === '--limit' && (Number(options[index + 1]) < 1 || Number(options[index + 1]) > 30)) valid = false; index++; continue; }
      if (option === '--fact' && options[index + 1]) { index++; continue; }
      valid = false;
    }
  }
  if (verb === 'changeset' && operation === 'decide') {
    const options = tokens.slice(4);
    const values = new Map();
    for (let index = 0; index < options.length; index += 2) values.set(options[index], options[index + 1]);
    valid = tokens[2] === novel && blockIds.map(id => `cs_${id}`).includes(tokens[3]) && options.length === 4 && values.size === 2 && /^[a-f0-9]{64}$/.test(values.get('--revision') ?? '') && !!values.get('--decisions');
  }
  if (verb === 'fix') {
    const operations = new Set(['merge', 'rename', 'add-form', 'relate', 'unrelate', 'remove-entity', 'remove-event']);
    valid = operations.has(operation) && tokens[2] === novel && tokens.includes('--reason') && tokens.length <= 12;
    const options = tokens.slice(3).filter((token) => token.startsWith('--'));
    valid &&= options.every((token) => ['--reason', '--kind'].includes(token));
    if (operation === 'relate' && tokens.some(token => ['CAUSES', 'CAUSED_BY'].includes(token.toUpperCase()))) valid = false;
    if (operation === 'corrections') valid = tokens.length === 3 && tokens[2] === novel;
    if (operation === 'correct') {
      const flags = tokens.slice(3);
      const values = new Map();
      for (let index = 0; index < flags.length; index += 2) {
        if (!['--block', '--key', '--value', '--reason'].includes(flags[index]) || values.has(flags[index]) || !flags[index + 1]) throw new Error('Correction requires unique --block, --key, --value, and --reason options');
        values.set(flags[index], flags[index + 1]);
      }
      valid = tokens[2] === novel && flags.length === 8 && values.size === 4 && ['--block', '--key', '--value', '--reason'].every((key) => values.has(key)) && blockIds.includes(values.get('--block'));
    }
  }
  if (verb === 'recall') valid = operation === novel && tokens.length === 3 && blockIds.includes(tokens[2]);
  if (verb === 'graph') valid = operation === 'build' && tokens.length === 3 && tokens[2] === `${novel}/ontology`;
  if (verb === 'query') valid = operation === novel && tokens.length === 3 && /^\s*MATCH\b/i.test(tokens[2]) && !/\b(CREATE|MERGE|SET|DELETE|DROP|ALTER|COPY|LOAD|INSTALL|ATTACH|CALL|REMOVE)\b|;/i.test(tokens[2]);
  if (verb === 'search') valid = operation === novel && tokens.length === 3;
  if (verb === 'inspect') valid = operation === novel && tokens.length === 2;
  if (verb === 'timeline') valid = operation === 'list' && tokens.length === 3 && tokens[2] === novel;
  if (!valid) throw new Error('Command outside this block/workspace CLI allowlist; no shell, direct file writes, credential access, or auto-approve');
  return { kind: 'cli', args: tokens, label: `novel ${verb}${['album', 'changeset', 'fix', 'graph', 'timeline'].includes(verb) ? ` ${operation}` : ''}` };
}
