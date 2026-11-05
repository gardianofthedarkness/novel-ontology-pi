# The story sky: time of day and weather from the text

The user, 2026-11-05: *"should we build a Calendar weather system that unifies time change to theme change + weather
change implicitly said in text?"*; *"build it now while W12 runs"*.

Before it, two systems named the time of day and neither joined the other: story time (the time lexicon's nine parts of the
day and clock times, one per period, inherited by its units: 146 of vol 1's 286 units) and the sequence headings (Jev, a
time of day per sequence: 29 of 47 unclear). Nothing read the weather from the text; only the stills cast read it off the
book's pictures.

## One sky per unit

[world-engine/digest/sky.mjs](../../world-engine/digest/sky.mjs) gives each unit a time of day (dawn, morning, midday,
afternoon, evening, night, late night, unclear) with its hour, and a weather (clear, cloudy, rain, snow, fog, storm,
unknown) with whether snow lies, each with where it came from and how sure. The sky is the city's at a story moment:

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

[experiments/v2/sky.mjs](../../experiments/v2/sky.mjs) asks Jev, four sequences a request, the time of day, the weather and
whether snow lies, from each sequence's lines that tell its surroundings (cached, cents), and writes `<reading>/v2/sky.json`.

Vol 1 (library 15, 12 Jev requests): snow 92 units (the 24th's night, falling again at its end), clear 190 (from "an
unusually clear winter blue sky"), a storm in 4 (one sequence: "the storm has come", Jev reading a crowd of students
storming in as weather; it passes with its sequence); snow lying all day. Time of day: 80 units by heading, 73 by period, 53
by Jev, 78 between, 2 by their own words.

## The world's look

World · Live serves it (`play/sky.json`: beside the reading the run played, else the book's `vol-<n>/reading`) and sends it
to the world (strand-demo.html): each unit's hour (the time tree's where the sky has none) drives the daylight keys, and the
weather draws: falling snow (soft round flakes) and rain (streaks) round what the camera looks at, a greyer sky, a dimmer sun
and nearer fog when overcast, a white sheet on the ground where snow lies. The title's line says the sky in words (late
night · snow · snow on the ground). A page taking Jev's pictures stays at night, with no weather.
