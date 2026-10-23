import type { FacultyGraphOptions } from "./facultyGraph.js";

export function facultyOptionsFromEnv(env: NodeJS.ProcessEnv): FacultyGraphOptions {
  const dialogueScope = env.NOVEL_DIALOGUE_SCOPE?.trim() || "scene";
  if (dialogueScope !== "scene" && dialogueScope !== "block-turn") {
    throw new Error("NOVEL_DIALOGUE_SCOPE must be scene or block-turn");
  }
  return { dialogueScope };
}
