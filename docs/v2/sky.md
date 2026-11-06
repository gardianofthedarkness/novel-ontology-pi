# The story sky: time of day and weather from the text

The user, 2026-11-05: *"should we build a Calendar weather system that unifies time change to theme change + weather
change implicitly said in text?"*; *"build it now while W12 runs"*.

Before it, two systems named the time of day and neither joined the other: story time (the time lexicon's nine parts of the
day and clock times, one per period, inherited by its units: 146 of vol 1's 286 units) and the sequence headings (Jev, a
time of day per sequence: 29 of 47 unclear). Nothing read the weather from the text; only the stills cast read it off the
book's pictures.

## One sky per unit

[world-engine/digest/sky.mjs](../../world-engine/digest/sky.mjs) gives each unit a time of day (dawn, morning, midday,
afternoon, evening, night, late night, unclear) with its hour, and a weather (clear, cloudy, rain, sleet, snow, fog,
storm, unknown), its strength and the wind, with whether snow lies, each with where it came from and how sure. The sky is the city's at a story moment:

- **Time of day, strongest first:** a clock time; the unit's own time words (the time tree, not inherited); the sequence's
  heading; the stills cast's picture; Jev's reading of the sequence's implicit cues; the period's part of the day; the hour
  between the parts round it on its date. A unit's own words against its heading (more than four hours apart) are kept and
  told (`conflict`; vol 1: 16).
- **Weather, strongest first:** the unit's own weather words; its picture; Jev's reading; carried on.
- **Carried and smoothed:** settled weather (snow, clear, cloud, fog) carries through the date, a passing one (rain, a storm)
  only through its own sequence, and when it passes the settled one comes back; never into or out of a flashback. Snow once
  fallen lies for the rest of the day (until rain). A weather the neighbours on both sides agree against, said less surely
  than 0.7, is theirs.
- **Weather words kept conservative:** figures of speech are no weather (vol 1: "a boat in wind and rain", "a rain of glass
  and scrap iron", a gloomy face read as overcast). What the words leave implicit (white breath, snow on shoulders, the
  light), Jev reads by the sequence.

[experiments/v2/sky.mjs](../../experiments/v2/sky.mjs) asks Jev, four sequences a request, the time of day, the weather (its
kind, strength and wind) and whether snow lies, from each sequence's lines that tell its surroundings (cached, cents), and writes `<reading>/v2/sky.json`.

Vol 1 (library 15, 12 Jev requests): snow 92 units (the 24th's night, falling again at its end), clear 190 (from "an
unusually clear winter blue sky"), a storm in 4 (one sequence: "the storm has come", Jev reading a crowd of students
storming in as weather; it passes with its sequence); snow lying all day. Time of day: 80 units by heading, 73 by period, 53
by Jev, 78 between, 2 by their own words.

## The weather, general

The user, 2026-11-05: *"make the weather system general and manually test out all combination view style of combination
of time and weather by researching traditional gaming weather system design"*.

