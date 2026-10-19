import { describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import type { ParsedDocument } from "../../src/documents/document.js";
import { TooLargeError } from "../../src/errors.js";
import { fileReader } from "../../src/features/files.js";
import type { ClassroomResponse } from "../../src/moodle/client.js";

const PAGES: Record<string, (number: number) => string> = {
    "middle.pdf": (number) => {
        if (number === 2) throw new Error("bad xref");
        return `Pagina ${number}`;
    },
    "broken.pdf": () => {
        throw new Error("bad xref");
    },
    "dense.pdf": (number) => {
        if (number === 1) throw new Error("bad xref");
        return "x".repeat(40_000);
    },
    "huge.pdf": (number) => {
        if (number === 2) throw new TooLargeError("The page image", 10);
        return `Pagina ${number}`;
    },
};

vi.mock("../../src/documents/open-document.js", () => ({
    openDocument: async (_bytes: Uint8Array, name: string): Promise<ParsedDocument> => ({
        format: "pdf",
        unit: "page",
        total: 3,
        part: async (number) => ({ text: PAGES[name](number) }),
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

    it("fails when no page in the read can be read", async () => {
        await expect(read(fileUrl("broken.pdf"))).rejects.toThrow(/"broken\.pdf" looks damaged/);
    });

    it("leaves a readable page that does not fit for the next read", async () => {
        const { parts, next } = await read(fileUrl("dense.pdf"));
        expect(parts).toMatchObject([{ number: 1, title: "unreadable" }]);
        expect(next).toBe(2);
    });

    it("passes a typed error through with its own instructions", async () => {
        await expect(read(fileUrl("huge.pdf"))).rejects.toThrow(/Save it with unsada_download/);
    });
});
