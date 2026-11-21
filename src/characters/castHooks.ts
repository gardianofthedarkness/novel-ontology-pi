// The world's figures follow the cast: once story-graph's cast review saves a cast (merges, people kept apart), each person's
// 3D figure is settled again (figures.ts). Imported for its effect wherever this repository runs a cast review.
import { castHooks } from "story-graph/dist/src/universe/identity/hooks.js";
import { settleFigures } from "./figures.js";

if (!castHooks.afterCastSaved.includes(settleFigures)) castHooks.afterCastSaved.push(settleFigures);