How games do it: a weather is a **state** (GTA's are named presets: extra sunny, clear, clouds, overcast, foggy, raining,
thunder, light snow, snow, blizzard), and each state is a set of **target parameters** (cloud cover, precipitation and its
amount, fog density, wind) that the look eases toward over a transition, keyed against the time of day's own keys (GTA's
timecycle keeps one set of light keys per weather per hour). Wind is one shared input (rain's slant, snow's drift, blowing
snow). Lightning is an event a storm fires at random. Wet ground is darker (a wet road's albedo falls to about a third).
Fog, rain and snow close the view, and more so at night.

So the reading names a weather by **kind, strength and wind**, and the world draws any of them from the same parameters:

- **Kinds:** clear, cloudy, fog, rain, sleet, snow, storm (thunder; a blizzard is heavy snow in a gale, not a storm).
- **Strength:** light, moderate, heavy (a drizzle, rain, a downpour; a few flakes, snow, thick snow; mist, fog, dense fog;
  a few clouds, cloudy, overcast). From the words (escaped in sky.mjs: heavy rain, light rain, drizzle, heavy snow, a
  blizzard, light snow, dense fog, thin mist, dark clouds, partly cloudy), else Jev's for the same weather.
- **Wind:** calm, breezy (a cold wind, wind and snow), a gale (a fierce or strong wind, a blizzard, a rainstorm in a gale).

strand-demo.html's `WEATHER_LOOK` gives each kind and strength its targets on eight parameters, every one 0 to 1:

| parameter | what it draws |
| --- | --- |
| cloud | the sky toward the overcast grey of its hour (light by day, warm grey at dawn and dusk, near black at night), the sun dimmer, the light flatter |
| rain | how many streaks fall (up to 2,400), lit by the hour |
| snow | how many flakes fall (up to 3,600), bluish at night |
| fog | visibility closing in round what the camera looks at (the same at every zoom), the sky whitened by day |
| wind | rain's slant, snow's drift and sway; in snow it raises the fog (blowing snow) |
| lightning | a flicker at random (3 to 12 s apart, more often the stronger) lighting the sky and the city |
| wet | the ground darker (a multiply over it) |
| lying | a sheet of snow on the ground, white by day, blue-grey by night |

A unit's weather said less surely is drawn fainter (its parameters times its sureness up to 0.6). The look eases toward a
new weather over about two seconds, the light toward a new hour faster. The title's line says the sky in words (late
night · heavy snow · a gale · snow on the ground). A page taking Jev's pictures stays at night, with no weather.

`window.__sky({ hour, weather, strength, wind, lying })` holds a sky whatever the unit (`__sky(null)` gives the story's
back, `__sky({ strike: true })` strikes lightning); every time of day by every weather was shot from one camera with it
and looked at (dawn, morning, midday, afternoon, evening, night, late night by clear, partly cloudy, overcast, mist, fog,
drizzle, rain, heavy rain, a storm and its lightning, sleet, light snow, snow, a blizzard, and snow lying under a clear
sky).

## Clouds, and holes torn in them

The user, 2026-11-05: *"is there an destructible cloud system available yet?"*; *"in this book there are cases where beam
weapons clears its diameter of clouds"*; *"It's ok other books. You need to prepare these situations to happen."* (Vol 1
of the four in the snapshot never says it; vol 4's blue-white blade across the Los Angeles night sky is the nearest.)

- **The layer.** strand-demo.html draws a cloud layer at 420 m, as much of the sky as the weather's `cloud` covers (a few
  clouds at 0.3, most of the sky at 0.6, all of it at 0.9), from noise that drifts with the wind. It is lit by the hour
  (white by day, toward the sun's colour at dawn and dusk, the city's glow underneath at night, darker the thicker, lit by
  lightning) and fades into the haze toward the horizon; from inside or above it the city shows, not its underside. By
  day its shadows fall on the ground along the sun, clearest under scattered clouds.
- **What tears it.** A beam through the clouds, said two ways, in any book:
  - a fight's exchange whose "breaks" words name the clouds (the action director's reading, now prompted for "the
    clouds a beam tears through"): the director gives that blow `clouds: true`, and a beam fired at the sky with no one
    to hit becomes a blow from its attacker alone (`world-engine/director/director.mjs`, `SKY.cutsClouds`);
  - a unit's own words (`sky.mjs` `cloudCut`: the cloud layer, a sea of clouds, dark clouds, clouds, pierced, torn open,
    split, blown apart, scattered, a hole; never "vanished like smoke and clouds", "above the clouds"), with the width when
    the text gives a diameter in metres or kilometres. sky.json carries it as `cloudCut`.
- **The hole.** The beam plays on from where it lands up into the layer and clears a hole as wide as it (120 m when
  nothing says), its edge ragged. The hole drifts with the clouds and closes as the story goes on (gone after six units
  or an hour and a half of story time; only at the same place and on the same date). By day the sun comes through it: no
  shadow under it, a faint shaft and a lighter patch on the ground. A unit that says the clouds were torn with no beam
  played opens the hole over what the camera looks at.
