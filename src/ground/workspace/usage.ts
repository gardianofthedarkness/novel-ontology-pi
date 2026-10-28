import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a book's processing spent on the work model (DeepSeek), run by run.
 * Extraction records one line per ingest run (per faculty); time-place runs
 * keep their usage in their own run files. Counts only, never prompts.
 */
export interface WorkTokens { calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; unmetered: number }
export interface UsageRun extends WorkTokens { at: string; kind: "extraction"; model: string; byFaculty: Record<string, WorkTokens> }
export interface BookUsage {
  extraction: WorkTokens & { runs: number; byFaculty: Record<string, WorkTokens> };
  timePlace: { runs: number; calls: number; promptTokens: number; completionTokens: number };
}

const zero = (): WorkTokens => ({ calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, unmetered: 0 });
const KEYS = ["calls", "promptTokens", "cachedTokens", "completionTokens", "unmetered"] as const;
const add = (into: WorkTokens, from: Partial<WorkTokens>) => { for (const key of KEYS) into[key] += Number(from[key] ?? 0) || 0; };

export async function recordUsage(novelDir: string, run: UsageRun): Promise<void> {
  if (!run.calls) return;
  await mkdir(join(novelDir, "usage"), { recursive: true, mode: 0o700 });
  await appendFile(join(novelDir, "usage", "work.jsonl"), JSON.stringify(run) + "\n", { mode: 0o600 });
}

export async function bookUsage(novelDir: string): Promise<BookUsage> {
  const extraction = { ...zero(), runs: 0, byFaculty: {} as Record<string, WorkTokens> };
  for (const line of (await readFile(join(novelDir, "usage", "work.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean)) {
    let run: UsageRun;
    try { run = JSON.parse(line) as UsageRun; } catch { continue; }
    extraction.runs++;
    add(extraction, run);
    for (const [faculty, tokens] of Object.entries(run.byFaculty ?? {})) add(extraction.byFaculty[faculty] ??= zero(), tokens);
  }
  const timePlace = { runs: 0, calls: 0, promptTokens: 0, completionTokens: 0 };
  for (const name of (await readdir(join(novelDir, "timeplace")).catch(() => [] as string[])).filter((file) => /^(run|strands|tree)-.*\.json$/.test(file))) {
    const usage = (JSON.parse(await readFile(join(novelDir, "timeplace", name), "utf8").catch(() => "{}")) as { usage?: { workCalls?: number; promptTokens?: number; completionTokens?: number } }).usage;
    if (!usage?.workCalls) continue;
    timePlace.runs++;
    timePlace.calls += usage.workCalls;
    timePlace.promptTokens += usage.promptTokens ?? 0;
    timePlace.completionTokens += usage.completionTokens ?? 0;
  }
  return { extraction, timePlace };
}
