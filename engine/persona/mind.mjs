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
// turn, weaker each time, and fade out. Departments see each other only through what the last turn left (on their
// mind, the mood), as in a body, not this turn's.
// Every faculty sees the person's two cards (cards.mjs): who they are, and where they are now.
// A surfaced speech is not a reply written at once: the action faculty acts with tools (the user, 2026-11-19: "give a
// action tool for action faculty to send reply to the phone ... collect what's happening now first"): look (where they
// are and what the phone shows), recall (ask their memory about something), send (the only way words reach the phone,
// refused until they have looked this turn), put away (end without a word). A few steps a turn, the work model.

export const MIND_DEFAULTS = { sink: 0.7, fadeBelow: 0.15, moodKeep: 0.6, recallK: 6, history: 8, actSteps: 4, inMind: 4 };
export const STANCES = ['answer', 'ask back', 'tease', 'comfort', 'refuse', 'change the subject', 'say nothing'];
export const MOVES = ['stay as they are', 'look closely at the phone', 'look around', 'put the phone away', 'walk off'];
const VALENCE = ['very bad', 'bad', 'a little bad', 'neutral', 'a little good', 'good', 'very good'];
const AROUSAL = ['calm', 'slightly stirred', 'stirred', 'very stirred', 'overwhelmed'];
const SILENT = 'stay silent', STILL = 'stay still';

const clip = (x) => Math.max(0, Math.min(1, x));
const levelOf = (labels, answer) => { const i = labels.indexOf(String(answer)); return i < 0 ? null : i; };

/**
 * self: { id, name, card, present }  (the character card and the present card as text, cards.mjs)
 * models: { decide(state, questions) -> answers (Jev), act({ system, prompt }) -> JSON text (one tool call, the work model),
 *           recall({ cues, mood, turn }) -> [{ id, summary, score, ...parts }], cuesOf(text) -> entity ids, nameOf(id)? }
 */
