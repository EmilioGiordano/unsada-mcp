import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooLargeError } from "../../src/errors.js";
import { saveResponse } from "../../src/lib/save-file.js";

const body = (text: string) => new Response(text);

describe("saveResponse", () => {
    let directory: string;
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "unsada-save-"));
    });
    afterEach(() => rm(directory, { recursive: true, force: true }));

    it("saves the content and leaves no temporary file", async () => {
        const saved = await saveResponse(body("hola"), directory, "a.txt", 100);
        expect(saved).toEqual({ path: join(directory, "a.txt"), status: "saved", bytes: 4 });
        expect(await readFile(saved.path, "utf8")).toBe("hola");
        expect(await readdir(directory)).toEqual(["a.txt"]);
    });

    it("skips a file of the same size", async () => {
        await writeFile(join(directory, "a.txt"), "hola");
        expect((await saveResponse(body("chau"), directory, "a.txt", 100)).status).toBe("skipped");
        expect(await readFile(join(directory, "a.txt"), "utf8")).toBe("hola");
    });

    it("never overwrites a different file", async () => {
        await writeFile(join(directory, "a.txt"), "original");
        await writeFile(join(directory, "a (2).txt"), "second!!");
        const saved = await saveResponse(body("new"), directory, "a.txt", 100);
        expect(saved.path).toBe(join(directory, "a (3).txt"));
        expect(await readFile(join(directory, "a.txt"), "utf8")).toBe("original");
    });

    it("gives concurrent writers of one name different files", async () => {
        const results = await Promise.all(
            ["uno", "dos!", "tres!"].map((text) => saveResponse(body(text), directory, "same.txt", 100)),
        );
        expect(new Set(results.map((result) => result.path)).size).toBe(3);
        expect((await readdir(directory)).sort()).toEqual(["same (2).txt", "same (3).txt", "same.txt"]);
    });

    it("stops past the size cap and cleans up", async () => {
        await expect(saveResponse(body("x".repeat(1000)), directory, "big.bin", 100)).rejects.toThrow(TooLargeError);
        expect(await readdir(directory)).toEqual([]);
    });

    it("refuses a declared size past the cap before writing", async () => {
        const response = new Response("small", { headers: { "content-length": "1000" } });
        await expect(saveResponse(response, directory, "big.bin", 100)).rejects.toThrow(TooLargeError);
        expect(await readdir(directory)).toEqual([]);
    });

    it("saves empty bodies", async () => {
        expect((await saveResponse(new Response(null), directory, "empty.txt", 100)).bytes).toBe(0);
    });
});
