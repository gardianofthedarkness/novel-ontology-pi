// The story sky (docs/v2/sky.md; the user, 2026-11-05: "a Calendar weather system that unifies time change to theme change
// + weather change implicitly said in text"). One coarse time of day and one weather for each unit, in fixed types, each
// with where it came from and how sure; what the world's look (strand-demo.html), the calendar and the casts read.
//
// The sky is the city's at a story moment, not a unit's label: it carries on from the moment before (within a date, never
// into or out of a flashback) until the text changes it, and it changes as little as the evidence allows (an isolated
// flicker the neighbours agree against is smoothed away; snow once fallen lies for the rest of the day). Sources, strongest
// first. Time of day: a clock time or time word the unit itself has (the time tree, not inherited), the sequence's heading
// (the reading's Jev), the stills cast's picture, this step's Jev reading of the sequence's implicit cues, the period's
// part of the day (inherited), the hour between the parts round it on its date. Weather: the unit's own weather words,
// its picture, this step's Jev reading, carried on.

/** Parts of the day, each with the hour the world's look keys it at. */
export const DAYPARTS = { dawn: 6, morning: 9, midday: 12.5, afternoon: 15, evening: 18, night: 22, 'late night': 2 };
export const DAYPART_HINTS = { dawn: 'first light', morning: 'morning', midday: 'around noon, the middle of the day', afternoon: 'afternoon', evening: 'dusk, early evening', night: 'night', 'late night': 'past midnight', unclear: 'the text does not say or show' };
export const WEATHERS = { clear: 'clear, or nothing said of the weather that changes it', cloudy: 'cloudy or overcast, grey', rain: 'raining (a drizzle to a downpour)', sleet: 'rain and snow together', snow: 'snowing (a few flakes to a blizzard)', fog: 'fog or mist', storm: 'a storm of the weather: thunder and lightning, a rainstorm in a gale (not a fight, a blast, or a power)', unknown: 'the text does not say or show' };
/** How strong a weather is, and the wind: what the world's look keys besides the kind (a blizzard is heavy snow in a gale). */
export const STRENGTHS = { light: 'light: a drizzle, a few flakes, thin mist, a few clouds', moderate: 'as usual', heavy: 'heavy: a downpour, thick snow, dense fog, a dark overcast' };
export const WINDS = { calm: 'no wind said', breezy: 'a wind, a cold wind', gale: 'a strong wind, a gale' };

/** The time tree's parts of the day (src/digger/timeplace/lexicon.ts), and the headings' (src/v2/extraction/storyboard.ts DAYTIMES), as dayparts. */
export const TO_DAYPART = { dawn: 'dawn', morning: 'morning', noon: 'midday', midday: 'midday', daytime: 'midday', afternoon: 'afternoon', 'after-school': 'afternoon', evening: 'evening', night: 'night', 'late-night': 'late night', 'late night': 'late night' };
export const daypartOfHour = hour => (hour < 4.5 ? 'late night' : hour < 7.5 ? 'dawn' : hour < 11 ? 'morning' : hour < 14 ? 'midday' : hour < 17.5 ? 'afternoon' : hour < 21 ? 'evening' : 'night');

