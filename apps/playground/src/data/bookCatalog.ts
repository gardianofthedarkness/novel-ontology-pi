/** One assigned book as the viewer may see it: catalog ID, title and the
 * original source filename basename — never a host path. Catalog IDs are not
 * narrative volume numbers. */
export interface BookEntry { id: number; title: string; sourceFile: string | null }
export interface LibrarySnapshot { volume?: number; activeVolume?: number; availableVolumes?: number[]; books?: BookEntry[] }

const validId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;
const basename = (value: unknown) => typeof value === "string" ? value.split(/[\\/]/).pop()?.trim() || null : null;

export function libraryBooks(snapshot: LibrarySnapshot): BookEntry[] {
  const listed = (snapshot.books ?? []).filter((book) => validId(book?.id));
  if (listed.length) return listed.map((book) => ({ id: book.id, title: typeof book.title === "string" && book.title.trim() ? book.title.trim() : `Book ${book.id}`, sourceFile: basename(book.sourceFile) }));
  return (snapshot.availableVolumes ?? []).filter(validId).map((id) => ({ id, title: `Book ${id}`, sourceFile: null }));
}

export const sameBooks = (first: BookEntry[], second: BookEntry[]) => first.length === second.length && first.every((book, index) => book.id === second[index].id && book.title === second[index].title && book.sourceFile === second[index].sourceFile);
export const bookName = (book?: BookEntry | null) => book ? book.sourceFile ?? book.title : "Unknown book";
export const bookOptionLabel = (book: BookEntry) => `#${book.id} · ${book.title}${book.sourceFile ? ` — ${book.sourceFile}` : ""}`;

export function parseBookParam(search: string): number | null {
  const value = new URLSearchParams(search).get("book");
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

/** The book on screen: the reader's pinned book, unless they explicitly follow Pi. */
export const viewedBook = (pinned: number | null, following: boolean, agent: number | null) => following && agent !== null ? agent : pinned;
export const bookQuery = (book: number | null) => book === null ? "" : `?volume=${book}`;
/** A response for another book (stale request, reconnect race) is discarded. */
export const acceptsSnapshot = (requested: number | null, snapshot: LibrarySnapshot) => requested === null || snapshot.volume === requested;
