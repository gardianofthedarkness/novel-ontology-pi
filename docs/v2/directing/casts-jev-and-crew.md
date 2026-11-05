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

## The anime studio, and the cut (the user, 2026-11-04: "rephrase and redefine our faculty to director map list entirely into the industry standard ... anime scripting and key animator workflows ... optimize the topology of our current cut")

An anime episode goes: series composition (シリーズ構成) → script (脚本) → settei (設定: model sheets, art boards) →
storyboard (絵コンテ: numbered cuts, each with its picture, action and camera, dialogue, and seconds+frames) → layout
(レイアウト: per cut, the frame and the characters on the background, approved by the episode director and the animation
director) → key animation (原画: key poses and the timesheet) → the animation director's corrections (作画監督) →
in-betweens (動画) → background art (美術) → photography (撮影) and edit. A cut (カット) is one shot, edit point to edit
point; everything after the storyboard is organised by cut number.

**Proposed names** (ours → the role that does that job): director.mjs → episode director (演出); the user and the rules
→ series director (監督); Generalist → script supervisor (synopsis, continuity log); the gate → the 1st AD's breakdown
routing; Scale → storyboard (with the DP); Journeys → blocking; Choreography → action director; Conversation →
dialogue coverage; Ambience → background action (モブ); spawn → layout; Jev in the run → key animator; the path
integral → in-betweener; the laws and smoothing → animation director (continuity); terrain → art (美術); review pins →
retakes (リテイク); the host → production desk (制作進行); strands and the story clock → composition; the chart, places
and things → settei.

**Proposed levels**: episode (a volume) › **sequence** (the tiler's scene pass: place, time, viewpoint, kept as a
heading; today dropped) › scene (the unit: one kind of action, the breakdown every department reads) › **cut** (one
camera setup, made by a storyboard step: shot size, angle, movement, seconds, who is in frame; today only implicit in the
cards) › keys (Jev) › in-betweens (the walks). And: layout per cut checked (L1, L6, L11) before any key; one continuity
owner for presence, the laws, smoothing and review pins, retakes by cut; a cut's seconds as its timesheet.

