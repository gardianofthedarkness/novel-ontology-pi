/**
 * Plain data as YAML (the v2 flow's schema and logs): objects as blocks, short lists of scalars inline, strings quoted as JSON
 * (a JSON string is a YAML string), so nothing needs escaping rules of its own. No library: the data is ours and plain.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return /^[A-Za-z_][\w./:-]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value) ? value : JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    if (value.every((item) => item === null || typeof item !== "object") && JSON.stringify(value).length <= 100) return `[${value.map((item) => toYaml(item)).join(", ")}]`;
    return value.map((item) => `\n${pad}- ${toYaml(item, indent + 2).replace(/^\n\s*/, "")}`).join("");
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (!entries.length) return "{}";
  return entries.map(([key, item]) => {
    const name = /^[A-Za-z_][\w-]*$/.test(key) ? key : JSON.stringify(key);
    const body = toYaml(item, indent + 2);
    return `\n${pad}${name}:${body.startsWith("\n") ? body : ` ${body}`}`;
  }).join("");
}

/** A YAML document: the data, without the leading newline. */
export const yamlDocument = (value: unknown): string => `${toYaml(value).replace(/^\n/, "")}\n`;
