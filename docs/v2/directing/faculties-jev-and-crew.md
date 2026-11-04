# Faculties as Jev's, and the film crew they resemble (2026-11-04)

The user, 2026-11-04: "list all faculties that you think can be converted to jev because we could derive a discrete list
of possible outputs ... test their performance against a work llm ... research real standard film team industry
recommendation so we can adapt real management structure. I feel like faculties are like translator who reads the original
novel and write a team director executable script, including cameraman angle suggestions."

## Which faculties are picks from fixed lists

| Faculty | What it answers | Lists | As Jev's |
|---|---|---|---|
| Scale | frame, one move's reach, angle, duration (and whose eyes) | referents 8, angles 6, durations 4 | **whole**, a question each per unit |
| Ambience | the crowd's size and state, each time it changes | sizes 5, states 5 | **whole**, per unit (or per change) |
| Conversation | each line's channel; the group's formation; who looks at whom | channels 9, formations 8; the cast | **whole**, per spoken line and per unit |
| Choreography | each exchange: attack, shape, range, outcome, condition, knockback | 10, 7, 5, 5, 6; referents | **the labels**, once the lines with an exchange are found (a yes/no per line first) |
| Journeys | who goes, how, how far, to where | manners 9, referents; the places offered | **partly**: manner and distance whole; the destination a pick among the places offered, or "not one of them" |
| Generalist | summary, memory, where; per line moves, facts, items, talk, breaks | motions 4, hows 7, fact kinds 9, item events 8, talk 4 | **no** for the summary and memory (free text, what the others read); the per-line labels could be, but there are many per line |

## Jev against the work model (first quarter, units 1–84)

`experiments/v2/faculty-jev.mjs` asked Jev scale, ambience and the talk channel with the work model's own lists and hints,
over the same units (58 Jev requests). The reference is Claude's labels from the text alone, made before either model's
answers were looked at, each with the answers also acceptable where the text allows more than one
(`~/claude-world-first/rehearsals/faculty-gold-*-q1.json`, not in the repo): scale on 23 units (the units whose work-model
answers had been seen were left out), ambience on its 18 units, the channel on 40 spoken lines.

| | Work model: acceptable (main) | Jev: acceptable (main) | Jev smoothed | Same answer |
|---|---|---|---|---|
| Frame | 18/23 (15) | **20/23 (18)** | 18/23, changes 43% → 20% | 64% |
| Angle | **22/23 (21)** | 18/23 (16) | 22/23, changes 5% | 70% |
| Reach | 14/23 (12) | **17/23 (14)** | 15/23, changes 23% | 38% |
| Duration | **22/23 (17)** | 20/23 (15) | 18/23, changes 20% | 65% |
| Crowd size | 13/18 (9) | 14/18 (8) | | 50% |
| Crowd state | 13/18 (9) | **16/18 (12)** | | 61% |
| Channel | 36/39 (31) | **38/40 (34)** | | 87% |

- Small samples, one labeller: a difference of two or three is not a finding. Neither model is clearly better at scale;
  Jev is ahead on the crowd's state and the channel.
- **Jev's confidence means something**: on the scale answers, acceptable 89% of the time above its median confidence and
  74% below. The work model's "sure" took 6 values on these units.
- **The work model leaves lines out**: it gave no channel for 44 of the 411 spoken lines; Jev answers every question.
- **Neither is smooth.** Both change the frame on 40–43% of neighbouring units and the duration on 53–59%. Jev's
  probabilities let the answers be smoothed: the least-cost path through them with a cost for each change (1.5 nats here)
  halves the changes and keeps the angle at 22/23, at a small cost to frame and duration on this sample.
