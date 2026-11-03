// L18 · Destruction as a smoothed state (docs/v2/directing/L18-L19-plan.md; the user, 2026-11-03: "the destruction of
// building, is also quantum and back propagatable"). Each blast a run applied is a hidden variable: when it happened (a
// card of its container, up to the one that told it) and how big (the sizes Jev was offered). Its observations:
//   the telling card   the reading's sureness that this card breaks something, at that card; the rest spread over the
//                      cards before it (the text may tell a break after it happened)
//   its size           Jev's whole answer over the four spheres
//   failed walks       a walk that found no way, on an earlier card, whose line passes within the blast's sphere: had the
//                      blast come first, the rubble would have opened that way (tunnelling read backward); as strong as
//                      the move was sure (the likelihood ratio 1 / (1 − sure))
// The posterior over (card, size) is their product; the smoothed blast is its most likely pair, and moves only as far as
// the evidence asks (least change: with no failed walk near it, it stays where it was told at Jev's size). Pure: a run's
// page and record in.

const decoderOf = world => node => { const i = node % world.NX - world.oi, j = Math.floor(node / world.NX) % world.NZ - world.oj, k = Math.floor(node / (world.NX * world.NZ)) - world.ok; return { x: (i + 0.5) * 2, z: (j + 0.5) * 2, y: k * 3 }; };
/** Distance in the plane from a point to the segment a–b. */
const toSegment = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz, t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length)) : 0; return Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z); };
/** How sure a move was: the percentage its reason states (the digest's "… 80%)"), else even. */
const sureOf = move => { const match = String(move.why ?? move.digest ?? '').match(/(\d{1,3})%\)/); return match ? Math.min(0.99, Number(match[1]) / 100) : 0.5; };

/**
 * Every blast of a run smoothed: { container, told, atCard, r, sizes, earlier (the posterior's share before the told
 * card), evidence (failed walks weighed) }. `page.world` decodes the failed walks' nodes.
 */
export function smoothBlasts({ page, record }) {
  const decode = page?.world ? decoderOf(page.world) : null, out = [];
  for (const scene of record.scenes ?? []) {
    const cards = scene.cards ?? [];
    cards.forEach((card, told) => {
      const hit = card.hit;
      if (!hit?.centre || hit.smoothed) return;
      const sizes = Object.entries(hit.sizes ?? { [hit.across]: 1 }).map(([across, p]) => ({ r: Number(across) / 2, p: Math.max(1e-3, p) }));
      const sure = Math.min(0.99, Math.max(0.5, hit.sure || 0.5)), before = told;
      // Failed walks on earlier cards of the container, each its card and how near its line passes the blast.
      const failed = decode ? cards.slice(0, told).flatMap((other, k) => (other.moves ?? []).filter(move => !move.moved && ['NO_PATH', 'OFF_WALK'].includes(move.code) && move.replay?.from !== undefined && move.replay?.targets?.length).map(move => {
        const from = decode(move.replay.from), to = decode(move.replay.targets[0]);
        return { card: k, gap: toSegment(hit.centre, from, to), ratio: 1 / (1 - sureOf(move)) };
      })) : [];
      // The posterior over (card, size), in logs.
      const scores = [];
      for (let t = 0; t <= told; t++) for (const size of sizes) {
        let score = Math.log(t === told ? sure : (1 - sure) / Math.max(1, before)) + Math.log(size.p);
        for (const walk of failed) if (t <= walk.card && walk.gap <= size.r) score += Math.log(walk.ratio);
        scores.push({ t, r: size.r, score });
      }
      const top = Math.max(...scores.map(entry => entry.score)), total = scores.reduce((sum, entry) => sum + Math.exp(entry.score - top), 0);
      const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
      out.push({ container: scene.scene, told: card.card, atCard: cards[best.t].card, cardsEarlier: told - best.t, r: best.r, toldR: hit.across / 2, centre: hit.centre,
        earlier: Math.round(scores.filter(entry => entry.t < told).reduce((sum, entry) => sum + Math.exp(entry.score - top), 0) / total * 1000) / 1000, evidence: failed.filter(walk => walk.gap <= Math.max(...sizes.map(size => size.r))).length });
    });
  }
  return out;
}