// Weather words (escaped: the repository carries no book text). Snow: falling snow, snowflakes, heavy snow, a snowy night,
// in the snow, wind and snow, a blizzard, a snowstorm; lying: lying snow, snowfield, covered by snow, snowbanks. Rain:
// raining, rainwater, heavy and light rain, a downpour, an umbrella, raindrops, drizzle, fine rain (not "pouring": a pouring rain of fire). Sleet: rain mixed with
// snow, sleet. Fog: fog, dense fog, mist. Cloudy: overcast, dark clouds. Clear: fine, a clear sky, a blue sky. Storm: a
// thunderstorm, thunder, a rainstorm in a gale. (Lightning alone is no weather here: an esper's.)
const WORDS = {
  snow: /\u4e0b\u96ea|\u96ea\u82b1|\u5927\u96ea|\u96ea\u591c|\u96ea\u4e2d|\u98ce\u96ea|\u98d8\u96ea|\u964d\u96ea|\u79ef\u96ea|\u96ea\u5730|\u96ea\u5806|\u767d\u96ea|\u66b4\u96ea|\u5c0f\u96ea|\u7ec6\u96ea/g,
  rain: /\u4e0b\u96e8|\u96e8\u6c34|\u5927\u96e8|\u5c0f\u96e8|\u66b4\u96e8|\u96e8\u4f1e|\u96e8\u6ef4|\u9634\u96e8|\u7ec6\u96e8|\u6bdb\u6bdb\u96e8/g,
  sleet: /\u96e8\u5939\u96ea|\u51bb\u96e8|\u971c\u96ea\u4ea4\u52a0/g,
  fog: /\u6d53\u96fe|\u5927\u96fe|\u96fe\u6c14|\u8584\u96fe|\u8ff7\u96fe/g,
  cloudy: /\u9634\u5929|\u4e4c\u4e91|\u591a\u4e91/g,
  clear: /\u6674\u6717|\u6674\u7a7a|\u84dd\u5929|\u6674\u5929/g,
  storm: /\u96f7\u96e8|\u96f7\u9e23|\u6253\u96f7|\u66b4\u98ce\u96e8/g,
};
// How strong, by kind: heavy (heavy rain, a rainstorm; heavy snow, a snowstorm, a blizzard; dense fog; dark
// clouds) and light (light rain, fine rain, drizzle; light snow, fine snow; thin mist; partly cloudy). The wind: a gale
// (a fierce wind, a strong wind, a blizzard, a rainstorm in a gale) or a wind (a cold wind, a breeze, wind and snow).
const HEAVY = { rain: /\u5927\u96e8|\u66b4\u96e8/, snow: /\u5927\u96ea|\u66b4\u96ea|\u66b4\u98ce\u96ea/, fog: /\u6d53\u96fe|\u5927\u96fe/, cloudy: /\u4e4c\u4e91/ };
const LIGHT = { rain: /\u5c0f\u96e8|\u7ec6\u96e8|\u6bdb\u6bdb\u96e8/, snow: /\u5c0f\u96ea|\u7ec6\u96ea/, fog: /\u8584\u96fe/, cloudy: /\u591a\u4e91/ };
const GALE = /\u72c2\u98ce|\u5f3a\u98ce|\u66b4\u98ce\u96ea|\u66b4\u98ce\u96e8/, BREEZY = /\u5bd2\u98ce|\u5fae\u98ce|\u98ce\u96ea|\u5927\u98ce/;
const LYING = /\u6b8b\u7559[^\u3002\uff0c]{0,6}\u96ea|\u79ef\u96ea|\u96ea\u5730|\u88ab\u96ea\u8986\u76d6|\u96ea\u5806|\u767d\u96ea\u7691\u7691|\u94fa\u6ee1\u4e86\u96ea/;

/** The weather the words of a text say: each kind's count, the strongest kind, and whether snow lies. */
export function weatherWords(text) {
  const counts = Object.fromEntries(Object.entries(WORDS).map(([kind, re]) => [kind, (String(text).match(re) ?? []).length]).filter(([, n]) => n));
  // A storm or snow outweighs clear words in the same unit.
  const order = ['storm', 'sleet', 'snow', 'rain', 'fog', 'cloudy', 'clear'], top = order.find(kind => counts[kind]) ?? null, words = String(text);
  const strength = top && HEAVY[top]?.test(words) ? 'heavy' : top && LIGHT[top]?.test(words) ? 'light' : null;
  const wind = GALE.test(words) ? 'gale' : BREEZY.test(words) ? 'breezy' : null;
  return { counts, top, strength, wind, lying: LYING.test(words) };
}

