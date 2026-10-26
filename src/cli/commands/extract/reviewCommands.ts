import { review } from "../../../solidifier/merge/review.js";
import type { ReviewTarget } from "../../../solidifier/merge/reviewTypes.js";

export async function reviewCommand(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const [operation, directory, packetId, ...rest] = args;
  const allowed: Record<string, string[]> = {
    show: ["--scope", "--universe", "--offset", "--limit"],
    evidence: ["--scope", "--universe", "--fact", "--offset", "--limit"],
    decide: ["--scope", "--universe", "--revision", "--decisions"],
    apply: ["--scope", "--universe", "--revision"],
  };
  if (!directory || !packetId || !Object.hasOwn(allowed, operation)) throw new Error("Usage: novel review show|evidence|decide|apply <root> <packet> --scope book|universe|library ...");
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    if (!allowed[operation].includes(rest[index]) || flags.has(rest[index]) || !rest[index + 1] || rest[index + 1].startsWith("--")) throw new Error(`Invalid or duplicate review option ${rest[index]}.`);
    flags.set(rest[index], rest[index + 1]);
  }
  const scope = flags.get("--scope") ?? "book";
  if (!["book", "universe", "library"].includes(scope)) throw new Error("Unknown review scope.");
  if (["decide", "apply"].includes(operation) && !/^[a-f0-9]{64}$/.test(flags.get("--revision") ?? "")) throw new Error("Supply the current --revision from review show.");
  const raw = flags.get("--decisions");
  if (operation === "decide" && (!raw || Buffer.byteLength(raw) > 64000)) throw new Error("Supply --decisions as a bounded JSON array / 64 KiB.");
  return review(operation, { directory, packetId, scope: scope as ReviewTarget["scope"], ...(flags.has("--universe") ? { universeId: flags.get("--universe") } : {}) }, {
    ...(flags.has("--fact") ? { factId: flags.get("--fact") } : {}),
    ...(flags.has("--offset") ? { offset: Number(flags.get("--offset")) } : {}),
    ...(flags.has("--limit") ? { limit: Number(flags.get("--limit")) } : {}),
    revision: flags.get("--revision"), ...(raw ? { decisions: JSON.parse(raw) } : {}),
  }, env);
}
