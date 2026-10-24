import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceUrl = new URL("../apps/playground/src/components/PiConsole.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  fileName: sourceUrl.pathname,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function response(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)];
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? textContent(node.props?.children) : String(node);
}

function createHarness(context, hash = "#pi=test-private-capability") {
  const slots = [];
  const requests = [];
  const timers = new Map();
  const transcript = { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 };
  const location = { hash };
  let snapshot = { status: "running", acceptingMessages: true, entries: [], queued: 0, processing: 0, unknown: 0 };
  let transport = () => response(snapshot);
  let cursor = 0;
  let timerId = 0;
  let tree;
  let effects = [];
  let layouts = [];
  let dirty = false;
  let mounted = true;
  let updatesAfterUnmount = 0;
  let uuidCalls = 0;
  let focused = false;

  function registerEffect(queue, effect, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (previous && dependencies && previous.dependencies?.length === dependencies.length
      && dependencies.every((value, dependency) => Object.is(value, previous.dependencies[dependency]))) return;
    queue.push(() => {
      previous?.cleanup?.();
      slots[index] = { dependencies, cleanup: effect() };
    });
  }

  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        if (!mounted) updatesAfterUnmount++;
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(slots[index], next)) dirty = true;
        slots[index] = next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useId() { return `pi-test-${cursor++}`; },
    useEffect(effect, dependencies) { registerEffect(effects, effect, dependencies); },
    useLayoutEffect(effect, dependencies) { registerEffect(layouts, effect, dependencies); },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./pi-console.css") return {};
      throw new Error(`Unexpected component dependency: ${name}`);
    },
    window: { location },
    URLSearchParams,
    AbortController,
    Error,
    crypto: { randomUUID() { uuidCalls++; return randomUUID(); } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return transport(url, options);
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  }, { filename: sourceUrl.pathname });

  function find(predicate) {
    const node = descendants(tree).find(predicate);
    assert.ok(node, "Expected component node to exist");
    return node;
  }

  function render() {
    assert.ok(mounted);
    dirty = false;
    cursor = 0;
    tree = exports.PiConsole();
    for (const node of descendants(tree)) {
      if (node.props?.className === "pi-console-transcript") node.props.ref.current = transcript;
      if (node.props?.className === "pi-console-toggle") node.props.ref.current = { focus() { focused = true; } };
    }
    const pendingLayouts = layouts;
    const pendingEffects = effects;
    layouts = [];
    effects = [];
    pendingLayouts.forEach(effect => effect());
    pendingEffects.forEach(effect => effect());
    return tree;
  }

  async function flush() {
    await new Promise(resolve => setImmediate(resolve));
    if (dirty && mounted) render();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  }

  context.after(unmount);
  render();
  return {
    exports, requests, timers, transcript, location, render, flush, find, unmount,
    get tree() { return tree; },
    get uuidCalls() { return uuidCalls; },
    get focused() { return focused; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    get posts() { return requests.filter(request => request.options.method === "POST"); },
    setSnapshot(value) { snapshot = { ...snapshot, ...value }; },
    setTransport(value) { transport = value; },
    toggle() {
      find(node => node.props?.className === "pi-console-toggle").props.onClick();
      render();
    },
    async open() { this.toggle(); await flush(); },
    draft(value) {
      find(node => node.type === "textarea").props.onChange({ target: { value } });
      render();
    },
    submit() { return find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); },
    async tick() {
      assert.equal(timers.size, 1, "Only one polling timer should exist");
      const [id, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 1000);
      timers.delete(id);
      await timer.callback();
      await flush();
    },
    scroll(scrollTop) {
      transcript.scrollTop = scrollTop;
      find(node => node.props?.className === "pi-console-transcript").props.onScroll({ currentTarget: transcript });
    },
  };
}

