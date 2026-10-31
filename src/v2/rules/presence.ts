/** Presence (matter in a scene): someone is there who speaks, acts or is spoken to; someone only named or described is not. */
export const PRESENT_HOW: ReadonlySet<string> = new Set(["speaks", "acts", "addressed"]);
export const isPresent = (person: { how: readonly string[] }) => person.how.some((how) => PRESENT_HOW.has(how));