- **Checked** from one camera, every cover (a few clouds, cloudy, overcast, a storm) by dawn, midday, dusk and night,
  over the city and toward the horizon, a 160 m hole in cloudy and overcast skies from the city, the horizon and high
  above, and a beam rising through an overcast sky at midday and dusk: `window.__sky({ cut: <metres> })`,
  `__sky({ ..., cutBeams: true })`.
- **Lightning** strikes 3 to 12 seconds apart (the interval had been taken in seconds against a clock in milliseconds, so
  after the first strike a storm flashed on every frame).

## Cloud types by the weather (the user, 2026-11-06: "first building the weather based clouds, and leave the rest in design for now")

Each weather's clouds are of their kinds, at their heights: a low layer and, where the weather has one, a high one, each its
own sheet in `strand-demo.html` (`CLOUD_TYPES`, `CLOUD_PLAN`, `cloudPlan`).

| Type | Drawn base | Its look | Real base |
| --- | --- | --- | --- |
| cumulus | 650 m | puffs: small, billowing, sharp-edged | 0.6 to 2 km |
| stratocumulus | 500 m | a deck of rolls drawn out along the wind | 0.5 to 2 km |
| stratus | 330 m | a flat grey sheet, soft-edged | 0.1 to 0.5 km |
| nimbostratus | 270 m | the rain deck: thick, dark, all but unbroken | 0.3 to 1 km |
| cumulonimbus | 520 m | a storm's heaped cloud, dark-based | 0.5 to 2 km, up past 10 km |
| fog | 160 m | cloud down to the ground (with the haze) | the ground |
| altostratus | 1,300 m | a thin grey veil above | 2 to 7 km |
| anvil | 1,600 m | a storm's spread top | 8 to 12 km |
| cirrus | 1,900 m | high wisps drawn out along the wind | 6 to 12 km |