// Clouds torn: a beam, a blast or a wind through the clouds, in the text (cloud layer, a sea of clouds, dark clouds,
// clouds; pierced, torn open, split, cut open, blown or driven apart, scattered, broken open, a hole) and in a fight's
// "breaks" words (the clouds a beam tears through); never the figures of speech (vanished like smoke and clouds, above the
// clouds, the clouds of the sky as fortune). The width, where the text gives a diameter in metres or kilometres.
const CLOUD = '(?:\\u4e91\\u5c42|\\u4e91\\u6d77|\\u4e4c\\u4e91|\\u4e91\\u6735|\\u4e91)';
const TEAR = '(?:\\u8d2f\\u7a7f|\\u7a7f\\u900f|\\u7a7f\\u8fc7|\\u6495\\u88c2|\\u6495\\u5f00|\\u5288\\u5f00|\\u5207\\u5f00|\\u5439\\u6563|\\u9a71\\u6563|\\u51b2\\u6563|\\u6253\\u6563|\\u7834\\u5f00|\\u88c2\\u5f00|\\u7a9f\\u7abf|\\u6d1e)';
const CLOUD_CUT = new RegExp(`${CLOUD}[^\\u3002\\uff01\\uff1f]{0,8}${TEAR}|${TEAR}[^\\u3002\\uff01\\uff1f]{0,8}${CLOUD}`);
const NOT_CLOUD = /\u70df\u6d88\u4e91\u6563|\u4e91\u7aef|\u4e91\u9704|\u98ce\u4e91|\u4e91\u96c0|\u767d\u4e91\u82cd\u72d7/g;
const CLOUD_WORDS = /\bclouds?\b|\bcloud (?:layer|cover|bank)s?\b|\u4e91\u5c42|\u4e91\u6d77|\u4e4c\u4e91|\u4e91\u6735/i;
const DIAMETER = /\u76f4\u5f84[^\d\u3002]{0,4}(\d+(?:\.\d+)?)\s*(\u516c\u91cc|\u5343\u7c73|\u7c73)/;
/** Whether a text says the clouds were torn (a beam, a blast through them), and how wide when it gives a diameter. */
export function cloudCut(text) {
  const plain = String(text ?? '').replace(NOT_CLOUD, '');
  if (!CLOUD_CUT.test(plain)) return null;
  const across = plain.match(DIAMETER), metres = across ? Number(across[1]) * (across[2] === '\u7c73' ? 1 : 1000) : null;
  return metres ? { width: metres } : {};
}
/** Whether a fight's "breaks" words name the clouds (a beam tearing through them). */
export const cutsClouds = breaks => !!breaks && CLOUD_WORDS.test(String(breaks)) && !/\bno clouds?\b/i.test(String(breaks));

const tailOf = node => String(node ?? '').split(':').slice(3).join(':');
const dateOf = node => String(node ?? '').split(':').slice(0, 3).join(':');

/**
 * Each unit's sky. `reading`: the v2 reading (scenes, time, sequences with headings); `text(id)`: a sentence's words;
 * `jev`: this step's answers by sequence ({ daypart, daypartSure, weather, weatherSure, lying }); `pictures`: the stills
 * cast's notes (pictures.json's pictures).
 */