export function createMind(self, models, options = {}) {
  const o = { ...MIND_DEFAULTS, ...options };
  const state = { turn: 0, mood: { valence: 0, arousal: 0 }, onMind: [], urges: [], history: [], seen: 0 };
  const PHONE = 'They hold a phone that reaches a parallel universe; strangers from there can message them.';

  const snapshot = (input) => ({
    who: self.card,
    now: self.present,
    situation: PHONE,
    mood: `${VALENCE[Math.round((state.mood.valence + 1) * 3)]}, ${AROUSAL[Math.round(state.mood.arousal * 4)]}`,
    onTheirMind: state.onMind.map((m) => m.summary),
    conversation: state.history.slice(-o.history).map((h) => `${h.from}: ${h.text}`),
    happening: input ? `A message on the phone from ${input.from}: ${input.text}` : 'No new message; time passes.',
  });

  const departments = {
    async memory(view, input, ask, trace) {
      const cues = input ? models.cuesOf(input.text) : [];
      const rows = await models.recall({ cues, mood: state.mood.valence, turn: state.turn });
      trace.cues = cues.map((id) => ({ id, name: models.nameOf?.(id) ?? id }));
      trace.recalled = rows;
      const top = Math.max(1e-9, ...rows.map((r) => r.score));
      return rows.slice(0, o.recallK).map((r) => ({ dept: 'memory', kind: 'recall', content: r.summary, memoryId: r.id, salience: clip(r.score / top) * 0.8 }));
    },
    async emotion(view, input, ask) {
      const [v, a] = await ask(view, [
        // Choices on an ordered set: the answer is the label (score answers are numbers no caller here has checked yet).
        { key: 'emotion.valence', primitive: 'choice', instructions: `How does what is happening now feel to ${self.name}?`, options: VALENCE },
        { key: 'emotion.arousal', primitive: 'choice', instructions: `How stirred is ${self.name} by it?`, options: AROUSAL },
      ]);
      const valence = ((levelOf(VALENCE, v?.value) ?? 3) - 3) / 3, arousal = (levelOf(AROUSAL, a?.value) ?? 0) / 4;
      state.mood = { valence: o.moodKeep * state.mood.valence + (1 - o.moodKeep) * valence, arousal: Math.max(arousal, o.moodKeep * state.mood.arousal) };
      return arousal > 0 ? [{ dept: 'emotion', kind: 'express', content: `${VALENCE[Math.round((valence + 1) * 3)]}, ${AROUSAL[Math.round(arousal * 4)]}`, salience: arousal }] : [];
    },
    async subjectivity(view, input, ask) {
      const [stance, matters] = await ask(view, [
        { key: 'subject.stance', primitive: 'choice', instructions: `As ${self.name} takes this, what do they want to do about it?`, options: STANCES },
        { key: 'subject.matters', primitive: 'noul', instructions: `Does this touch something ${self.name} cares about?`, noulCriteria: { true: 'it touches their people, goals or fears', false: 'it is idle or about strangers' } },
      ]);
      if (!stance || stance.value === 'say nothing') return [];
      return [{ dept: 'subjectivity', kind: 'speak', content: String(stance.value), salience: clip((input ? 0.5 : 0.1) + 0.5 * Number(matters?.value ?? 0)) }];
    },
    async action(view, input, ask) {
      const [move] = await ask(view, [{ key: 'action.move', primitive: 'choice', instructions: `What does ${self.name}'s body do now?`, options: MOVES }]);
      return !move || move.value === MOVES[0] ? [] : [{ dept: 'action', kind: 'move', content: String(move.value), salience: clip(Number(move.confidence ?? 0.5)) }];
    },
  };

  /** The brain stem: one speech and one movement at most; recalls and feelings surface with them or sink. */
  async function stem(view, urges, ask, trace) {
    const label = (u) => `${u.content} (${u.dept}${u.age ? `, waiting ${u.age} turn${u.age > 1 ? 's' : ''}` : ''})`;
    const speeches = urges.filter((u) => u.kind === 'speak'), moves = urges.filter((u) => u.kind === 'move');
    const others = urges.filter((u) => u.kind !== 'speak' && u.kind !== 'move');
    const questions = [];
    if (speeches.length) questions.push({ key: 'stem.speak', primitive: 'choice', instructions: `Which urge to speak does ${self.name} act on now, if any?`, options: [...new Set([...speeches.map(label), SILENT])] });
    if (moves.length) questions.push({ key: 'stem.move', primitive: 'choice', instructions: `Which movement does ${self.name} make now, if any?`, options: [...new Set([...moves.map(label), STILL])] });
    others.forEach((u, i) => questions.push({ key: `stem.${i}`, primitive: 'noul', instructions: `Does this come out now, in what ${self.name} says or shows: ${label(u)}?`, noulCriteria: { true: 'it is strong enough and fits the moment', false: 'it stays inside for now' } }));
    const urgeList = urges.map((u) => `${label(u)}, strength ${u.salience.toFixed(2)}`);
    trace.urges = urges.map((u) => ({ kind: u.kind, dept: u.dept, content: u.content, salience: u.salience, waiting: u.age ?? 0 }));
    const answers = questions.length ? await ask({ ...view, urges: urgeList }, questions) : [];
    const answer = (k) => answers.find((a) => a.key === k);
    const surfaced = new Set();
    const speakAns = answer('stem.speak')?.value, moveAns = answer('stem.move')?.value;
    const speech = speeches.find((u) => label(u) === speakAns), move = moves.find((u) => label(u) === moveAns);
    if (speech) surfaced.add(speech); if (move) surfaced.add(move);
    others.forEach((u, i) => { if (Number(answer(`stem.${i}`)?.value ?? 0) >= 0.5) surfaced.add(u); });
    trace.surfaced = urges.map((u) => surfaced.has(u));
    return surfaced;
  }

  const TOOLS = {
    look: 'look: where you are, who is around, and what the phone shows. Args: {}',
    recall: 'recall: ask your memory about someone or something. Args: {"about": "a name or a few words"}',
    send: 'send: write on the phone. The only way the stranger hears from you; you must have looked this turn. Args: {"text": "..."}',
    put_away: 'put_away: end without writing (you can come back to it later). Args: {}',
  };
  /** The action faculty: a few tool steps; it must look before it sends. Returns what was sent, or null. */
  async function act(intent, surfaced, recalled, input, trace) {
    const bring = [...surfaced].filter((u) => u.kind === 'recall').map((u) => u.content);
    const feeling = [...surfaced].find((u) => u.kind === 'express');
    const inMind = recalled.filter((r) => !bring.includes(r.summary)).slice(0, o.inMind).map((r) => r.summary);
    const system = [
      `You are ${self.name}. Act as yourself from this moment, in your own voice.`,
      `Who you are:\n${self.card}`,
      `Where you are now:\n${self.present}`,
      'You hold a phone that reaches a parallel universe; a stranger from there may be writing to you. You know only your own life and world.',
      `Each step, call one tool. Answer as JSON only: {"thought": "a few words", "tool": "look|recall|send|put_away", "args": {}}.\nTools:\n${Object.values(TOOLS).join('\n')}`,
      'A message on the phone is short, one to three lines, as in a chat; no narration or stage directions. Write it in the language the stranger wrote in.',
    ].join('\n\n');
    const steps = [];
    let looked = false, sent = null;
    for (let n = 0; n < o.actSteps && sent === null; n++) {
      const prompt = [
        `What you want to do: ${intent}.`,
        feeling ? `What shows in how you act: ${feeling.content}.` : 'Your feelings stay hidden.',
        bring.length ? `What comes to mind and you want to bring up:\n${bring.map((s) => `- ${s}`).join('\n')}` : '',
        inMind.length ? `Also in your mind (you need not mention it):\n${inMind.map((s) => `- ${s}`).join('\n')}` : '',
        input ? 'Something just came on the phone.' : 'Nothing new came on the phone; time has passed.',
        steps.length ? `Your steps so far this turn:\n${steps.map((s) => `${s.tool}(${JSON.stringify(s.args)}) -> ${s.result}`).join('\n')}` : 'No steps yet this turn.',
        'Your next step:',
      ].filter(Boolean).join('\n\n');
      const t = Date.now();
      let call;
      try { call = JSON.parse(String(await models.act({ system, prompt }))); } catch { call = { tool: 'put_away', args: {}, thought: '(an answer that was not a tool call)' }; }
      const tool = String(call.tool ?? ''), args = call.args ?? {};
      let result;
      if (tool === 'look') {
        const fresh = state.history.slice(state.seen).some((h) => h.from !== self.name);
        state.seen = state.history.length; looked = true;
        result = `${self.present}\nOn the phone (last messages):\n${state.history.slice(-o.history).map((h) => `${h.from}: ${h.text}`).join('\n') || '(nothing yet)'}${fresh ? '' : '\n(nothing new)'}`;
      } else if (tool === 'recall') {
        const rows = await models.recall({ cues: models.cuesOf(String(args.about ?? '')), mood: state.mood.valence, turn: state.turn });
        result = rows.slice(0, 5).map((r) => `- ${r.summary}`).join('\n') || '(nothing comes back)';
      } else if (tool === 'send') {
        const text = String(args.text ?? '').trim();
        if (!looked) result = 'Refused: look first, to see where you are and what the phone shows.';
        else if (!text) result = 'Refused: nothing to send.';
        else { sent = text; result = 'sent'; }
      } else if (tool === 'put_away') result = 'You put the phone away.';
      else result = `No tool ${tool}.`;
      steps.push({ tool, args, thought: call.thought, result, ms: Date.now() - t });
      if (tool === 'put_away') break;
    }
    Object.assign(trace, { system, steps, sent });
    return sent;
  }

  /** One turn. input: { from, text } or null (time passes). Returns what surfaced, what sank, and what was said and done. */
  async function turn(input = null) {
    state.turn++;
    if (input) state.history.push(input);
    const view = snapshot(input);
    // The trace: every department's questions and answers, what it proposed and how long it took; the stem's choices.
    const trace = { view, departments: {}, stem: { calls: [] }, action: null };
    const asker = (record) => async (s, questions) => {
      const t = Date.now(), answers = await models.decide(s, questions);
      record.calls.push({ ms: Date.now() - t, asked: questions.map(({ key, primitive, instructions, options }) => ({ key, primitive, instructions, options })),
        answers: answers.map(({ key, value, confidence, distribution }) => ({ key, value, confidence, distribution })) });
      return answers;
    };
    const fresh = (await Promise.all(Object.entries(departments).map(async ([name, d]) => {
      const record = (trace.departments[name] = { calls: [] }), t = Date.now();
      const urges = await d(view, input, asker(record), record);
      Object.assign(record, { ms: Date.now() - t, urges: urges.map(({ kind, content, salience }) => ({ kind, content, salience })) });
      return urges;
    }))).flat();
    const urges = [...state.urges, ...fresh];
    const t = Date.now(), surfaced = await stem(view, urges, asker(trace.stem), trace.stem);
    trace.stem.ms = Date.now() - t;
    const speech = [...surfaced].find((u) => u.kind === 'speak'), move = [...surfaced].find((u) => u.kind === 'move');
    const recalled = trace.departments.memory?.recalled ?? [];
    const said = speech ? await act(speech.content, surfaced, recalled, input, (trace.action = {})) : null;
    if (said) state.history.push({ from: self.name, text: said });
    state.onMind = fresh.filter((u) => u.kind === 'recall').slice(0, 3).map((u) => ({ summary: u.content, id: u.memoryId }));
    // What did not surface sinks: weaker each turn, gone below the threshold. A recall or feeling that surfaced is spent.
    state.urges = urges.filter((u) => !surfaced.has(u)).map((u) => ({ ...u, salience: u.salience * o.sink, age: (u.age ?? 0) + 1 })).filter((u) => u.salience >= o.fadeBelow);
    return { turn: state.turn, said, moved: move?.content ?? null, surfaced: [...surfaced], sank: state.urges, mood: { ...state.mood }, trace };
  }

  return { turn, state };
}
