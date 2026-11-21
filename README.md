# novel-ontology

The world engine for a novel series: it builds the places a story happens in (cities, streets, buildings, rooms), stands
its people in them scene by scene, and plays each book through with a director, so that every character has a position in
a world that stays the same across volumes.

It stands on **[story-graph](https://github.com/gardianofthedarkness/story-graph)**, which reads the books (scenes, who is
there, story time, places in the text), finds each person across volumes and gives the characters their memories, cards and
a mind to answer as them. What this repository adds is the world: once a book has run here, story-graph's world agent
shows where everyone stands (`novel/stage/world/spawn.json`).

| Part | Where |
|---|---|
| The volume runner: every step of a book, from the reading to the director's run | `engine/volume` |
| Places, rooms and the place tree | `engine/places`, `engine/workflows` |
| Terrain: city to street, buildings and their floors | `engine/terrain`, `src/world` |
| Where each one starts; casts (what is in use, the set dresser, rides, voices, the book's pictures) | `engine/spawning`, `engine/casts` |
| The director's run, its smoothing and what a book leaves for the next | `engine/director`, `engine/smoother` |
| The live view and the native client | `engine/live`, `engine/render`, `clients/godot` |
| The `novel` command and the server the console talks to | `src/cli`, `src/server` |

The desktop app is **[Novel Console](https://github.com/gardianofthedarkness/novel-console)** (macOS and Windows).

## Develop

Check out story-graph beside this repository (`package.json` takes it as `file:../story-graph`), then:

```sh
(cd ../story-graph && npm install && npm run build)
npm install
npm run build
npm test             # the TypeScript tests
npm run engine:test  # the engine scripts' tests
```

How it works is in the [design document](docs/v3/design.html), and the history is in the [milestones](docs/v3/milestones.html).

## License

MIT.
