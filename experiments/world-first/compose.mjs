// Context composition: what Jev is given for every decision, always in the same shape. It holds:
// - the world as it stands: who is where, since which scene and at what time;
// - the story so far: the latest scenes, newest last, each with its place, its time, who was there and what happened;
// - this scene in full: its own original text (for an event's decision, up to the end of that event);
// - the decision's own part (the candidates, the event).
// All of it within a budget of characters (Jev reads about 32k tokens). Over budget, the oldest of the story goes first,
// then the world's least recently placed people, then the middle of a very long scene's text. The scene's start and the
// part the decision is about are never cut.

const DEFAULT_BUDGET = 10000;

/** One context: `world` lines (latest placed first), `story` lines (oldest first), the scene's `text`, and the decision's `focus`. */
export function compose({ world = [], story = [], text = '', focus = '', budget = DEFAULT_BUDGET }) {
  let people = [...world], past = [...story], body = text;
  const render = () => [
    people.length ? `The world as it stands (who is where):\n${people.map(line => `- ${line}`).join('\n')}` : 'The world as it stands: nobody placed yet.',
    past.length ? `The story so far (newest last):\n${past.map(line => `- ${line}`).join('\n')}` : 'The story so far: this is the first scene.',
    `This scene, in full:\n${body || '(no text)'}`,
    focus,
  ].filter(Boolean).join('\n\n');
  let context = render();
  while (context.length > budget && past.length > 2) { past.shift(); context = render(); }
  while (context.length > budget && people.length > 6) { people.pop(); context = render(); }
  if (context.length > budget) {
    // A very long scene: its middle goes, keeping the start (where it sets up) and the end (where it is now).
    const room = Math.max(400, body.length - (context.length - budget) - 20), head = Math.ceil(room * 0.6);
    body = `${text.slice(0, head)}\n[…]\n${text.slice(text.length - (room - head))}`;
    context = render();
  }
  return context;
}