test("failed and ambiguous submissions reuse their UUID; a new submission gets a fresh UUID", async context => {
  const harness = createHarness(context);
  await harness.open();
  harness.draft("Inspect novel status");
  harness.setTransport(() => { throw new Error("Connection lost"); });
  await harness.submit();
  await harness.flush();
  const firstBody = harness.posts[0].options.body;
  const first = JSON.parse(firstBody);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.equal(harness.uuidCalls, 1);
  assert.equal(harness.find(node => node.props?.type === "submit").props.children, "Retry");

  harness.setTransport(() => response({ id: "wrong-id", status: "queued" }, 202));
  await harness.submit();
  await harness.flush();
  assert.equal(harness.posts[1].options.body, firstBody);
  assert.equal(harness.find(node => node.type === "textarea").props.value, first.text);
  assert.match(textContent(harness.tree), /Queue confirmation was unclear/);

  harness.setTransport((url, options) => response({ id: JSON.parse(options.body).id, status: "queued" }, 202));
  await harness.submit();
  await harness.flush();
  assert.equal(harness.posts[2].options.body, firstBody);
  assert.equal(harness.uuidCalls, 1);
  assert.equal(harness.find(node => node.type === "textarea").props.value, "");
  assert.match(textContent(harness.tree), /Queued · awaiting transcript/);

  harness.draft(first.text);
  await harness.submit();
  await harness.flush();
  assert.notEqual(JSON.parse(harness.posts[3].options.body).id, first.id);
  assert.equal(harness.uuidCalls, 2);
});

test("transport keeps the hash capability in memory and sends it only in the same-origin POST header", async context => {
  const capability = "private/value+with=punctuation";
  const harness = createHarness(context, `#view=live&pi=${encodeURIComponent(capability)}`);
  await harness.open();
  harness.location.hash = "#pi=replaced-after-mount";
  harness.draft("Show novel status");
  harness.setTransport((url, options) => response({ id: JSON.parse(options.body).id, status: "queued" }, 202));
  await harness.submit();
  await harness.flush();
  const [get, post] = harness.requests;
  assert.equal(get.url, "api/pi");
  assert.equal(get.options.credentials, "same-origin");
  assert.equal(get.options.cache, "no-store");
  assert.equal(get.options.headers, undefined);
  assert.equal(post.url, "api/pi/messages");
  assert.equal(post.options.credentials, "same-origin");
  assert.equal(post.options.headers["X-Pi-Control"], capability);
  assert.equal(post.options.headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(JSON.parse(post.options.body)).sort(), ["id", "text"]);
  assert.ok(!post.options.body.includes(capability));
  assert.ok(harness.requests.every(request => !request.url.includes("?") && !request.url.includes("#")));
  assert.ok(!JSON.stringify(harness.tree).includes(capability));
});

test("idempotent retries preserve queued, processing, and consumed acknowledgements without requeueing", async context => {
  for (const status of ["queued", "processing", "consumed"]) {
    const harness = createHarness(context);
    await harness.open();
    harness.draft("Inspect novel status");
    harness.setTransport(() => { throw new Error("Lost acknowledgement"); });
    await harness.submit();
    await harness.flush();
    const originalBody = harness.posts[0].options.body;
    harness.setTransport((url, options) => response({ id: JSON.parse(options.body).id, status, duplicate: true }, 202));
    await harness.submit();
    await harness.flush();
    assert.equal(harness.posts[1].options.body, originalBody);
    assert.equal(harness.uuidCalls, 1);
    assert.equal(harness.find(node => node.type === "textarea").props.value, "");
    assert.equal(descendants(harness.tree).filter(node => node.props?.role === "alert").length, 0);
    assert.match(textContent(harness.tree), new RegExp(`Last acknowledgement: ${status}`));
    const acknowledgement = harness.find(node => node.type === "article");
    assert.match(textContent(acknowledgement), status === "queued" ? /Queued · awaiting transcript/
      : status === "processing" ? /Processing · awaiting transcript/ : /Consumed · confirmed by Pi/);
    if (status !== "queued") assert.ok(!textContent(acknowledgement).includes("Queued"));
    if (status === "consumed") assert.ok(!textContent(harness.tree).includes("1 pending"));
    harness.unmount();
  }
});

