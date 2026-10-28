import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { runIdentityAfterApply } from "../../../solidifier/identity/afterApply.js";
import { openIdentityPackets } from "../../../solidifier/identity/afterApply.js";
import { castScope, loadCast, STANDALONE } from "../../../solidifier/identity/cast.js";

/** `novel em show <book>`: the book's place in the universe's shared character list, and identity matches awaiting review. */
export async function emShow(novelDir: string, env: NodeJS.ProcessEnv = process.env) {
  const scope = await castScope(novelDir, env);
  const cast = await loadCast(scope);
  const mine = cast.persons.filter((person) => person.members.some((member) => member.sourceId === scope.sourceId));
  const open = await openIdentityPackets(scope, scope.sourceId);
  const review = (packetId: string) => scope.universeId === STANDALONE ? `novel review show <book> ${packetId} --scope book` : `novel review show <library> ${packetId} --scope universe --universe ${scope.universeId}`;
  return {
    universe: scope.universeId, book: scope.sourceId, books: scope.books.length,
    persons: cast.persons.length, inThisBook: mine.length,
    sharedWithOtherBooks: mine.filter((person) => person.members.some((member) => member.sourceId !== scope.sourceId)).length,
    merges: cast.merges.length, distinct: cast.distinct.length,
    review: open.map((packet) => ({ packetId: packet.id, proposals: packet.proposals.length, decided: packet.decisions.filter((decision) => decision.verdict !== "hold").length, next: review(packet.id) })),
    people: mine.slice(0, 200).map((person) => ({ id: person.id, name: person.name, forms: person.forms.map((form) => form.text).slice(0, 8), books: [...new Set(person.members.map((member) => member.sourceId))].length })),
  };
}

/** `novel em sweep <book>`: universal EM over every character of the book (also brings the book into the shared list). */
export async function emSweep(novelDir: string, options: { limit?: number; env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env;
  return runIdentityAfterApply({ novelDir, decisions: jevFromEnv(env), all: true, limit: options.limit, env });
}
