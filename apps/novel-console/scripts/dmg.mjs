// The DMG: the packed app with its backend, signed ad hoc (Apple Silicon runs no unsigned code; this is not a Developer ID signature, so a
// copy given to someone else must be opened once with right-click > Open), then a disk image with the app and a link to
// Applications. Run after `npm run pack`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const bundle = join(app, "release", "mac-arm64", "Novel Console.app");
if (!existsSync(bundle)) throw new Error("Pack the app first (npm run pack).");
// The backend goes into the app's resources whole (the packager leaves node_modules out of extra resources).
const backend = join(app, "build", "backend");
if (!existsSync(join(backend, "node_modules"))) throw new Error("Assemble the backend first (npm run backend).");
execFileSync("ditto", [backend, join(bundle, "Contents", "Resources", "backend")], { stdio: "inherit" });
// Signed outside the repository: a folder macOS syncs (Documents with iCloud) keeps Finder metadata on every file, which
// codesign refuses, so the app is copied without it into a temporary folder and signed there.
const stage = mkdtempSync(join(tmpdir(), "novel-console-dmg-")), staged = join(stage, "Novel Console.app");
execFileSync("ditto", ["--norsrc", "--noextattr", "--noqtn", bundle, staged], { stdio: "inherit" });
execFileSync("xattr", ["-cr", staged], { stdio: "inherit" });
execFileSync("codesign", ["--force", "--deep", "--sign", "-", staged], { stdio: "inherit" });
execFileSync("codesign", ["--verify", "--deep", "--strict", staged], { stdio: "inherit" });
symlinkSync("/Applications", join(stage, "Applications"));
const dmg = join(app, "release", `Novel-Console-${version}-arm64.dmg`);
execFileSync("hdiutil", ["create", "-volname", "Novel Console", "-srcfolder", stage, "-ov", "-format", "UDZO", dmg], { stdio: "inherit" });
console.log(JSON.stringify({ dmg }));
