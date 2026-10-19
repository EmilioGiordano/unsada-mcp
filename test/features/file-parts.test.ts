import { describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import type { ParsedDocument } from "../../src/documents/document.js";
import { fileReader } from "../../src/features/files.js";
import type { ClassroomResponse } from "../../src/moodle/client.js";

const fail = (): never => {
    throw new Error("bad xref");
};

const DOCUMENTS: Record<string, { total: number; page: (number: number) => string }> = {
    "middle.pdf": { total: 3, page: (number) => (number === 2 ? fail() : `Pagina ${number}`) },
    "broken.pdf": { total: 3, page: fail },
    "dense.pdf": { total: 3, page: (number) => (number === 1 ? fail() : "x".repeat(40_000)) },
    "long-broken.pdf": { total: 50, page: fail },
    "tail-broken.pdf": { total: 50, page: (number) => (number === 1 ? "Portada" : fail()) },
};

vi.mock("../../src/documents/open-document.js", () => ({
    openDocument: async (_bytes: Uint8Array, name: string): Promise<ParsedDocument> => ({
        format: "pdf",
        unit: "page",
        total: DOCUMENTS[name].total,
        part: async (number) => ({ text: DOCUMENTS[name].page(number) }),
        close: async () => undefined,
    }),
}));

const read = fileReader({
    get: async (input: string): Promise<ClassroomResponse> => ({
        kind: "file",
        url: new URL(input),
        response: new Response("%PDF"),
    }),
});

const fileUrl = (name: string) => `${ORIGIN}/pluginfile.php/7/mod_resource/content/1/${name}`;

describe("reading the parts of a file", () => {
    it("keeps the pages after one that cannot be read", async () => {
        const { parts, next } = await read(fileUrl("middle.pdf"));
        expect(next).toBeUndefined();
        expect(parts).toMatchObject([
            { number: 1, text: "Pagina 1" },
            { number: 2, title: "unreadable", text: expect.stringContaining("page 2 looks damaged") },
            { number: 3, text: "Pagina 3" },
        ]);
    });

    it("fails when no page to the end of the file can be read", async () => {
        await expect(read(fileUrl("broken.pdf"))).rejects.toThrow(/"broken\.pdf" looks damaged/);
    });

    it("leaves a readable page that does not fit for the next read", async () => {
        const { parts, next } = await read(fileUrl("dense.pdf"));
        expect(parts).toMatchObject([{ number: 1, title: "unreadable" }]);
        expect(next).toBe(2);
    });

    it("fails a long file whose first pages are all broken", async () => {
        await expect(read(fileUrl("long-broken.pdf"))).rejects.toThrow(/"long-broken\.pdf" looks damaged/);
    });

    it("stops after five unreadable pages in a row and says where to go on", async () => {
        const { parts, next } = await read(fileUrl("tail-broken.pdf"));
        expect(parts.map((part) => part.number)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(parts[1]).toMatchObject({ text: "page 2 looks damaged and could not be read (bad xref)." });
        expect(next).toBe(7);
    });

    it("returns notes, not an error, for broken parts at the end of a later read", async () => {
        const { parts, next } = await read(fileUrl("long-broken.pdf"), 46);
        expect(parts.map((part) => part.number)).toEqual([46, 47, 48, 49, 50]);
        expect(next).toBeUndefined();
    });
});
