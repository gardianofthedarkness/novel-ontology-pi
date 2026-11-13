// The backend the app carries (apps/novel-console/build/backend, copied into the app's resources): the repository's built
// code (dist, without its tests), the reading's scripts (engine/*.mjs), its settings (config/), the reader page, and the production
// packages the code imports, laid out as in the repository so every relative path still holds. Run after `npm run build`
// at the repository's root.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), ".."), repository = resolve(app, "..", "..");
const out = join(app, "build", "backend");
if (!existsSync(join(repository, "dist", "src", "server", "server.js"))) throw new Error("Build the repository first (npm run build at its root).");
// An earlier backend goes to the Trash, never deleted here.
if (existsSync(out)) renameSync(out, join(homedir(), ".Trash", `novel-console-backend-${Date.now()}`));
mkdirSync(out, { recursive: true });

const copy = (from, to = from) => cpSync(join(repository, from), join(out, to), { recursive: true, dereference: true });
for (const name of readdirSync(join(repository, "dist")).filter((name) => name !== "test")) copy(`dist/${name}`);
// The engine's scripts (the reading's runner engine/reading/read.mjs and what it loads), without their tests.
cpSync(join(repository, "engine"), join(out, "engine"), { recursive: true, dereference: true, filter: (from) => !from.endsWith(".test.mjs") });
copy("config");
// World · Live inside the console (src/world.js): v1's page and its helpers (the engine they load is copied above), and
// the three.js files the engine's player imports, where engine/live/sim-jev.mjs VENDOR_FILES says they are.
for (const name of ["sim-play.mjs", "sim-settings.mjs", "sim-world.html", "sim-live.html", "config.mjs", "album.mjs", "book-epub.mjs"]) copy(`tools/pi-review/${name}`);
const { VENDOR_FILES } = await import(pathToFileURL(join(repository, "engine", "live", "sim-jev.mjs")).href);
for (const rel of Object.values(VENDOR_FILES)) {
  if (existsSync(join(repository, rel))) copy(rel);
  else console.warn(`three.js is missing at ${rel}: the world's player will not draw until it is installed.`);
}
copy("apps/reader/reader.html");
copy("skills/novel-folder");
// The agent's workflows for a whole volume (engine/workflows): the skills they read and Pi's round runner with its guard.
copy("skills/novel-volume"); copy("skills/novel-models");
// The world engine's own data (the director and terrain read them when a volume runs from the app): the building, furniture
// and vehicle models and the model themes, beside the compiled playground code dist already carries; the stills step's helper.
for (const name of ["architectureModels.json", "furnitureModels.json", "vehicleModels.json", "modelThemes.json"]) copy(`apps/playground/src/data/${name}`);
if (existsSync(join(repository, "tools/album-portraits/stills.py"))) copy("tools/album-portraits/stills.py");
// The world engine's other imports outside engine/: building EM (export-strand-demo) and the Pi console (the review sends batches).
copy("experiments/world-first/buildings.mjs");
for (const name of ["pi-console.mjs"]) if (existsSync(join(repository, `tools/pi-review/${name}`))) copy(`tools/pi-review/${name}`);
for (const name of ["workflow-agent.mjs", "review-agent.mjs", "guard.mjs"]) copy(`tools/pi-review/${name}`);
// Pi, for arranging a folder when Claude Code is signed out (tools/pi-review/folder-arrange.mjs and its packages).
for (const name of ["folder-arrange.mjs", "folder-scope.mjs", "package.json"]) copy(`tools/pi-review/${name}`);
// Its packages without node_modules/.bin: those are symbolic links, which the app's signature refuses (Pi runs as a module).
cpSync(join(repository, "tools/pi-review/node_modules"), join(out, "tools/pi-review/node_modules"), { recursive: true, dereference: true, filter: (from) => !/[\\/]node_modules[\\/]\.bin([\\/]|$)/.test(from) });
writeFileSync(join(out, "package.json"), JSON.stringify({ name: "novel-console-backend", private: true, type: "module" }, null, 2));

// The production packages (npm's own list), Apple Silicon only.
const listed = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: repository, encoding: "utf8" }).split("\n").slice(1).filter(Boolean);
let packages = 0;
for (const path of [...new Set(listed)]) {
  const rel = relative(repository, path);
  if (!rel.startsWith("node_modules") || /core-(linux|win32|darwin-x64)/.test(rel)) continue;
  copy(rel); packages++;
}
console.log(JSON.stringify({ backend: out, packages }));
