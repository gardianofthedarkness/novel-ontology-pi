// Who says a line, by how they talk (the user, 2026-11-05: "the user knows themselves who said that because they know the
// style how that person speaks"). The reading is sure of the speaker of most lines; those lines teach each person's voice,
// and the voice scores a line the reading was unsure of, among the people there. Three scorers and a decoder:
//
//   voice     each person's character n-grams (how they call themselves and others, how they end a sentence, their pet
//             words) as log-odds against everyone's: a naive Bayes over the quoted words only;
//   lookup    the lines most like this one (local sentence embeddings), each voting for its speaker;
//   exchange  a dialogue's lines decoded together (Viterbi): each line's scores, the speakers known clamped, turns that
//             change hands (the same person rarely says two lines running), and whom a line is said to (not its speaker).
//
// Pure: lines, vectors and scores in; scores and picks out. experiments/v2/voices-eval.mjs measures them.

/** The words said: what stands inside the quotation marks (all of them), else the line itself. */
export function quoteOf(text) {
  const parts = [...String(text ?? '').matchAll(/[“「『"]([^”」』"]*)[”」』"]/g)].map(match => match[1]).filter(Boolean);
  return parts.length ? parts.join('｜') : String(text ?? '');
}

/** Character n-grams (1–3) of a quote, with its start and end marked (how a line opens and how it ends say most). */
export function gramsOf(quote, most = 3) {
  const text = `^${quote.replace(/\s+/g, '')}$`, out = [];
  for (let n = 1; n <= most; n++) for (let i = 0; i + n <= text.length; i++) { const gram = text.slice(i, i + n); if (gram !== '^' && gram !== '$') out.push(gram); }
  return out;
}

/** Each speaker's voice from lines whose speaker is known: n-gram counts against everyone's. */
export function trainVoices(lines) {
  const by = new Map(), all = new Map();
  let total = 0;
  for (const { who, quote } of lines) {
    const own = by.get(who) ?? by.set(who, { counts: new Map(), total: 0, lines: 0 }).get(who);
    own.lines++;
    for (const gram of new Set(gramsOf(quote))) { own.counts.set(gram, (own.counts.get(gram) ?? 0) + 1); own.total++; all.set(gram, (all.get(gram) ?? 0) + 1); total++; }
  }
  return { by, all, total, vocabulary: all.size };
}

/**
 * A quote's voice score for each candidate: the summed log-odds of its n-grams in their lines against everyone's, per gram.
 * Each voice is mixed with everyone's (`lambda` of their own), so a gram they never said costs little and one they say
 * often gains: someone with no known lines scores 0, as everyone does.
 */
export function voiceScores(voices, quote, candidates, { lambda = 0.3 } = {}) {
  const grams = [...new Set(gramsOf(quote))].filter(gram => voices.all.has(gram)), out = {};
  for (const who of candidates) {
    const own = voices.by.get(who);
    if (!own || !grams.length) { out[who] = 0; continue; }
    let sum = 0;
    for (const gram of grams) {
      const q = voices.all.get(gram) / voices.total, p = lambda * (own.counts.get(gram) ?? 0) / own.total + (1 - lambda) * q;
      sum += Math.log(p / q);
    }
    out[who] = sum / Math.sqrt(grams.length);
  }
  return out;
}

/** How often each candidate speaks among the known lines, as a log-probability (a prior, add-one). */
export function priorScores(voices, candidates) {
  const counts = candidates.map(who => (voices.by.get(who)?.lines ?? 0) + 1), total = counts.reduce((sum, n) => sum + n, 0);
  return Object.fromEntries(candidates.map((who, k) => [who, Math.log(counts[k] / total)]));
}

const dot = (a, b) => { let sum = 0; for (let k = 0; k < a.length; k++) sum += a[k] * b[k]; return sum; };
/** The lookup's score for each candidate: the known lines most like this one (cosine, unit vectors), each voting for its speaker. */
export function lookupScores(index, vector, candidates, { k = 12, tau = 0.05 } = {}) {
  const wanted = new Set(candidates), near = [];
  for (const entry of index) if (wanted.has(entry.who)) near.push({ who: entry.who, sim: dot(entry.vector, vector) });
  near.sort((a, b) => b.sim - a.sim);
  const out = Object.fromEntries(candidates.map(who => [who, 0]));
  for (const { who, sim } of near.slice(0, k)) out[who] += Math.exp((sim - 1) / tau);
  return Object.fromEntries(Object.entries(out).map(([who, value]) => [who, Math.log(value + 1e-6)]));
}

/** Scores as log-probabilities over the candidates (a softmax at temperature `t`). */
export function normalised(scores, t = 1) {
  const entries = Object.entries(scores);
  if (!entries.length) return {};
  const top = Math.max(...entries.map(([, value]) => value / t)), sum = entries.reduce((total, [, value]) => total + Math.exp(value / t - top), 0);
  return Object.fromEntries(entries.map(([who, value]) => [who, value / t - top - Math.log(sum)]));
}

/** Several scorers' log-probabilities weighed together (missing ones count nothing). */
export function combined(parts) {
  const out = {};
  for (const { scores, weight = 1 } of parts) for (const [who, value] of Object.entries(scores ?? {})) out[who] = (out[who] ?? 0) + weight * value;
  return out;
}

/** The best of a candidate score table, with its margin over the next. */
export function pick(scores) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked.length ? { who: ranked[0][0], margin: ranked.length > 1 ? ranked[0][1] - ranked[1][1] : Infinity } : { who: null, margin: 0 };
}

/**
 * A dialogue decoded together (Viterbi). `lines`: in order, each `{ scores: { who: logp }, known?: who, to?: who }`;
 * a known line is clamped to its speaker; `stay` the log-probability of the same person saying the next line too (else the
 * turn passes, evenly); a line said to someone is not theirs (`addressed`), and the next one leans to them (`answer`).
 * Returns each line's speaker.
 */
export function decodeExchange(lines, { stay = Math.log(0.2), addressed = Math.log(0.05), answer = Math.log(2) } = {}) {
  if (!lines.length) return [];
  const states = [...new Set(lines.flatMap(line => [...Object.keys(line.scores), ...(line.known ? [line.known] : [])]))];
  const emit = (line, who, previous) => {
    if (line.known) return who === line.known ? 0 : -Infinity;
    let value = line.scores[who] ?? -20;
    if (line.to && line.to === who) value += addressed;
    if (previous?.to && previous.to === who) value += answer;
    return value;
  };
  const move = (from, to) => (from === to ? stay : Math.log((1 - Math.exp(stay)) / Math.max(1, states.length - 1)));
  let best = states.map(who => emit(lines[0], who, null));
  const back = [];
  for (let n = 1; n < lines.length; n++) {
    const next = [], from = [];
    for (const [j, who] of states.entries()) {
      let top = -Infinity, arg = 0;
      for (const [i, before] of states.entries()) { const value = best[i] + move(before, who); if (value > top) { top = value; arg = i; } }
      next.push(top + emit(lines[n], who, lines[n - 1])); from.push(arg);
    }
    best = next; back.push(from);
  }
  let at = best.indexOf(Math.max(...best));
  const out = [states[at]];
  for (let n = back.length - 1; n >= 0; n--) { at = back[n][at]; out.unshift(states[at]); }
  return out;
}

/**
 * Every line's speaker decoded, the known ones clamped. `lines` in reading order: `{ id, quote, who (known) or null, to,
 * exchange, candidates }`; `vectorOf(id)` a unit vector; `w` the weights (voices-eval.mjs tunes them: tv, tl, wv, wp, k,
 * stay, recency); `window` 1 (each conversation alone) or 3 (with the one before and after, each line its own
 * candidates); `recency` gives those who spoke in the two neighbouring conversations a lift. Returns id → { who, margin,
 * candidates } for the lines not known (margin: the line's own scores' lead, before decoding).
 */
export function decodeLines({ lines, vectorOf, w, window = 1, recency = false }) {
  const known = lines.filter(line => line.who), voices = trainVoices(known), index = known.map(line => ({ who: line.who, vector: vectorOf(line.id) }));
  const groups = [], at = new Map();
  for (const line of lines) { if (!at.has(line.exchange)) { at.set(line.exchange, groups.length); groups.push([]); } groups[at.get(line.exchange)].push(line); }
  const everyone = [...voices.by.keys()];
  const scored = groups.map(group => group.map(line => {
    const candidates = line.candidates.length ? line.candidates : everyone;
    const voice = normalised(voiceScores(voices, line.quote, candidates), w.tv), lookup = normalised(lookupScores(index, vectorOf(line.id), candidates, { k: w.k }), w.tl);
    return { line, candidates, both: combined([{ scores: voice, weight: w.wv }, { scores: lookup, weight: 1 }, { scores: priorScores(voices, candidates), weight: w.wp }]) };
  }));
  const decode = (rows, bonus = null) => decodeExchange(rows.map(({ line, both }) => ({ scores: normalised(bonus ? combined([{ scores: both }, { scores: Object.fromEntries(Object.keys(both).map(who => [who, bonus.has(who) ? w.recency : 0])) }]) : both), known: line.who ?? undefined, to: line.to })), { stay: Math.log(w.stay) });
  const out = new Map();
  scored.forEach((rows, g) => {
    const before = window === 3 || recency ? scored[g - 1] ?? [] : [], after = window === 3 || recency ? scored[g + 1] ?? [] : [];
    const picks = window === 3 ? decode([...before, ...rows, ...after]).slice(before.length, before.length + rows.length) : decode(rows, recency ? new Set([...before, ...after].map(row => row.line.who).filter(Boolean)) : null);
    rows.forEach(({ line, candidates, both }, n) => { if (!line.who) out.set(line.id, { who: picks[n], margin: Math.round(pick(both).margin * 100) / 100, candidates }); });
  });
  return out;
}
