import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import { download } from "../../src/features/downloads.js";
import type { ClassroomResponse } from "../../src/moodle/client.js";

const NAMES = [
    "apunte.pdf",
    "guía de ejercicios.docx",
    "clase 3.pptx",
    "notas.xlsx",
    "código fuente.zip",
    "material.rar",
    "grabación.mp4",
    "diagrama.png",
    "foto.JPG",
    "léeme.txt",
    "instalador.exe",
    "datos.csv",
    "sin extensión",
    "CON.txt",
    "CLAUDE.md",
    "a:b?.txt",
];

const fileUrl = (name: string, folder = "") =>
    `${ORIGIN}/pluginfile.php/9/mod_folder/content/0/${folder}${encodeURIComponent(name)}?forcedownload=1`;

function stubClient(files: Map<string, Uint8Array<ArrayBuffer>>, pages: Map<string, string>) {
    const get = vi.fn(async (input: string): Promise<ClassroomResponse> => {
        const url = new URL(input);
        const key = url.pathname + url.search;
        const bytes = files.get(key);
        if (bytes) return { kind: "file", url, response: new Response(bytes) };
        const html = pages.get(key);
        if (html) return { kind: "page", url, html };
        throw new Error(`unexpected request ${key}`);
    });
    const page = async (input: string) => {
        const response = await get(input);
        if (response.kind !== "page") throw new Error("not a page");
        return response;
    };
    return { get, page };
}

const keyOf = (url: string) => {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
};

describe("download", () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "unsada-download-"));
        vi.stubEnv("UNSADA_DOWNLOAD_ROOTS", root);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    });

    it("saves every file type byte for byte", async () => {
        const contents = new Map(NAMES.map((name) => [name, new Uint8Array(randomBytes(1000 + name.length))]));
        const files = new Map(NAMES.map((name) => [keyOf(fileUrl(name)), contents.get(name) ?? new Uint8Array()]));
        const client = stubClient(files, new Map());

        const report = await download(
            client,
            NAMES.map((name) => fileUrl(name)),
            join(root, "Materia"),
        );

        expect(report).toMatchObject({ saved: NAMES.length, skipped: 0, failed: 0 });
        for (const file of report.files) {
            const original = contents.get(decodeURIComponent(new URL(file.url).pathname.split("/").at(-1) ?? ""));
            expect(original).toBeDefined();
            expect(new Uint8Array(await readFile(join(root, "Materia", file.path ?? "")))).toEqual(original);
        }
        expect((await readdir(join(root, "Materia"))).sort()).toEqual(
            expect.arrayContaining(["_CON.txt", "_CLAUDE.md", "a_b_.txt", "sin extensión"]),
        );
    });

    it("skips files already downloaded", async () => {
        const files = new Map([[keyOf(fileUrl("a.pdf")), new Uint8Array([1, 2, 3])]]);
        const client = stubClient(files, new Map());
        await download(client, [fileUrl("a.pdf")], join(root, "Materia"));
        const again = await download(client, [fileUrl("a.pdf")], join(root, "Materia"));
        expect(again).toMatchObject({ saved: 0, skipped: 1 });
    });

    it("expands a folder into its subfolders", async () => {
        const folderUrl = `${ORIGIN}/mod/folder/view.php?id=5`;
        const html = `<div id="region-main"><h2>Unidad: 1</h2><div class="foldertree">
            <a href="${fileUrl("apunte.pdf", "Teoría/")}">apunte.pdf</a>
            <a href="${fileUrl("evil.sh", "..%2F..%2F")}">evil.sh</a>
            <a href="${fileUrl("tp.docx")}">tp.docx</a></div></div>`;
        const files = new Map(
            [fileUrl("apunte.pdf", "Teoría/"), fileUrl("evil.sh", "..%2F..%2F"), fileUrl("tp.docx")].map((url) => [
                keyOf(url),
                new Uint8Array([7]),
            ]),
        );
        const client = stubClient(files, new Map([[keyOf(folderUrl), html]]));

        const report = await download(client, [folderUrl], join(root, "Materia"));

        expect(report.failed).toBe(0);
        expect(report.files.map((file) => file.path).sort()).toEqual([
            "Unidad_ 1/Teoría/apunte.pdf",
            "Unidad_ 1/file/file/_.._evil.sh",
            "Unidad_ 1/tp.docx",
        ]);
        expect(await readdir(root)).toEqual(["Materia"]);
    });

    it("reports failures per file and keeps going", async () => {
        const files = new Map([[keyOf(fileUrl("ok.pdf")), new Uint8Array([1])]]);
        const client = stubClient(files, new Map());

        const report = await download(
            client,
            [fileUrl("ok.pdf"), fileUrl("missing.pdf"), "https://evil.example/x.pdf", `${ORIGIN}/login/logout.php`],
            join(root, "Materia"),
        );

        expect(report).toMatchObject({ saved: 1, failed: 3 });
        expect(report.files.filter((file) => file.status === "failed").every((file) => file.error)).toBe(true);
    });

    it("refuses directories outside the roots before any request", async () => {
        const client = stubClient(new Map(), new Map());
        await expect(download(client, [fileUrl("a.pdf")], "../escape")).rejects.toThrow();
        await expect(download(client, [fileUrl("a.pdf")], join(tmpdir(), "elsewhere"))).rejects.toThrow();
        expect(client.get).not.toHaveBeenCalled();
    });
});