The drawn heights are compressed to stay within the view (a layer at 7 km would lie past the camera's reach and its haze);
the order and the gaps between the layers are kept.

| Weather | light | moderate | heavy |
| --- | --- | --- | --- |
| clear | cumulus 0.12 + cirrus 0.2 | cumulus 0.18 + cirrus 0.22 | cumulus 0.18 + cirrus 0.25 |
| cloudy | cumulus 0.35 + cirrus 0.3 | stratocumulus 0.6 + altostratus 0.35 | stratus 0.85 |
| fog | fog 0.4 | fog 0.5 | fog 0.6 |
| rain | stratocumulus 0.6 + altostratus 0.4 | nimbostratus 0.75 | nimbostratus 0.92 |
| sleet | stratocumulus 0.6 + altostratus 0.3 | nimbostratus 0.72 | nimbostratus 0.85 |
| snow | stratocumulus 0.45 + altostratus 0.3 | stratus 0.6 | nimbostratus 0.8 |
| storm | cumulonimbus 0.85 + anvil 0.5 | cumulonimbus 0.95 + anvil 0.6 | cumulonimbus 1 + anvil 0.7 |

- **A type's look:**
  - the size of its features;
  - how far it is drawn out along the wind;
  - how soft its edges are, and its small detail;
  - its opacity;
  - how dark its thick parts are (a rain deck's, a storm's base);
  - how much it billows.
- **Changes of weather:** one type eases into the next (each parameter, and the layer's height), at once when the look is
  snapped.
- **Shared by both layers:**
  - the light by the hour;
  - the drift;
  - the holes a beam tears: a beam to the sky goes through both.
- **The low layer's alone:**
  - the ripples;
  - the shadows on the ground and the sun's patches;
  - the height a wake is left at.
- **Cover:** the low layer covers at least what the weather's look says (as sure as the reading); fair weather keeps a few
  puffs.
- **Not asked of Jev:** the weather, its strength and the wind are the sky reading's own.
- **Checked:** every weather by every strength from the street looking up, four from far off at the side, three at dusk
  (`~/claude-world-first/rehearsals/clouds-sheets.mjs`). Test hook: `window.__clouds()`.

### Still in design

- **Thickness.** Today a layer is a sheet:
  - a camera or a flight at its height sees it vanish rather than go grey inside it;
  - a storm's towers do not rise.

  The design is a slab of cloud with depth (a ray marched through it, or stacked slices). A camera inside sees grey, a
  flight goes into cloud and comes out above it, and cumulonimbus towers rise kilometres to their anvil.
- **Blasts by their energy.** Today an area blow of 8 m or more sends a ring by a rule, whatever its energy and its height.
  The design reads the blast's energy at the cloud's height:
  - its overpressure falls with distance cubed;
  - past a threshold it rings the layer;
  - past a higher one it punches a hole (as a beam does);
  - very large ones leave a condensation ring and a cap.

  The blasts of this world (at most 32 m across, at street level) would then leave clouds 300 m up alone.
- **The clouds acting on the world:**
  - they shade the sun by their cover and thickness (today only their shadows on the ground);
  - they hide what lies beyond them from the camera that shows Jev the world;
  - a flight through a cloud flies blind, which the director's flight would read.
- **Rain and snow from the clouds:** today they fall round the camera; they would fall from under the low layer's base,
  where it covers.

## Ripples in the clouds (the user, 2026-11-06: "cloud rippling")

The cloud layer has a wave field of its own, as terrain stage 3 plans for water (terrain-levels §4.3), drawn in
`strand-demo.html`:

- **The field:** a height grid of 128 cells a side over 2.4 km, round what the camera looks at. The wave equation runs it,
  each step from the last two, damped, 30 steps a second.
  - It lies quiet (and costs nothing) until something disturbs it.
  - A live field stays where it is; a quiet one follows the camera.
- **Drawn:** a crest thickens the cloud under it and is lit; a trough thins it and is in shade. The ground's cloud shadows
  follow (they read the same density).
- **What disturbs it,** each a ring pushed into the grid:
  - a beam tearing a hole: a ring as wide as the hole, the strongest;
  - a blast's shock rising: an area blow of 8 m or more, a ring of 20 m plus four times its radius, as strong as its size;
  - a lightning strike: a ring near what the camera looks at;
  - anything at the cloud base (a flight through it): a wake, a bump every 0.3 s where it is;
  - a storm or a gale under clouds: bumps at random, stronger in the wind.
- **Not recorded:** the ripples are drawn, never kept. A replay plays the same because what disturbs them (the blows, the
  holes, the flights) is the run's own. Lightning and a storm's bumps are at random.
- **Test hook:** `window.__ripple({ x, z, r, amp })` pushes a ring; `window.__ripple()` says whether the field is live.

## Wired in (the user, 2026-11-06: "wire the weather and daytime system in")

Before, the sky reached a page only inside World · Live: its host reads sky.json beside the reading a run played and
sends it to the page (`tools/pi-review/sim-play.mjs` `directorSky`). And library 16, where the next run plays, had no
sky.json at all. Now:

- **`novel sky build|show <novel-dir> [--dry] [--cache <dir>]`** reads the story sky into sky.json beside the reading
  the director plays (`experiments/v2/sky.mjs`), and shows what it holds.
- **Library 16's sky, read 2026-11-06** (12 requests to Jev):
  - 286 units, all on Dec 24;
  - by time of day: 38 late night, 64 night, 8 morning, 83 midday, 36 afternoon, 57 evening;
  - by weather: 20 heavy snow, 78 snow, 184 clear, 4 heavy storm; snow lying in 282;
  - 16 units where the chapter heading and the time carried on disagree, the heading taken.
  - Read against the book's 46 sequences (it cuts between storylines), it holds: the night block (units 97–125) is Jev's and the gaps between, and the long midday (126–216) is Jev's, the headings' and the gaps between. No second reading needed.
- **Every page the director makes carries the sky** (`data.sky.units`, `SKY.skyForPage`: the flat shape the page plays, the same as the live host sends). A kept page shows the story's time of day and weather on its own; World · Live's own sky message still takes over when it comes.
- **`window.__replay()`** now gives the page's sky as it plays (its hour, light and weather) for checking.
- **Checked:** a page of units 1–6 played at 2 a.m. in heavy snow, snow lying and falling, a little fog (screenshot); before the flat shape, the same page showed lying snow but no snowfall.
