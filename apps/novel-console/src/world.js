// A world's page inside the console (docs/v3/console.md §7; the user, 2026-11-10: "Let's continue with the rest of p3"):
// v1's World · Live (tools/pi-review/sim-world.html) and what it reads, served on the console's own origin at
// app://console/world/<id>/play/..., each answer made by the same functions v1's viewer used (sim-play.mjs,
// sim-settings.mjs) for one book's workspace in a world (a v2 library: universe/ and vol-<n>/novel). The page brings its
// panels with it: the run's cards and why, the review's items, notes, the settings, the warehouse, Jev's questions.
// A world the console did not make (a library from the Pi hosts) is read only: every change is refused.
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const VOLUME = /^[1-9]\d{0,3}$/, SCENE = /^[\w-]{1,60}$/, PLACE = /^[\w:-]{1,80}$/;
const READ_ONLY = "This world is a library the console did not make, so it is opened read only: its page shows everything and changes nothing.";

function createWorlds(backend) {
  const known = new Map();
  const load = (rel) => import(pathToFileURL(path.join(backend, rel)).href);
  const idOf = (root) => crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const text = (body, type = "text/plain; charset=utf-8") => new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
  const missing = () => new Response("Not found", { status: 404 });

  /** The worlds a folder's server found, each given the id its page is served under. */
  function register(worlds) {
    return (worlds ?? []).map((world) => {
      const wid = idOf(world.root);
      known.set(wid, { root: world.root, readOnly: world.readOnly !== false, volumes: new Set(world.books.map((book) => book.volume)) });
      return { ...world, wid };
    });
  }

  async function handle(request, url) {
    const match = /^\/world\/([a-f0-9]{16})(\/.*)$/.exec(url.pathname), world = match && known.get(match[1]);
    if (!world) return missing();
    const route = match[2], asked = url.searchParams.get("volume");
    const volume = asked && VOLUME.test(asked) ? Number(asked) : [...world.volumes][0];
    if (!world.volumes.has(volume)) return missing();
    const workspace = path.join(world.root, `vol-${volume}`, "novel");
    const play = await load("tools/pi-review/sim-play.mjs"), handles = await load("tools/pi-review/sim-settings.mjs");
    // Every page may be framed by the console (same origin) and nothing else.
    const page = (made) => (made ? new Response(made.html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": play.pagePolicy(made.html, { framed: true }), "cache-control": "no-store" } }) : missing());

    if (request.method === "POST") {
      if (world.readOnly) return json({ error: READ_ONLY }, 403);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "a bad request" }, 400);
      if (route === "/play/notes") { const note = await play.addDirectorNote(workspace, body); return note ? json(note) : json({ error: "a bad note" }, 400); }
      if (route === "/play/settings") { const reply = await handles.applySetting(workspace, body); return json(reply, reply?.error ? 400 : 200); }
      if (route === "/play/warehouse/use") { const reply = await handles.useWarehousePart(workspace, body); return json(reply, reply?.error ? 400 : 200); }
      if (route === "/play/terrain/step") { const step = await play.terrainStep(workspace, body.mode); return step ? json(step) : json({ error: "no step" }, 400); }
      return missing();
    }

    switch (route) {
      case "/play/world": return page(await play.simulationWorldPage());
      case "/play/live": return page(await play.simulationLivePage());
      case "/play/now": return page(await play.simulationNowPage(workspace));
      case "/play/": return page((await play.simulationPage(workspace, { newest: url.searchParams.get("newest") === "1", live: `live?volume=${volume}` })) ?? (await play.simulationLivePage()));
      case "/play/live.json": return json(await play.liveState(workspace));
      case "/play/live/world.json": return text(await play.liveWorld(workspace), "application/json; charset=utf-8");
      case "/play/live/frames.jsonl": return text(await play.liveFrames(workspace));
      case "/play/reading.json": { const view = await play.directorReading(workspace); return view ? json(view) : missing(); }
      case "/play/review.json": { const view = await play.directorReview(workspace); return view ? json(view) : missing(); }
      case "/play/notes.json": return json(await play.directorNotes(workspace));
      case "/play/album.json": return json(await play.directorAlbum(workspace));
      case "/play/sky.json": { const view = await play.directorSky(workspace); return view ? json(view) : missing(); }
      case "/play/dev.json": {
        const scene = url.searchParams.get("scene") ?? "", card = url.searchParams.get("card") ?? "";
        if (!SCENE.test(scene) || card.length > 120) return json({ error: "a bad card" }, 400);
        const view = await play.directorDev(workspace, { scene, card });
        return view ? json(view) : missing();
      }
      case "/play/dev/file": {
        const file = await play.directorFile(workspace, url.searchParams.get("name") ?? "");
        return file ? new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-store" } }) : missing();
      }
      case "/play/settings.json": {
        const place = url.searchParams.get("place");
        if (place && !PLACE.test(place)) return json({ error: "a bad place" }, 400);
        return json({ ...(await handles.settingsView(workspace, { place })), readOnly: world.readOnly });
      }
      case "/play/warehouse.json": {
        const q = (key) => url.searchParams.get(key);
        return json({ ...(await handles.warehouseView(workspace, { find: q("find") ?? "", kind: q("kind"), category: q("category"), source: q("source"), size: q("size") })), readOnly: world.readOnly });
      }
      default: break;
    }
    if (route.startsWith("/play/vendor/")) { const body = await play.simulationVendor(route.slice("/play/vendor/".length)); return body ? text(body, "text/javascript; charset=utf-8") : missing(); }
    if (route.startsWith("/play/live/")) {
      const picture = await play.livePicture(workspace, route.slice("/play/live/".length));
      return picture ? new Response(picture.body, { headers: { "content-type": picture.type, "cache-control": "private, max-age=86400" } }) : missing();
    }
    // Read mode's own text (api/book-text, api/book-epub) is the console's reader's job, beside the page.
    return missing();
  }

  return { register, handle, known };
}

module.exports = { createWorlds };