- Angle: Jev looks "over a shoulder" or "high" more often (eye level 73%, against the work model's 88%); the labels are mostly eye level.

## The film crew (research)

What a production does between a script and a shoot, and who does it:

- **Script breakdown** (the 1st AD, with the department heads): the script cut into scenes and eighths of a page, each
  element tagged by category (cast, extras, props, vehicles, weapons, stunts, effects, locations…); it feeds the schedule,
  the shot list and every department's own breakdown.
- **Shot list and coverage** (the director and the director of photography): each scene's shots before the shoot, said
  in a shared vocabulary of size (ECU, CU, MCU, MS, WS, EWS…), angle and movement. A conversation is covered with a master
  wide, then closer sizes; shot/reverse shot keeps the camera on one side of the line between the speakers (the 180°
  rule).
- **Blocking** (the director with the actors): who moves where, in relation to the camera.
- **Continuity** (the script supervisor): positions of people and things, screen direction, eyelines, shot sizes and the
  axis, shot to shot, above all when scenes are shot out of order.
- **Action** (the stunt coordinator and the fight choreographer): the choreographer designs the action's look, the
  coordinator its safety and logistics; on large films they design sequences for months with previs artists (stuntvis).
- **Background** (the ADs): the 1st AD may direct background action for major shots; the 2nd, 2nd 2nd or 3rd AD cue and
  direct the extras.
- **Previs and techvis**: rough 3D scenes where the director, the DP, the VFX supervisor and the production designer
  settle staging, camera and coverage while changes are cheap; techvis then checks the shots against physical limits.

### What the faculties are, in those terms

The pipeline is a **previs** studio fed by a **script breakdown**: the reading is the screenwriter's scene headings and
the 1st AD's breakdown (units, their kind, place and time, cast, things by category), the faculties are each
department's breakdown pass over it, the director plays it as previs, and the physics laws are techvis.

| Faculty | Its counterpart |
|---|---|
| Generalist | the 1st AD's breakdown and the script supervisor's notes (who is where, carrying what, after each scene) |
| Scale | the director and DP's shot list: size, angle, movement |
| Journeys | blocking across locations (the director, the 1st AD, locations) |
| Choreography | the fight choreographer; the laws are the stunt coordinator's safety pass |
| Conversation | dialogue coverage: master, shot/reverse shot, the axis, eyelines |
| Ambience | the ADs' background action |
| Presence, laws L1, L11 | the script supervisor's continuity |

### What the crew's way would change

1. **A shot list per unit, not a scale per beat.** A DP plans a scene's coverage whole (a master, then closer sizes), so
   neighbouring answers belong to one plan; the smoothing above is the cheap form of this.
2. **The industry's vocabulary for the camera.** Shot sizes (ECU … EWS) and movement (static, pan, tilt, dolly, track,
   crane, handheld) are fixed lists made for this question; the engine can keep measuring a frame by what it spans and
   translate a size to it (a close-up is a person, a wide shot the street).
3. **Coverage by kind of unit.** A conversation: master, then over-the-shoulder pairs on one side of the line (the
   conversation faculty already knows who talks to whom and who looks at whom). A fight: wide for geography, then closer.
4. **A continuity owner.** Today continuity is spread over presence, the laws and the review; a script supervisor's job,
   one record of who is where with what, checked shot to shot, is what L1, L11 and "held is not on stage" each touch.
5. **The breakdown as the one document.** Every department reads the 1st AD's breakdown: faculties.json beside the
   reading is that, and the things rules (weapons, vehicles, named items) are its categories.

Sources: [MasterClass, breaking down a script](https://www.masterclass.com/articles/how-to-break-down-a-script);
[PremiumBeat, the 1st AD](https://www.premiumbeat.com/blog/first-assistant-director-role-and-responsibilities/);
[Wikipedia, script breakdown](https://www.wikipedia.org/wiki/Script_breakdown);
[StudioBinder, shot list abbreviations](https://www.studiobinder.com/blog/shot-list-abbreviations/);
[New England Film, script supervising](https://newenglandfilm.com/?p=10576);
[Yamdu, camera coverage](https://www.yamdu.com/en/learn/preproduction/coverage/);
[PremiumBeat, shooting coverage](https://www.premiumbeat.com/blog/shooting-coverage-film-project);
[StudioBinder, crew positions](https://www.studiobinder.com/blog/film-crew-positions/);
[Vimeo, who does what on a film crew](https://vimeo.com/blog/post/who-does-what-on-a-film-crew);
[StudioBinder, the stunt coordinator](https://studiobinder.com/blog/what-is-a-stunt-coordinator-job-description);
[VFX Voice, stuntvis](https://vfxvoice.com/?p=3123357);
[Wikipedia, assistant director](https://wikipedia.com/wiki/Assistant_director);
[Central Casting, AD roles](https://www.centralcasting.com/spotlight/blog/what-does-an-assistant-director-do-a-guide-to-ad-roles-in-film-and-tv/);
[Wikipedia, previsualization](https://en.wikipedia.org/wiki/Previsualization).
