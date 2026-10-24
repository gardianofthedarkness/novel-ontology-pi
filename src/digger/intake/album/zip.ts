/**
 * Minimal ZIP reader/writer for EPUB import (sector: album).
 *
 * The project rule is embedded/no-hosting with no new runtime
 * dependencies, so this implements just enough of the ZIP format for
 * EPUBs: end-of-central-directory scan, central directory parse, and
 * extraction of stored (0) and deflated (8) entries via node:zlib.
 * `createStoredZip` exists so tests (and tools) can build real,
 * standards-readable EPUB fixtures without a zip dependency.
 */
import { inflateRawSync, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export function listZipEntries(data: Buffer): ZipEntry[] {
  // EOCD is at the end; scan the last 64 KiB + 22 bytes for its signature.
  const scanStart = Math.max(0, data.length - (64 * 1024 + 22));
  let eocd = -1;
  for (let i = data.length - 22; i >= scanStart; i--) {
    if (data.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP file (end-of-central-directory not found)");
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(p) !== CD_SIG) throw new Error(`corrupt ZIP central directory at entry ${n}`);
    const method = data.readUInt16LE(p + 10);
    const compressedSize = data.readUInt32LE(p + 20);
    const uncompressedSize = data.readUInt32LE(p + 24);
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const localHeaderOffset = data.readUInt32LE(p + 42);
    const name = data.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(data: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (data.readUInt32LE(p) !== LFH_SIG) throw new Error(`corrupt ZIP local header for ${entry.name}`);
  const nameLen = data.readUInt16LE(p + 26);
  const extraLen = data.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}

export function readZipText(data: Buffer, entry: ZipEntry): string {
  return readZipEntry(data, entry).toString("utf8");
}

/** Read a whole archive into a name → bytes map. Throws on duplicate names. */
export function unzipAll(data: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of listZipEntries(data)) {
    if (entry.name.endsWith("/")) continue;
    if (out.has(entry.name)) throw new Error(`duplicate ZIP entry: ${entry.name}`);
    out.set(entry.name, readZipEntry(data, entry));
  }
  return out;
}

// --- stored-zip writer (fixtures/tools) -------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a valid ZIP (stored entries, or deflated when `deflate` is set). */
export function createZip(entries: { name: string; data: Buffer | string }[], deflate = false): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const nameBuf = Buffer.from(name, "utf8");
    const method = deflate ? 8 : 0;
    const stored = deflate ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(LFH_SIG, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lfh, nameBuf, stored);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CD_SIG, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + stored.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}