export function storySky({ reading, text, jev = {}, pictures = [] }) {
  const timeOf = new Map((reading.time?.scenes ?? []).map(entry => [entry.scene, entry]));
  const headingOf = new Map((reading.sequences ?? []).map(sequence => [sequence.id, sequence.heading ?? null]));
  const pictured = new Map();
  for (const note of pictures) { const unit = note.unit; if (!unit) continue; const w = note.weather, t = note.time; pictured.set(unit, { weather: w && w.value !== 'not shown' && (w.sure ?? 0) >= 0.5 ? { value: w.value, sure: w.sure } : null, time: t && t.value !== 'not shown' && (t.sure ?? 0) >= 0.5 ? { value: t.value, sure: t.sure } : null }); }
  const out = {}, scenes = reading.scenes;
  // Pass 1: each unit's own evidence, strongest first.
  for (const scene of scenes) {
    const time = timeOf.get(scene.id), tail = tailOf(time?.node), own = time && !time.inherited, words = weatherWords(scene.sentences.map(text).join(''));
    const heading = headingOf.get(scene.sequence), seq = jev[scene.sequence] ?? null, pic = pictured.get(scene.id) ?? null;
    let daypart = null;
    const clock = /^\d{1,2}:\d{2}$/.test(tail) ? Number(tail.split(':')[0]) + Number(tail.split(':')[1]) / 60 : null;
    const fromTree = TO_DAYPART[tail] ?? null, fromHeading = heading?.daytime && heading.daytime !== 'unclear' && (heading.confidence?.daytime ?? 0) >= 0.6 ? TO_DAYPART[heading.daytime] ?? null : null;
    const fromPicture = pic?.time ? { night: 'night', 'dawn or dusk': 'evening', day: 'midday' }[pic.time.value] ?? null : null;
    const fromJev = seq?.daypart && seq.daypart !== 'unclear' && (seq.daypartSure ?? 0) >= 0.6 ? seq.daypart : null;
    if (clock !== null) daypart = { value: daypartOfHour(clock), hour: clock, by: 'clock', sure: 0.95 };
    else if (own && fromTree) daypart = { value: fromTree, by: 'time words', sure: 0.9 };
    else if (fromHeading) daypart = { value: fromHeading, by: 'heading', sure: heading.confidence.daytime };
    else if (fromPicture) daypart = { value: fromPicture, by: 'picture', sure: pic.time.sure };
    else if (fromJev) daypart = { value: fromJev, by: 'jev', sure: seq.daypartSure };
    else if (fromTree) daypart = { value: fromTree, by: 'period', sure: 0.6 };
    // A unit's own words against its heading (more than four hours apart): kept, and told.
    const others = [fromTree && own ? null : fromTree, fromHeading, fromJev].filter(Boolean);
    const conflict = daypart && others.some(other => Math.abs(DAYPARTS[other] - DAYPARTS[daypart.value]) > 4 && Math.abs(DAYPARTS[other] - DAYPARTS[daypart.value]) < 20) ? others.filter(other => other !== daypart.value) : null;
    let weather = null;
    const jevWeather = seq?.weather && seq.weather !== 'unknown' && (seq.weatherSure ?? 0) >= 0.6 ? seq.weather : null;
    if (words.top) weather = { value: words.top, by: 'words', sure: 0.85 };
    else if (pic?.weather && WEATHERS[pic.weather.value]) weather = { value: pic.weather.value, by: 'picture', sure: pic.weather.sure };
    else if (jevWeather) weather = { value: jevWeather, by: 'jev', sure: seq.weatherSure };
    // Its strength and the wind: the words', else Jev's for the same weather.
    if (weather) {
      const strength = words.strength ?? (jevWeather === weather.value && seq.strength && seq.strength !== 'moderate' ? seq.strength : null), wind = words.wind ?? (seq?.wind && seq.wind !== 'calm' ? seq.wind : null);
      if (strength) weather.strength = strength; if (wind) weather.wind = wind;
    }
    // The clouds torn in this unit: the first sentence that says so.
    let cut = null;
    for (const id of scene.sentences) { const found = cloudCut(text(id)); if (found) { cut = { sentence: id, by: 'words', ...found }; break; } }
    out[scene.id] = { date: dateOf(time?.node), flashback: !!time?.flashback, daypart, weather, lying: words.lying || !!seq?.lying, ...(conflict?.length ? { conflict } : {}), ...(cut ? { cloudCut: cut } : {}) };
  }
  // Pass 2: carried on within a date (never across a flashback); time of day between the parts round it.
  const ids = scenes.map(scene => scene.id);
  ids.forEach((id, k) => {
    const unit = out[id];
    if (!unit.daypart) {
      let before = null, after = null;
      for (let j = k - 1; j >= 0 && !before; j--) if (out[ids[j]].date === unit.date && !out[ids[j]].flashback && out[ids[j]].daypart && out[ids[j]].daypart.by !== 'between') before = out[ids[j]].daypart;
      for (let j = k + 1; j < ids.length && !after; j++) if (out[ids[j]].date === unit.date && !out[ids[j]].flashback && out[ids[j]].daypart && out[ids[j]].daypart.by !== 'between') after = out[ids[j]].daypart;
      const hb = before ? DAYPARTS[before.value] : null, ha = after ? DAYPARTS[after.value] : null;
      if (hb !== null && ha !== null) { const hour = ha > hb ? (hb + ha) / 2 : hb; unit.daypart = { value: daypartOfHour(hour), hour, by: 'between', sure: 0.4 }; }
      else if (hb !== null || ha !== null) unit.daypart = { value: (before ?? after).value, by: 'carried', sure: 0.4 };
      else unit.daypart = { value: 'unclear', by: null, sure: 0 };
    }
  });
  const PASSING = new Set(['rain', 'sleet', 'storm']);
  let carried = null, settled = null, lyingSince = null;
  ids.forEach((id, k) => {
    const unit = out[id], prev = k ? out[ids[k - 1]] : null;
    if (prev && (prev.date !== unit.date || prev.flashback !== unit.flashback)) { carried = null; settled = null; lyingSince = null; }
    // Settled weather (snow, clear, cloud, fog) carries on through the day; a passing one (rain, a storm) only through its
    // own sequence (vol 1: a storm Jev read in one sequence's fight would otherwise have stormed 77 units).
    // When a passing weather ends, the settled one from before it comes back.
    if (unit.weather) { carried = { ...unit.weather, sequence: scenes[k].sequence }; if (!PASSING.has(unit.weather.value)) settled = carried; }
    else if (carried && PASSING.has(carried.value) && carried.sequence !== scenes[k].sequence) carried = settled;
    if (!unit.weather && carried && !unit.flashback) { carried = { ...carried, by: 'carried', sure: Math.max(0.3, Math.round((carried.sure - 0.05) * 100) / 100) }; if (!PASSING.has(carried.value)) settled = carried; unit.weather = { value: carried.value, by: 'carried', sure: carried.sure, ...(carried.strength ? { strength: carried.strength } : {}), ...(carried.wind ? { wind: carried.wind } : {}) }; }
    // Snow once fallen lies for the rest of the day (until rain).
    if (unit.weather?.value === 'snow' || unit.lying) lyingSince ??= id;
    if (unit.weather?.value === 'rain' || unit.weather?.value === 'storm') lyingSince = null;
    unit.lying = !!lyingSince && !unit.flashback;
    if (!unit.weather) unit.weather = { value: 'unknown', by: null, sure: 0 };
  });
  // Pass 3: smoothing: a weather the neighbours on both sides agree against, said less surely than 0.7, is theirs.
  ids.forEach((id, k) => {
    const unit = out[id], a = out[ids[k - 1]], b = out[ids[k + 1]];
    if (!a || !b || unit.weather.sure >= 0.7 || a.date !== unit.date || b.date !== unit.date) return;
    if (a.weather.value === b.weather.value && a.weather.value !== unit.weather.value && a.weather.value !== 'unknown') unit.weather = { value: a.weather.value, by: 'smoothed', sure: Math.min(a.weather.sure, b.weather.sure), was: unit.weather.value, ...(a.weather.strength ? { strength: a.weather.strength } : {}), ...(a.weather.wind ? { wind: a.weather.wind } : {}) };
  });
  // Flat for the world's look: the hour, the weather's kind, strength (moderate unless said) and wind.
  for (const unit of Object.values(out)) { unit.hour = unit.daypart.hour ?? DAYPARTS[unit.daypart.value] ?? null; unit.strength = unit.weather.strength ?? 'moderate'; unit.wind = unit.weather.wind ?? 'calm'; }
  return out;
}

/** What the sky came to: units by daypart and weather, by source, the units with snow lying, the conflicts. */
export function skySummary(units) {
  const tally = (pick) => Object.values(units).reduce((sum, unit) => { const k = pick(unit); sum[k] = (sum[k] ?? 0) + 1; return sum; }, {});
  return { dayparts: tally(unit => unit.daypart.value), daypartBy: tally(unit => unit.daypart.by ?? 'none'), weathers: tally(unit => unit.weather.value), strengths: tally(unit => `${unit.strength ?? 'moderate'} ${unit.weather.value}`), winds: tally(unit => unit.wind ?? 'calm'), weatherBy: tally(unit => unit.weather.by ?? 'none'), lying: Object.values(units).filter(unit => unit.lying).length, conflicts: Object.values(units).filter(unit => unit.conflict).length, cloudCuts: Object.values(units).filter(unit => unit.cloudCut).length };
}
