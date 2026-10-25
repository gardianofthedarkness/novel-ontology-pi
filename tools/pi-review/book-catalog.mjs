/**
 * Minimal browser-safe book catalog: stable catalog ID, readable title and the
 * original source filename basename. Workspaces, metadata directories and
 * absolute source paths never leave the host.
 */
const text = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';

export const sourceBasename = value => text(typeof value === 'string' ? value.split(/[\\/]/).pop() : '', 200);

export function bookCatalog(volumes, catalog = []) {
  return volumes.map(volume => {
    const entry = catalog.find(book => book?.id === volume.id) ?? {};
    const files = [volume.sourceFile, ...(volume.sourceFiles ?? []), entry.sourceFile, ...(entry.sourceFiles ?? []), ...(entry.aliases ?? [])];
    return {
      id: volume.id,
      title: text(volume.title, 200) || text(entry.title, 200) || `Book ${volume.id}`,
      sourceFile: files.map(sourceBasename).find(Boolean) ?? null,
    };
  });
}
