// The backend the app carries (apps/novel-console/build/backend, copied into the app's resources): the repository's built
// code (dist, without its tests), the reading's scripts (experiments/v2/*.mjs), its settings (config/), the reader page, and the production
// packages the code imports, laid out as in the repository so every relative path still holds. Run after `npm run build`
// at the repository's root.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), ".."), repository = resolve(app, "..", "..");
const out = join(app, "build", "backend");
if (!existsSync(join(repository, "dist", "src", "v3", "server.js"))) throw new Error("Build the repository first (npm run build at its root).");
// An earlier backend goes to the Trash, never deleted here.
if (existsSync(out)) renameSync(out, join(homedir(), ".Trash", `novel-console-backend-${Date.now()}`));
mkdirSync(out, { recursive: true });

const copy = (from, to = from) => cpSync(join(repository, from), join(out, to), { recursive: true, dereference: true });
for (const name of readdirSync(join(repository, "dist")).filter((name) => name !== "test")) copy(`dist/${name}`);
mkdirSync(join(out, "experiments", "v2"), { recursive: true });
for (const name of readdirSync(join(repository, "experiments", "v2")).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))) copy(`experiments/v2/${name}`);
copy("config");
mkdirSync(join(out, "world-engine", "director"), { recursive: true });
copy("world-engine/director/segments.mjs");
copy("apps/reader/reader.html");
copy("skills/novel-folder");
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
