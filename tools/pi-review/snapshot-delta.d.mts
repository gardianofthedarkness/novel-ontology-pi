export interface SnapshotChange { path: string[]; value?: unknown; remove?: boolean }
export function snapshotChanges(previous: unknown, current: unknown): SnapshotChange[];
export function applySnapshotChanges(previous: unknown, changes: SnapshotChange[]): unknown;
