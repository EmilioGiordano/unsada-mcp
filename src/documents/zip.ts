// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import { inflateRawSync } from "node:zlib";
import { UnsadaError } from "../errors.js";

export interface ZipEntry {
    name: string;
    method: number;
    compressedSize: number;
    size: number;
    offset: number;
}

export interface InflateLimits {
    maxEntryBytes: number;
    maxTotalBytes: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_ENTRY_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const STORED = 0;
const DEFLATE = 8;
const MAX_ENTRIES = 5_000;

export class InvalidZipError extends UnsadaError {
    constructor(detail: string) {
        super(`The file is not a readable zip: ${detail}.`);
    }
}

export function listZip(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndRecord(view);
    const count = view.getUint16(end + 10, true);
    let position = view.getUint32(end + 16, true);
    if (count === 0xffff || position === 0xffffffff) throw new InvalidZipError("zip64 is not supported");
    if (count > MAX_ENTRIES) throw new InvalidZipError(`it has more than ${MAX_ENTRIES} entries`);

    const entries: ZipEntry[] = [];
    const decoder = new TextDecoder();
    for (let index = 0; index < count; index++) {
        if (
            position + CENTRAL_ENTRY_BYTES > bytes.length ||
            view.getUint32(position, true) !== CENTRAL_DIRECTORY_ENTRY
        ) {
            throw new InvalidZipError("the central directory is corrupt");
        }
        const nameLength = view.getUint16(position + 28, true);
        const nameStart = position + CENTRAL_ENTRY_BYTES;
        entries.push({
            name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
            method: view.getUint16(position + 10, true),
            compressedSize: view.getUint32(position + 20, true),
            size: view.getUint32(position + 24, true),
            offset: view.getUint32(position + 42, true),
        });
        position = nameStart + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
    }
    return entries;
}

export function inflateEntries(bytes: Uint8Array, entries: readonly ZipEntry[], limits: InflateLimits) {
    const contents = new Map<string, Uint8Array>();
    let total = 0;
    for (const entry of entries) {
        const remaining = limits.maxTotalBytes - total;
        const data = inflateEntry(bytes, entry, Math.min(limits.maxEntryBytes, remaining));
        total += data.byteLength;
        contents.set(entry.name, data);
    }
    return contents;
}

function inflateEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
    if (entry.size > maxBytes) throw new InvalidZipError(`"${entry.name}" expands beyond the size limit`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = entry.offset;
    if (header + LOCAL_HEADER_BYTES > bytes.length || view.getUint32(header, true) !== LOCAL_HEADER) {
        throw new InvalidZipError(`the header of "${entry.name}" is missing`);
    }
    const start = header + LOCAL_HEADER_BYTES + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === STORED) {
        if (data.byteLength > maxBytes) throw new InvalidZipError(`"${entry.name}" is beyond the size limit`);
        return data;
    }
    if (entry.method !== DEFLATE) throw new InvalidZipError(`"${entry.name}" uses compression method ${entry.method}`);
    try {
        return inflateRawSync(data, { maxOutputLength: Math.max(maxBytes, 1) });
    } catch (error) {
        throw new InvalidZipError(`"${entry.name}" could not be inflated (${String(error)})`);
    }
}

function findEndRecord(view: DataView): number {
    const lastStart = view.byteLength - END_RECORD_BYTES;
    for (let position = lastStart; position >= Math.max(0, lastStart - MAX_COMMENT_BYTES); position--) {
        if (view.getUint32(position, true) === END_OF_CENTRAL_DIRECTORY) return position;
    }
    throw new InvalidZipError("it has no central directory");
}
