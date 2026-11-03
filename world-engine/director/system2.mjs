// System 2 (docs/v2/world-ontology.md §5, Track B W3; the user, 2026-11-02): the same context falls to an LLM request when
// confidence is low. Jev answers first; every question it answers below 0.5 goes to the work model with the very same
// composed state and the same question, and the work model's answer is the one used (Jev's stays when the work model
// gives none). Both are recorded. The work model reads text only: the pictures Jev saw are named in the state but not
// sent, and every option the director asks is said in words (an arrow by what it points at, a spot by what it is), so
// only drawing a box stays Jev's. Whichever answer is used goes to the law engine next (W2 logs, W4 decides).

export const SYSTEM2_BELOW = 0.5;
// Motion is kept (the user, 2026-11-03: routine and subtle movement lost): where Jev saw someone move or act and the work
// model saw nothing, Jev's answer stands (W8: the work model took motion away 77 times on the pass, added it 28).
const STILL = { show: 'none', moves: 'stays' };
export const losesMotion = (key, jev, work) => { const tail = key.split('|').at(-1), still = STILL[tail]; return !!still && String(work) === still && String(jev) !== still; };
const ANSWERABLE = new Set(['choice', 'noul', 'score']);

const SYSTEM = [
  'You decide questions about a scene of a novel being staged in a 3D world, from the same context another decider saw.',
  'Pictures it saw are named in the state but not shown to you; every option is described in words.',
  'For each question choose exactly one of its options, and say how sure you are, from 0 to 1.',
  'Reply with JSON only: {"answers":[{"key":"<question key>","value":"<one option>","confidence":<0..1>}]}.',
].join(' ');
const SCHEMA = { type: 'object', properties: { answers: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, confidence: { type: 'number' } }, required: ['key', 'value', 'confidence'] } } }, required: ['answers'] };

/** The options a question offers, as the work model reads them. */
const optionsOf = question => question.primitive === 'noul' ? [{ option: 'true', means: question.noulCriteria?.true }, { option: 'false', means: question.noulCriteria?.false }]
  : question.primitive === 'score' ? (question.levels ?? []).map(level => ({ option: level }))
  : (question.options ?? []).map(option => ({ option, ...(question.optionHints?.[option] ? { means: question.optionHints[option] } : {}) }));

/** The work model's answers to `questions` on `state`, each checked against its options; none for what it got wrong. */
export async function workAnswers(work, state, questions, images = {}) {
  const prompt = JSON.stringify({
    state: typeof state === 'string' ? { text: state } : state,
    ...(Object.keys(images).length ? { pictures: `named in the state, not shown: ${Object.keys(images).join(', ')}` } : {}),
    questions: questions.map(question => ({ key: question.key, instructions: question.instructions, ...(question.criteria ? { criteria: question.criteria } : {}), options: optionsOf(question) })),
  });
  const text = await work.generate({ system: SYSTEM, prompt, jsonSchema: SCHEMA, maxTokens: 800 });
  let replies = [];
  try { replies = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')).answers ?? []; } catch { return []; }
  return questions.flatMap(question => {
    const reply = replies.find(entry => entry?.key === question.key), allowed = optionsOf(question).map(entry => String(entry.option));
    if (!reply || !allowed.includes(String(reply.value))) return [];
    // A noul's value is the chance it is true (as Jev gives it); a choice's or a score's, the option.
    const sure = Math.max(0, Math.min(1, Number(reply.confidence) || 0)), value = question.primitive === 'noul' ? (reply.value === 'true' ? sure : 1 - sure) : String(reply.value);
    return [{ key: question.key, value, confidence: sure, by: 'work' }];
  });
}

/**
 * Jev's `decide` with system 2 round it: `jev(state, questions, options)` answers; below `below`, the work model is asked
 * the same; `note(entry)` receives each question system 2 ran on (its key and instructions, Jev's answer, the work model's,
 * and which was used). Without a work model, Jev's answers pass through unchanged.
 */
export function withSystem2(jev, work, { below = SYSTEM2_BELOW, note = () => {} } = {}) {
  return async (state, questions, options = {}) => {
    const answers = await jev(state, questions, options);
    if (!work) return answers;
    const of = key => answers.find(answer => answer.key === key);
    const unsure = questions.filter(question => ANSWERABLE.has(question.primitive) && of(question.key) && (of(question.key).confidence ?? 1) < below);
    if (!unsure.length) return answers;
    const second = await workAnswers(work, state, unsure, options.images ?? {}).catch(() => []);
    const kept = new Set();
    for (const question of unsure) {
      const first = of(question.key), other = second.find(answer => answer.key === question.key);
      if (other && losesMotion(question.key, first.value, other.value)) kept.add(question.key);
      note({ key: question.key, asked: question.instructions, jev: { value: first.value, confidence: first.confidence ?? null }, work: other ? { value: other.value, confidence: other.confidence } : null, used: other && !kept.has(question.key) ? 'work' : 'jev', ...(kept.has(question.key) ? { kept: 'motion' } : {}) });
    }
    return answers.map(answer => (kept.has(answer.key) ? answer : second.find(entry => entry.key === answer.key) ?? answer));
  };
}
