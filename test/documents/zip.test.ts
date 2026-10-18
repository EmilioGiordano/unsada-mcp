import { describe, expect, it } from "vitest";
import { InvalidZipError, inflateEntries, listZip } from "../../src/documents/zip.js";
import { makeZip } from "./make-zip.js";

const MB = 1024 * 1024;
const limits = { maxEntryBytes: 1 * MB, maxTotalBytes: 2 * MB };

describe("zip", () => {
    it("lists and inflates stored and deflated entries", () => {
        const zip = makeZip([
            { name: "a.txt", data: "hello" },
            { name: "b.txt", data: "world", store: true },
        ]);
        const entries = listZip(zip);
        expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
        const contents = inflateEntries(zip, entries, limits);
        expect(new TextDecoder().decode(contents.get("a.txt"))).toBe("hello");
        expect(new TextDecoder().decode(contents.get("b.txt"))).toBe("world");
    });

    it("rejects an entry that declares more than the limit", () => {
        const zip = makeZip([{ name: "big", data: new Uint8Array(2 * MB) }]);
        expect(() => inflateEntries(zip, listZip(zip), limits)).toThrow(InvalidZipError);
    });

    it("stops a bomb that lies about its size", () => {
        const zip = makeZip([{ name: "bomb", data: new Uint8Array(50 * MB), declaredSize: 10 }]);
        expect(zip.byteLength).toBeLessThan(MB);
        expect(() => inflateEntries(zip, listZip(zip), limits)).toThrow(InvalidZipError);
    });

    it("caps the total across entries", () => {
        const part = new Uint8Array(900 * 1024);
        const zip = makeZip([
            { name: "1", data: part },
            { name: "2", data: part },
            { name: "3", data: part },
        ]);
        expect(() => inflateEntries(zip, listZip(zip), limits)).toThrow(InvalidZipError);
    });

    it("rejects garbage and truncated archives", () => {
        expect(() => listZip(new Uint8Array(100))).toThrow(InvalidZipError);
        const zip = makeZip([{ name: "a.txt", data: "hello" }]);
        expect(() => listZip(zip.subarray(0, zip.byteLength - 30))).toThrow(InvalidZipError);
    });

    it("rejects a central directory pointing past the end", () => {
        const zip = makeZip([{ name: "a.txt", data: "hello" }]);
        new DataView(zip.buffer).setUint32(zip.byteLength - 6, zip.byteLength + 1000, true);
        expect(() => listZip(zip)).toThrow(InvalidZipError);
    });
});
