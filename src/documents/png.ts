// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import { deflateSync } from "node:zlib";
import { concatBytes } from "../lib/streams.js";

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const GRAYSCALE = 0;
const NO_FILTER = 0;

export function grayscalePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
    const rows = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y++) {
        const start = y * (width + 1);
        rows[start] = NO_FILTER;
        rows.set(pixels.subarray(y * width, (y + 1) * width), start + 1);
    }

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = BIT_DEPTH;
    header[9] = GRAYSCALE;

    return concatBytes([
        SIGNATURE,
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(rows, { level: 6 })),
        chunk("IEND", new Uint8Array()),
    ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});

function crc32(bytes: Uint8Array): number {
    let c = -1;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
}
