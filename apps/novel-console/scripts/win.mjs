// The Windows installer: the packed app (release/win-unpacked) with its backend copied into its resources, then an NSIS
// installer made from that folder (per user, no administrator; the folder can be chosen). Not code-signed: Windows
// SmartScreen asks once ("More info" > "Run anyway"). Run after `npm run pack:win`.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const unpacked = join(app, "release", "win-unpacked");
if (!existsSync(join(unpacked, "Novel Console.exe"))) throw new Error("Pack the app first (npm run pack:win).");
// The backend goes into the app's resources whole (the packager leaves node_modules out of extra resources).
const backend = join(app, "build", "backend");
if (!existsSync(join(backend, "node_modules"))) throw new Error("Assemble the backend first (npm run backend).");
cpSync(backend, join(unpacked, "resources", "backend"), { recursive: true, force: true });
const builder = join(app, "node_modules", "electron-builder", "cli.js");
execFileSync(process.execPath, [builder, "--win", "nsis", "--x64", "--prepackaged", unpacked], { cwd: app, stdio: "inherit" });
const exe = join(app, "release", `Novel Console Setup ${version}.exe`);
if (!existsSync(exe)) throw new Error(`The installer was not made (${exe}).`);
console.log(JSON.stringify({ exe }));
