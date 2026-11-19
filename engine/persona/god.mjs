// The world agent (docs/v3/design.html §10.2; the user, 2026-11-19: "the world agent, which basically serves like a god
// to the user that has all knowledge of now and future"). It speaks to the user, never to the characters: it knows where
// everyone is at the call's point, what is happening there, and what the books say happens next (the future the
// characters do not know), and it answers the user's questions from that. It acts in steps with tools on the world
// (world.mjs), the work model, a few steps a question:
//   now     the character's scene: where (room, building, city), when, with whom, what is happening; and where the
//           others who matter most are at this moment
//   where   where someone is now
//   story   what happens before or after this point (the books' scenes, as the people who lived them remember them)
//   answer  the reply to the user
// Nothing here is about any one book.
import { glimpse, sceneOf, clockText } from './world.mjs';

export const GOD_STEPS = 5;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Text of a glimpse, as the world agent and the user read it. */
export const glimpseText = (world, g) => g.where === null && !g.when ? g.text : [
  `${world.nameOf(g.person)}: ${g.where?.length ? g.where.join(' < ') : 'a place the world engine has not built yet'}; ${g.when}${g.with?.length ? `; with ${g.with.join(', ')}` : ''}.`,
  ...(g.happens ?? []).slice(0, 2).map((h) => `  ${clip(h, 160)}`),
].join('\n');

/** The world agent for a call: ask(question, { order, focus }) -> { answer, steps }. */
export function createGod(u, world, act) {
  const people = [...new Set(u.memories.map((m) => m.holderId))].map((id) => [id, u.memories.filter((m) => m.holderId === id).length]).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const find = (name) => u.people.find((p) => p.id === name || p.name === name || p.forms.includes(name)) ?? u.people.find((p) => p.forms.some((f) => f.includes(name) || name.includes(f)));
  const tools = {
    now: (args, { order, focus }) => [glimpseText(world, glimpse(world, focus, order)), 'Elsewhere at this moment:',
      ...people.filter((p) => p !== focus).map((p) => { const s = sceneOf(world, p, order); return s ? `- ${world.nameOf(p)}: ${s.place ? world.chain(s.place).map((x) => x.label).slice(0, 3).join(' < ') : '(unbuilt place)'}, ${clockText(s.clock)} (${s.book})` : `- ${world.nameOf(p)}: not in the books yet`; })].join('\n'),
    where: (args, { order }) => { const p = find(String(args.who ?? '')); return p ? glimpseText(world, glimpse(world, p.id, order)) : `No one called ${args.who} in this world.`; },
    story: (args, { order, focus }) => {
      const who = args.who ? find(String(args.who))?.id : null, n = Math.min(12, Number(args.n) || 6), after = args.direction !== 'before';
      const pool = world.scenes.filter((s) => (after ? s.order > order : s.order <= order) && s.happens.length && (!who || s.people.some((p) => p.person === who)));
      const pick = after ? pool.slice(0, n) : pool.slice(-n);
      return pick.map((s) => `[${s.book} ${clockText(s.clock)}${s.place ? `, ${world.chain(s.place)[0]?.label}` : ''}] ${s.happens.map((h) => `${world.nameOf(h.who)}: ${clip(h.what, 110)}`).join(' / ')}`).join('\n') || '(nothing the books show)';
    },
  };
  const SYSTEM = [
    'You are the world itself, speaking to a visitor from another universe who holds a phone connected to a person of this world.',
    'You know everything: where everyone is now, what has happened, and what will happen (the books\' future, which the people of the world do not know). You never speak to the people of the world, only to the visitor.',
    'Use the tools to look before you answer; answer only from what they show. Be brief and vivid, like a narrator; tell the future when asked, plainly marked as what will come. Answer in the language the visitor writes in.',
    'Each step, call one tool. Answer as JSON only: {"tool": "now|where|story|answer", "args": {}}. Tools:',
    'now: the person on the phone\'s scene and where the others are now. Args: {}',
    'where: where someone is now. Args: {"who": "a name"}',
    'story: what happens next (or before) at this point. Args: {"direction": "next|before", "who": "a name or empty", "n": 6}',
    'answer: your reply to the visitor. Args: {"text": "..."}',
  ].join('\n');

  async function ask(question, context) {
    const steps = [];
    for (let i = 0; i < GOD_STEPS; i++) {
      const prompt = [`The person on the phone: ${world.nameOf(context.focus)}. The visitor asks: ${question}`,
        steps.length ? `Your steps so far:\n${steps.map((s) => `${s.tool}(${JSON.stringify(s.args)}) ->\n${s.result}`).join('\n')}` : 'No steps yet.', 'Your next step:'].join('\n\n');
      let call;
      try { call = JSON.parse(String(await act({ system: SYSTEM, prompt }))); } catch { call = { tool: 'answer', args: { text: '…' } }; }
      const tool = String(call.tool ?? ''), args = call.args ?? {};
      if (tool === 'answer' || i === GOD_STEPS - 1) { steps.push({ tool: 'answer', args }); return { answer: String(args.text ?? '…'), steps }; }
      const result = tools[tool] ? tools[tool](args, context) : `No tool ${tool}.`;
      steps.push({ tool, args, result });
    }
    return { answer: '…', steps };
  }
  return { ask, glimpse: (context) => glimpse(world, context.focus, context.order) };
}
