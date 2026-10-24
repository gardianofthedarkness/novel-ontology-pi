import type { FacultyGraphOptions } from "./facultyGraph.js";

export function facultyOptionsFromEnv(env: NodeJS.ProcessEnv): FacultyGraphOptions {
  const dialogueScope = env.NOVEL_DIALOGUE_SCOPE?.trim() || "card";
  if (dialogueScope !== "card" && dialogueScope !== "scene" && dialogueScope !== "block-turn") {
    throw new Error("NOVEL_DIALOGUE_SCOPE must be card, scene or block-turn");
  }
  return { dialogueScope };
}