test("a failed duplicate is terminal, clearly reported, and cannot resubmit the same message", async context => {
  const harness = createHarness(context);
  await harness.open();
  harness.draft("Inspect novel status");
  harness.setTransport(() => { throw new Error("Lost acknowledgement"); });
  await harness.submit();
  await harness.flush();
  harness.setTransport((url, options) => response({ id: JSON.parse(options.body).id, status: "failed", duplicate: true }, 202));
  await harness.submit();
  await harness.flush();
  assert.equal(harness.posts[0].options.body, harness.posts[1].options.body);
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, true);
  assert.equal(harness.find(node => node.type === "textarea").props.value, "Inspect novel status");
  assert.match(textContent(harness.tree), /Failed · not retried/);
  const alert = harness.find(node => node.props?.role === "alert");
  assert.match(textContent(alert), /message failed.*will not be resubmitted/);
  assert.ok(!textContent(alert).includes("Retry unchanged text"));
  await harness.submit();
  harness.draft("  Inspect novel status  ");
  await harness.submit();
  assert.equal(harness.posts.length, 2);
  assert.equal(harness.uuidCalls, 1);
  harness.draft("A different instruction");
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, false);
});

test("GET accepts backend queue counts and the pending contract without mislabelling processing as queued", async context => {
  const harness = createHarness(context);
  harness.setSnapshot({ queued: 2, processing: 3, unknown: 1 });
  await harness.open();
  assert.match(textContent(harness.tree), /6 pending/);
  assert.match(textContent(harness.tree), /2 queued · 3 processing · 1 unknown/);
  harness.setTransport(() => response({ status: "running", acceptingMessages: true, entries: [], pending: 4 }));
  await harness.tick();
  assert.match(textContent(harness.tree), /4 pending/);
  harness.draft("Inspect novel status");
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, false);
  harness.setTransport(() => response({ status: "running", acceptingMessages: true, entries: [], queued: -1, processing: 0 }));
  await harness.tick();
  assert.match(textContent(harness.tree), /invalid status response/);
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, true);
});

test("missing or empty capability disables sends while leaving the transcript visible", async context => {
  for (const hash of ["", "#pi=", "#other=private"]) {
    const harness = createHarness(context, hash);
    harness.setSnapshot({ entries: [{ id: "command-1", kind: "command", timestamp: "2026-10-23T00:00:00Z", text: "novel status" }] });
    await harness.open();
    harness.draft("Inspect the novel");
    assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, true);
    await harness.submit();
    assert.equal(harness.posts.length, 0);
    assert.equal(harness.uuidCalls, 0);
    assert.match(textContent(harness.tree), /Private control capability required/);
    assert.equal(harness.find(node => node.type === "pre").props.children, "novel status");
    harness.unmount();
  }
});

test("polling starts only on expansion, survives renders, and cleans up on collapse and unmount", async context => {
  const harness = createHarness(context);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.timers.size, 0);
  await harness.open();
  const signal = harness.requests[0].options.signal;
  const timerId = [...harness.timers.keys()][0];
  harness.draft("Typing should not restart polling");
  harness.render();
  assert.equal(harness.requests.length, 1);
  assert.equal([...harness.timers.keys()][0], timerId);
  assert.equal(signal.aborted, false);
  await harness.tick();
  assert.equal(harness.requests.length, 2);
  harness.toggle();
  assert.equal(signal.aborted, true);
  assert.equal(harness.timers.size, 0);
  await harness.open();
  const reopenedSignal = harness.requests.at(-1).options.signal;
  assert.notEqual(reopenedSignal, signal);
  harness.unmount();
  assert.equal(reopenedSignal.aborted, true);
  assert.equal(harness.timers.size, 0);
});

test("a late poll response after collapse or unmount cannot restart polling or update state", async context => {
  for (const cleanup of ["collapse", "unmount"]) {
    const harness = createHarness(context);
    const pending = deferred();
    harness.setTransport(() => pending.promise);
    harness.toggle();
    const signal = harness.requests[0].options.signal;
    if (cleanup === "collapse") harness.toggle();
    else harness.unmount();
    assert.equal(signal.aborted, true);
    pending.resolve(response({ status: "late-response", acceptingMessages: true, entries: [], pending: 0 }));
    await harness.flush();
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.updatesAfterUnmount, 0);
    assert.ok(!textContent(harness.tree).includes("late-response"));
  }
});

