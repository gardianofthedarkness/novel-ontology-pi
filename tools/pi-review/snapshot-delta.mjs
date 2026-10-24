const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safe = key => !['__proto__', 'prototype', 'constructor'].includes(key);

export function snapshotChanges(previous, current, path = []) {
  if (previous === current) return [];
  if (object(previous) && object(current)) {
    return [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(safe).flatMap(key =>
      Object.hasOwn(current, key) ? snapshotChanges(previous[key], current[key], [...path, key]) : [{ path: [...path, key], remove: true }]);
  }
  if (JSON.stringify(previous) === JSON.stringify(current)) return [];
  return [{ path, value: current }];
}

export function applySnapshotChanges(previous, changes) {
  const apply = (current, path, change) => {
    if (!path.length) return change.value;
    const [key, ...rest] = path;
    if (!safe(key)) throw new Error('Invalid live snapshot path');
    const result = { ...current };
    if (change.remove && !rest.length) delete result[key];
    else result[key] = apply(current?.[key], rest, change);
    return result;
  };
  return changes.reduce((current, change) => apply(current, change.path, change), previous);
}
