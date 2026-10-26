import type { Entity } from "../ontology/types.js";
import { formKey } from "./nameForms.js";

export class IdentityNameIndex {
  private forms = new Map<string, Set<string>>();

  set(key: string, id: string): void {
    const owners = this.forms.get(key) ?? new Set<string>();
    owners.add(id);
    this.forms.set(key, owners);
  }

  owners(key: string): string[] {
    return [...this.forms.get(key) ?? []];
  }

  get(key: string): string | undefined {
    const owners = this.owners(key);
    return owners.length === 1 ? owners[0] : undefined;
  }

  has(key: string): boolean {
    return this.forms.has(key);
  }
}

const labelKey = (value: string): string => value.normalize("NFKC").trim();
const literalMatch = (label: string, value: string): boolean => new RegExp(`^${labelKey(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "u").test(labelKey(value));

export function identityChoices(entities: Entity[], reserved: string[] = []) {
  const unique = [...new Map(entities.map(entity => [entity.id, entity])).values()];
  const index = new IdentityNameIndex();
  const literalOwners = new IdentityNameIndex();
  for (const entity of unique) for (const name of entity.names) {
    index.set(formKey(name.text), entity.id);
    literalOwners.set(labelKey(name.text), entity.id);
  }
  const used = new Set(reserved.map(labelKey));
  const options = unique.filter(entity => entity.names[0]?.text).map(entity => {
    const name = entity.names.find(form => form.kind === "canonical")?.text ?? entity.names[0].text;
    let label = name;
    let ordinal = 0;
    if (index.owners(formKey(name)).length > 1 || literalOwners.owners(labelKey(name)).length > 1 || used.has(labelKey(label))) label = `${name} [${entity.kind}; option ${++ordinal}]`;
    while (used.has(labelKey(label)) || [...index.owners(formKey(label)), ...literalOwners.owners(labelKey(label))].some(id => id !== entity.id)) label = `${name} [${entity.kind}; option ${++ordinal}]`;
    used.add(labelKey(label));
    return { label, entity };
  });
  return {
    options,
    labelFor: (id: string) => options.find(option => option.entity.id === id)?.label,
    resolve: (value: unknown, kind?: Entity["kind"]): Entity | undefined => {
      if (typeof value !== "string" || reserved.some(label => literalMatch(label, value))) return undefined;
      const matches = options.filter(option => literalMatch(option.label, value));
      if (matches.length) return matches.length === 1 && (!kind || matches[0].entity.kind === kind) ? matches[0].entity : undefined;
      const owners = [...new Set([...index.owners(formKey(value.trim())), ...literalOwners.owners(labelKey(value))])].filter(id => !kind || unique.find(entity => entity.id === id)?.kind === kind);
      return owners.length === 1 ? unique.find(entity => entity.id === owners[0]) : undefined;
    },
  };
}
