import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;
const DOS_DATE_1980 = 33;

/** Regular files under the given repo paths, as forward-slash paths. Symlinks are skipped. */
export function listFiles(root, paths) {
  return paths.flatMap((path) => {
    const stats = lstatSync(resolve(root, path), { throwIfNoEntry: false });
    if (stats?.isFile()) return [path];
    if (!stats?.isDirectory()) return [];
    const children = readdirSync(resolve(root, path)).sort();

    return listFiles(
      root,
      children.map((name) => `${path}/${name}`),
    );
  });
}

function compress(root, name) {
  const data = readFileSync(resolve(root, name));

  return {
    name: Buffer.from(name),
    data: deflateRawSync(data),
    size: data.length,
    crc: crc32(data),
  };
}

/** Fields shared by the local and central headers, from "version needed" to the name length. */
function writeEntryFields(buffer, entry, at) {
  const fields = [VERSION, UTF8_NAMES, DEFLATE, 0, DOS_DATE_1980];
  for (const value of fields) at = buffer.writeUInt16LE(value, at);
  at = buffer.writeUInt32LE(entry.crc, at);
  at = buffer.writeUInt32LE(entry.data.length, at);
  at = buffer.writeUInt32LE(entry.size, at);
  buffer.writeUInt16LE(entry.name.length, at);
}

function localHeader(entry) {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(0x04034b50, 0);
  writeEntryFields(buffer, entry, 4);

  return Buffer.concat([buffer, entry.name]);
}

function centralHeader(entry) {
  const buffer = Buffer.alloc(46);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(VERSION, 4);
  writeEntryFields(buffer, entry, 6);
  buffer.writeUInt32LE(entry.offset, 42);

  return Buffer.concat([buffer, entry.name]);
}

function endOfDirectory(count, size, offset) {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(count, 8);
  buffer.writeUInt16LE(count, 10);
  buffer.writeUInt32LE(size, 12);
  buffer.writeUInt32LE(offset, 16);

  return buffer;
}

/** Write a deflated zip of the given repo-relative files, keeping their paths. */
export function writeZip(root, request) {
  const local = [];
  let offset = 0;
  const entries = request.files.map((name) => {
    const entry = { ...compress(root, name), offset };
    const head = localHeader(entry);
    local.push(head, entry.data);
    offset += head.length + entry.data.length;

    return entry;
  });
  const central = Buffer.concat(entries.map(centralHeader));
  const end = endOfDirectory(entries.length, central.length, offset);
  writeFileSync(resolve(root, request.target), Buffer.concat([...local, central, end]));
}