Sources (anime): [Anime Herald, storyboarding](https://www.animeherald.com/2025/10/25/the-unseen-art-of-anime-storyboarding/);
[SIGGRAPH Asia 2021, Japanese animation](https://history.siggraph.org/wp-content/uploads/2025/09/2021-SA_Courses_Japanese-Animation-in-2021-To-CG-or-not-CG.pdf);
[Kanzenshuu, process](https://kanzenshuu.com/animation-production/process);
[Gengaland, terminology](https://gengaland.blogspot.com/2021/11/anime-staff-production-terminology.html);
[ANN, credits guide](https://www.animenewsnetwork.com/feature/2016-08-17/your-ultimate-guide-to-anime-ending-credits-part-iv/.105472);
[Sakugabooru, scripting](https://blog.sakugabooru.com/2017/07/05/the-pre-production-of-anime-2-scripting/);
[Japan Expo, storyboard](https://www.japan-expo-paris.com/en/actualites/storyboard-a-fundamental-stage-in-making-an-anime_104871.htm);
[Wikipedia, exposure sheet](https://en.wikipedia.org/wiki/Exposure_sheet);
[Atrium, decoding anime production](https://atriumdotart.substack.com/p/decoding-anime-production).

## The runtime workflow (the user, 2026-11-04: "runtime casts workflow ... model the workflows into strands and nodes. Check what is the industry standard")

**Industry practice.** Anime moves each cut, by its number, through storyboard → layout → layout check (episode director,
then animation director) → background ordered from the approved layout → rough keys → finished keys → key check →
in-betweens → check → photography → rush check → retakes; the production desk (制作進行) carries it from desk to desk.
CG trackers (ShotGrid, Kitsu) model the same as a graph: assets built once and cast into shots; per shot, tasks of
standard types with upstream and downstream dependencies; statuses Todo → WIP → Waiting for approval → Done or Retake
(Done lets the next task start; retakes are counted); hand-offs as published versions, read downstream only once published.

**Ours, proposed.** Assets are the settei and the art (people, things, the terrain), built before any cut. Each **cut is a
node** with a chain of tasks: layout (the cut's cast placed; reads the storyboard cut, the casting, the previous cut's end
on its strand, the art) → frame (the photographer: window, angle, a pan's path; Jev where the plan does not fit) → layout
check (L1, L11; retake to layout or frame) → keys (the key animator, Jev, its picture the frame, its options inside the
frame or "leaves frame toward …") → key check (L6, L10) → in-betweens (the path integral) → reframe (still in frame:
follow or widen within the cut's movement; leaves it: a new cut, a retake of the storyboard) → photography → rush check
(the laws). Every task has a status (waiting, ready, in progress, checking, done or retake) and publishes a version; a
retake records the law that failed and keeps the version before it. **Nobody is in the loop** (the user, 2026-11-04:
"user is never on the loop. Everything automatic"): every check is a law or a geometry test; a task gets at most two
retakes, then the desk keeps the version that broke the fewest laws, marks it passed with faults, and the cut moves on.
A main agent may later be called where a check cannot decide; there is none for now. Notes written after a run feed the
next run, never the one in progress. **Strands order the nodes**: a cut waits for the last earlier cut that cast each of its people; cuts on strands
with no one in common run side by side. The **production desk** (the host, the run manager) schedules the ready tasks,
keeps the Jev budget, counts retakes per cut and per role, and draws the timeline.

**Built** (world-engine/director/workflow.mjs, wired into director.mjs; each run writes `runs/<run>/workflow.json`, its
summary in run.json's `workflow`). Every storyboard cut is a node; at its first card the layout (the cast as they stand)
and the photographer's frame (centred on the cast, as wide as the shot size, never cutting anyone off) are published and
the layout check runs: two on one cell step apart (L11), a shot size that cannot hold its cast tightens on the card's
lead; each fault retaken automatically, at most twice. The key animator's pictures are the frame (a still camera's: a
pan, track, crane or handheld camera follows), its arrows say which way leaves the frame, and its spots are the ones in
the frame plus one "leaves the frame toward …"; a "none" goes on to the map along the arrow as before. After the
in-betweens the reframe holds, follows (a camera that moves), lets someone exit frame, or splits the cut where the one
who left acts or speaks again in it (a storyboard retake, `cut_…~2`). The camera is the frame's. The key check (L6, L10)
and the rush check (every law the card holds) record their faults but cannot retake yet, so faults pass with faults.
Still to do: cuts of different waves played side by side, and the debugger's timeline of tasks.

**Key retakes** (4cfeefb; the user, 2026-11-04: "let's implement the retake"). The key check (the animation director's)
runs right after the keys: a key with no way there (L10) or that puts its mover where the script supervisor's sure notes
say they are not (L14) is sent back when Jev made it. The mover is put back where they stood (position, the card's walk,
its moves and laws rolled back) and the key animator is asked again with a retake note (what was chosen, why it failed),
the failed spots or directions no longer offered and staying a choice; at most two retakes, then the attempt with the
fewest faults is kept (its state restored). A key made by rule (a graded step, a journey, a follower) passes as it is.
First quarter, stand-in: 6 cards retaken (12 retakes), 1 fixed, 5 passed with their first attempt kept; 27 more Jev
calls (109 → 136, +25%). The stand-in ignores the note and answers by its call count, so only a paid run can say how often
a retake fixes a key; and every extra question shifts the stand-in's later answers (L6 2 → 6, all in unit 64, long after
the retakes), which is the stand-in's, not the world's.

First quarter, stand-in rehearsal (e677904 against 909265b): laws unchanged (L6 2, L9 1, L10 1), jumps 11 → 9, 222
moves (212); 146 cuts in 90 waves (cuts in one wave share no one), 12 layout retakes (8 two on one cell, 6 tightened
shots), all passed; reframes 139 held, 21 exits frame, 6 followed, 5 new cuts; 1 key check and 5 rush checks passed with
faults (L14 3, L6 2, L9 1).

Sources: [Mynavi, anime workflow](https://news.mynavi.jp/article/20170405-actf2017_03/2);
[MHLW, animation production](https://www.mhlw.go.jp/content/11901000/001152417.pdf);
[ShotGrid, pipeline steps](https://help.autodesk.com/cloudhelp/ENU/SG-Producer/files/pr-scheduling-tasks/SG_Producer_pr_scheduling_tasks_pr_tasks_pipeline_steps_html.html);
[ShotGrid, step dependencies](https://community.shotgridsoftware.com/t/pipeline-step-dependencies/4351);
[Kitsu, statuses](https://kitsu.cg-wire.com/configure-kitsu/);
[CGWire, shot casting](https://blog.cg-wire.com/cg-pipeline-shot-casting/);
[Pixune, VFX pipeline](https://pixune.com/blog/vfx-pipeline/).
