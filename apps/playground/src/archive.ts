import type { WorldNode } from "./types";

export const KIND_LABEL: Record<WorldNode["kind"], string> = {
  bigEvent: "Event file", character: "Character", location: "Location",
  scene: "Scene", event: "Event", dialogue: "Dialogue", picture: "Picture",
};

export const KIND_COLOR: Record<WorldNode["kind"], string> = {
  bigEvent: "#8ee9d1", character: "#bba7ff", location: "#75caff",
  scene: "#63ddd3", event: "#ffc777", dialogue: "#e6adf4",
  picture: "#ffd166",
};

export function recordColor(node: WorldNode): string {
  if (node.state === "proposed") return "#ffc777";
  if (node.state === "held") return "#91c3e0";
  if (node.lane === "branch" && node.kind === "bigEvent") return "#c9a9ff";
  return KIND_COLOR[node.kind];
}

export function recordStatus(node: WorldNode): string {
  if (node.state === "proposed") return "Proposed";
  if (node.state === "held") return "Held for review";
  return node.lane === "branch" ? "Branch record" : "Canon record";
}
