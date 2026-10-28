import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { libraryCallSink, observeDecisions } from "../../../ground/events/observe.js";
import { loadUniverseContext, universeBindings, universeCandidates, universeCausalView, universeDecide, universeEvidence, universePacket, universePropose, universeSweep } from "../../../solidifier/causality/universe.js";

export async function universeCausalityCommand(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const [operation, directory, universeId, ...rest] = args;
  const allowed: Record<string, string[]> = {
    candidates: ["--offset", "--limit"], sweep: ["--offset", "--limit", "--revision"],
    evidence: ["--offset", "--limit", "--packet"], propose: ["--revision", "--reason"],
    show: ["--offset", "--limit"], decide: ["--revision", "--decisions"], list: ["--offset", "--limit"],
  };
  if (!directory || !universeId || !Object.hasOwn(allowed, operation)) throw new Error("Usage: novel causality universe candidates|sweep|evidence|propose|show|decide|list <library-dir> <universe-id> ...");
  const flags = new Map<string, string>(), values: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (!value.startsWith("--")) { values.push(value); continue; }
    const next = rest[++index];
    if (!allowed[operation].includes(value) || flags.has(value) || !next || next.startsWith("--")) throw new Error(`Invalid or duplicate universe causality option ${value}.`);
    flags.set(value, next);
  }
  const count = ["evidence", "propose"].includes(operation) ? 2 : ["show", "decide"].includes(operation) ? 1 : 0;
  if (values.length !== count) throw new Error(`Universe causality ${operation} needs ${count} endpoint/packet argument(s).`);
  const offset = Number(flags.get("--offset") ?? 0), limit = Number(flags.get("--limit") ?? 10);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("Universe causal pages require offset >= 0 and limit 1..20.");
  const config = await universeBindings(env);
  const context = await loadUniverseContext(directory, universeId, config);
  if (operation === "candidates") return universeCandidates(context, offset, limit);
  if (["propose", "sweep"].includes(operation) && flags.get("--revision") !== context.revision) throw new Error("Read candidates and supply their current --revision before proposing or running a paid universe sweep.");
  if (operation === "sweep") return universeSweep(context, observeDecisions(jevFromEnv(env), await libraryCallSink(directory), { faculty: "universe-causality" }), offset, limit);
  if (operation === "evidence") return universeEvidence(context, values[0], values[1], { packetId: flags.get("--packet"), offset, limit });
  if (operation === "propose") return universePropose(context, values[0], values[1], flags.get("--reason") ?? "");
  if (operation === "show") {
    const data = await universePacket(context, values[0]);
    return { id: data.packet.id, universeId, contextRevision: data.packet.contextRevision, revision: data.revision, stale: data.stale, createdAt: data.packet.createdAt,
      proposals: data.packet.proposals.slice(offset, offset + limit), decisions: data.decisions.filter(decision => data.packet.proposals.slice(offset, offset + limit).some(proposal => proposal.id === decision.proposalId)),
      page: { offset, limit, total: data.packet.proposals.length, nextOffset: offset + limit < data.packet.proposals.length ? offset + limit : null } };
  }
  if (operation === "decide") {
    const raw = flags.get("--decisions") ?? "";
    if (Buffer.byteLength(raw) > 64000) throw new Error("Causal decisions exceed 64 KiB.");
    return universeDecide(context, values[0], flags.get("--revision") ?? "", JSON.parse(raw));
  }
  const view = await universeCausalView(directory, config);
  const links = view.links.filter(link => link.universeId === universeId);
  return { revision: view.revision, links: links.slice(offset, offset + limit), totalPackets: view.totalPackets, invalidPackets: view.invalidPackets, omittedPackets: view.omittedPackets, coverage: context.coverage,
    page: { offset, limit, total: links.length, nextOffset: offset + limit < links.length ? offset + limit : null } };
}
