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
