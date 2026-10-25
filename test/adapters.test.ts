import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAgentHost,
  listAgentHosts,
} from "../src/adapters/hosts.js";
import { SIMULATE_GROUP } from "../src/cli/commands/simulate/index.js";

test("the adaptor registry covers the three primary hosts", () => {
  const ids = listAgentHosts().map((h) => h.id);
  for (const id of ["pi", "codex", "claude-code"]) {
    assert.ok(ids.includes(id), `${id} registered`);
    assert.equal(getAgentHost(id).status, "specified");
  }
});

test("every host descriptor is installable-shaped", () => {
  const hosts = listAgentHosts();
  assert.equal(new Set(hosts.map((h) => h.id)).size, hosts.length, "ids unique");
  for (const h of hosts) {
    assert.ok(h.skillTargets.length >= 1, `${h.id} has a skill target`);
    for (const t of h.skillTargets) assert.ok(t.path.length > 0);
    for (const c of h.configFiles) {
      assert.ok(["json", "toml", "yaml", "markdown"].includes(c.format), `${h.id} config format known`);
    }
    assert.ok(h.notes.length > 0, `${h.id} carries its research note`);
  }
});

test("the Muse main-agent host is specified with its relay key bridge", () => {
  const muse = getAgentHost("muse");
  assert.equal(muse.status, "specified");
  assert.ok(muse.skillTargets.some((t) => t.path.includes("custom-skills")), "Muse skill target is its custom-skills dir");
  assert.ok(muse.notes.includes("muse-relay"), "notes name the relay key bridge");
  assert.ok(muse.notes.includes("visual"), "notes name the visual-input reviewer advantage");
});

test("an unknown host fails loudly and names the registered hosts", () => {
  assert.throws(() => getAgentHost("no-such-host"), /claude-code/);
});

test("the simulation CLI group exists and is explicitly empty", () => {
  assert.equal(SIMULATE_GROUP.id, "simulate");
  assert.equal(SIMULATE_GROUP.status, "empty");
});