test("in-flight sends disable controls, reject duplicate submissions, and abort on unmount", async context => {
  const harness = createHarness(context);
  await harness.open();
  harness.draft("Inspect novel status");
  const pending = deferred();
  harness.setTransport(() => pending.promise);
  const sending = harness.submit();
  await harness.submit();
  harness.render();
  assert.equal(harness.posts.length, 1);
  assert.equal(harness.find(node => node.type === "textarea").props.disabled, true);
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, true);
  const request = harness.posts[0];
  harness.unmount();
  assert.equal(request.options.signal.aborted, true);
  pending.resolve(response({ id: JSON.parse(request.options.body).id, status: "queued" }, 202));
  await sending;
  assert.equal(harness.updatesAfterUnmount, 0);
});

test("queued acknowledgement stays queued until a matching user transcript entry; paused backend disables send", async context => {
  const harness = createHarness(context);
  await harness.open();
  harness.draft("Inspect novel status");
  harness.setTransport((url, options) => response({ id: JSON.parse(options.body).id, status: "queued" }, 202));
  await harness.submit();
  await harness.flush();
  const submission = JSON.parse(harness.posts[0].options.body);
  assert.match(textContent(harness.tree), /Queued · awaiting transcript/);
  const entry = { ...submission, timestamp: "2026-10-23T00:00:00Z", kind: "status" };
  harness.setTransport(() => response({ status: "running", acceptingMessages: true, entries: [entry], pending: 0 }));
  await harness.tick();
  assert.match(textContent(harness.tree), /Queued · awaiting transcript/);
  harness.setTransport(() => response({ status: "paused", acceptingMessages: false, entries: [{ ...entry, kind: "user" }], pending: 0, detail: "Run is finishing" }));
  await harness.tick();
  assert.ok(!textContent(harness.tree).includes("Queued · awaiting transcript"));
  assert.equal(descendants(harness.tree).filter(node => node.type === "pre" && node.props.children === submission.text).length, 1);
  harness.draft("Another message");
  assert.equal(harness.find(node => node.props?.type === "submit").props.disabled, true);
  await harness.submit();
  assert.equal(harness.posts.length, 1);
  assert.match(textContent(harness.tree), /Run is finishing/);
});

test("scroll helpers preserve reading position, clamp shortened content, and follow only near the bottom", context => {
  const { isNearTranscriptBottom, transcriptScrollTarget } = createHarness(context).exports;
  const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 };
  const before = { ...metrics };
  assert.equal(isNearTranscriptBottom(metrics), false);
  assert.equal(isNearTranscriptBottom({ ...metrics, scrollTop: 636 }), false);
  assert.equal(isNearTranscriptBottom({ ...metrics, scrollTop: 637 }), true);
  assert.equal(isNearTranscriptBottom({ ...metrics, scrollTop: 720 }), true);
  assert.equal(transcriptScrollTarget(metrics, 200, false), 200);
  assert.equal(transcriptScrollTarget({ ...metrics, scrollHeight: 1600 }, 200, false), 200);
  assert.equal(transcriptScrollTarget(metrics, 200, true), 700);
  assert.equal(transcriptScrollTarget({ ...metrics, scrollHeight: 400 }, 200, false), 100);
  assert.equal(transcriptScrollTarget(metrics, -20, false), 0);
  assert.equal(transcriptScrollTarget({ ...metrics, scrollHeight: 200 }, 200, true), 0);
  assert.deepEqual(metrics, before);
});

test("transcript polling preserves upward scroll and resumes following after scrolling near the bottom", async context => {
  const harness = createHarness(context);
  await harness.open();
  assert.equal(harness.transcript.scrollTop, 700);
  harness.scroll(200);
  harness.transcript.scrollHeight = 1400;
  await harness.tick();
  assert.equal(harness.transcript.scrollTop, 200);
  harness.toggle();
  await harness.open();
  assert.equal(harness.transcript.scrollTop, 200);
  harness.scroll(1080);
  harness.transcript.scrollHeight = 1600;
  await harness.tick();
  assert.equal(harness.transcript.scrollTop, 1300);
});
