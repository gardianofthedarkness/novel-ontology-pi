// A character's mind as departments running at once (docs/v3/design.html §10.2; the user, 2026-11-19: "a real person has
// multiple departments running simultaneously ... a brain stem that decides which surface for action and which ones sink
// till next turn"). Nothing here is about any one book or character.
//
// Each turn (a message came, or time passed) every department reads the same snapshot and runs in parallel:
//   memory        recalls what this brings back (the time/importance-weighted Cypher recall, §10.1)    -> recall urges
//   emotion       how it lands (Jev: valence and arousal, each one of a few ordered words); the mood carries over and fades          -> express urges
//   subjectivity  how they take it and what they want to do about it (Jev: a stance, does it matter)  -> speak urges
//   action        what the body does (Jev: a movement from a fixed set)                              -> move urges
// The brain stem (one Jev call) takes every urge, this turn's and the ones that sank before, and lets through at most
// one speech and one movement, and the recalls and feelings that go with them. The rest sink: they wait for the next
// turn, weaker each time, and fade out. Only a surfaced speech costs a text call (the speaker).
// Departments see each other only through what the last turn left (on their mind, the mood), as in a body, not this turn's.

export const MIND_DEFAULTS = { sink: 0.7, fadeBelow: 0.15, moodKeep: 0.6, recallK: 6, history: 8 };
export const STANCES = ['answer', 'ask back', 'tease', 'comfort', 'refuse', 'change the subject', 'say nothing'];
export const MOVES = ['stay as they are', 'look closely at the phone', 'look around', 'put the phone away', 'walk off'];
const VALENCE = ['very bad', 'bad', 'a little bad', 'neutral', 'a little good', 'good', 'very good'];
const AROUSAL = ['calm', 'slightly stirred', 'stirred', 'very stirred', 'overwhelmed'];
const SILENT = 'stay silent', STILL = 'stay still';

const clip = (x) => Math.max(0, Math.min(1, x));
const levelOf = (labels, answer) => { const i = labels.indexOf(String(answer)); return i < 0 ? null : i; };

/**
 * self: { id, name, about }  (who they are, a few lines, from their memories)
 * models: { decide(state, questions) -> answers (Jev), speak({ system, prompt }) -> text (the speaker),
 *           recall({ cues, mood, turn }) -> [{ id, summary, score }], cuesOf(text) -> entity ids }
 */
export function createMind(self, models, options = {}) {
  const o = { ...MIND_DEFAULTS, ...options };
  const state = { turn: 0, mood: { valence: 0, arousal: 0 }, onMind: [], urges: [], history: [] };

  const snapshot = (input) => ({
    who: `${self.name}. ${self.about}`,
    situation: 'They hold a phone that reaches a parallel universe; strangers from there can message them.',
    mood: `${VALENCE[Math.round((state.mood.valence + 1) * 3)]}, ${AROUSAL[Math.round(state.mood.arousal * 4)]}`,
    onTheirMind: state.onMind.map((m) => m.summary),
    conversation: state.history.slice(-o.history).map((h) => `${h.from}: ${h.text}`),
    now: input ? `A message from ${input.from}: ${input.text}` : 'No new message; time passes.',
  });

  const departments = {
    async memory(view, input) {
      const rows = await models.recall({ cues: input ? models.cuesOf(input.text) : [], mood: state.mood.valence, turn: state.turn });
      const top = Math.max(1e-9, ...rows.map((r) => r.score));
      return rows.slice(0, o.recallK).map((r) => ({ dept: 'memory', kind: 'recall', content: r.summary, memoryId: r.id, salience: clip(r.score / top) * 0.8 }));
    },
    async emotion(view) {
      const [v, a] = await models.decide(view, [
        // Choices on an ordered set: the answer is the label (score answers are numbers no caller here has checked yet).
        { key: 'emotion.valence', primitive: 'choice', instructions: `How does what is happening now feel to ${self.name}?`, options: VALENCE },
        { key: 'emotion.arousal', primitive: 'choice', instructions: `How stirred is ${self.name} by it?`, options: AROUSAL },
      ]);
      const valence = ((levelOf(VALENCE, v?.value) ?? 3) - 3) / 3, arousal = (levelOf(AROUSAL, a?.value) ?? 0) / 4;
      state.mood = { valence: o.moodKeep * state.mood.valence + (1 - o.moodKeep) * valence, arousal: Math.max(arousal, o.moodKeep * state.mood.arousal) };
      return arousal > 0 ? [{ dept: 'emotion', kind: 'express', content: `${VALENCE[Math.round((valence + 1) * 3)]}, ${AROUSAL[Math.round(arousal * 4)]}`, salience: arousal }] : [];
    },
    async subjectivity(view, input) {
      const [stance, matters] = await models.decide(view, [
        { key: 'subject.stance', primitive: 'choice', instructions: `As ${self.name} takes this, what do they want to do about it?`, options: STANCES },
        { key: 'subject.matters', primitive: 'noul', instructions: `Does this touch something ${self.name} cares about?`, noulCriteria: { true: 'it touches their people, goals or fears', false: 'it is idle or about strangers' } },
      ]);
      if (!stance || stance.value === 'say nothing') return [];
      return [{ dept: 'subjectivity', kind: 'speak', content: String(stance.value), salience: clip((input ? 0.5 : 0.1) + 0.5 * Number(matters?.value ?? 0)) }];
    },
    async action(view) {
      const [move] = await models.decide(view, [{ key: 'action.move', primitive: 'choice', instructions: `What does ${self.name}'s body do now?`, options: MOVES }]);
      return !move || move.value === MOVES[0] ? [] : [{ dept: 'action', kind: 'move', content: String(move.value), salience: clip(Number(move.confidence ?? 0.5)) }];
    },
  };

  /** The brain stem: one speech and one movement at most; recalls and feelings surface with them or sink. */
  async function stem(view, urges) {
    const label = (u) => `${u.content} (${u.dept}${u.age ? `, waiting ${u.age} turn${u.age > 1 ? 's' : ''}` : ''})`;
    const speeches = urges.filter((u) => u.kind === 'speak'), moves = urges.filter((u) => u.kind === 'move');
    const others = urges.filter((u) => u.kind !== 'speak' && u.kind !== 'move');
    const questions = [];
    if (speeches.length) questions.push({ key: 'stem.speak', primitive: 'choice', instructions: `Which urge to speak does ${self.name} act on now, if any?`, options: [...new Set([...speeches.map(label), SILENT])] });
    if (moves.length) questions.push({ key: 'stem.move', primitive: 'choice', instructions: `Which movement does ${self.name} make now, if any?`, options: [...new Set([...moves.map(label), STILL])] });
    others.forEach((u, i) => questions.push({ key: `stem.${i}`, primitive: 'noul', instructions: `Does this come out now, in what ${self.name} says or shows: ${label(u)}?`, noulCriteria: { true: 'it is strong enough and fits the moment', false: 'it stays inside for now' } }));
    const urgeList = urges.map((u) => `${label(u)}, strength ${u.salience.toFixed(2)}`);
    const answers = questions.length ? await models.decide({ ...view, urges: urgeList }, questions) : [];
    const answer = (k) => answers.find((a) => a.key === k);
    const surfaced = new Set();
    const speakAns = answer('stem.speak')?.value, moveAns = answer('stem.move')?.value;
    const speech = speeches.find((u) => label(u) === speakAns), move = moves.find((u) => label(u) === moveAns);
    if (speech) surfaced.add(speech); if (move) surfaced.add(move);
    others.forEach((u, i) => { if (Number(answer(`stem.${i}`)?.value ?? 0) >= 0.5) surfaced.add(u); });
    return surfaced;
  }

  async function speakOut(speech, surfaced, input) {
    const recalls = [...surfaced].filter((u) => u.kind === 'recall').map((u) => `- ${u.content}`);
    const feeling = [...surfaced].find((u) => u.kind === 'express');
    const system = [
      `You are ${self.name}. ${self.about}`,
      'You found a phone that reaches a parallel universe; the person writing to you is from there. You know only your own life.',
      'Reply as yourself, in the language of the message, in one to three short lines, as in a chat. No narration, no stage directions.',
    ].join(' ');
    const prompt = [
      `What you want to do: ${speech.content}.`,
      feeling ? `What shows in how you say it: ${feeling.content}.` : 'Your feelings stay hidden.',
      recalls.length ? `What comes to mind and you may bring up:\n${recalls.join('\n')}` : '',
      `Conversation so far:\n${state.history.slice(-o.history).map((h) => `${h.from}: ${h.text}`).join('\n') || '(none)'}`,
      input ? `${input.from}: ${input.text}` : '(No new message. You write first.)',
      `${self.name}:`,
    ].filter(Boolean).join('\n\n');
    return String(await models.speak({ system, prompt })).trim();
  }

  /** One turn. input: { from, text } or null (time passes). Returns what surfaced, what sank, and what was said and done. */
  async function turn(input = null) {
    state.turn++;
    if (input) state.history.push(input);
    const view = snapshot(input);
    const fresh = (await Promise.all(Object.values(departments).map((d) => d(view, input)))).flat();
    const urges = [...state.urges, ...fresh];
    const surfaced = await stem(view, urges);
    const speech = [...surfaced].find((u) => u.kind === 'speak'), move = [...surfaced].find((u) => u.kind === 'move');
    const said = speech ? await speakOut(speech, surfaced, input) : null;
    if (said) state.history.push({ from: self.name, text: said });
    state.onMind = fresh.filter((u) => u.kind === 'recall').slice(0, 3).map((u) => ({ summary: u.content, id: u.memoryId }));
    // What did not surface sinks: weaker each turn, gone below the threshold. A recall or feeling that surfaced is spent.
    state.urges = urges.filter((u) => !surfaced.has(u)).map((u) => ({ ...u, salience: u.salience * o.sink, age: (u.age ?? 0) + 1 })).filter((u) => u.salience >= o.fadeBelow);
    return { turn: state.turn, said, moved: move?.content ?? null, surfaced: [...surfaced], sank: state.urges, mood: { ...state.mood } };
  }

  return { turn, state };
}
