import { mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnsafePathError } from "../../src/errors.js";
import { makeDirectoryInside, resolveDownloadDirectory, safeName } from "../../src/lib/paths.js";

describe("safeName", () => {
    it.each([
        ["Apunte Unidad 1 — Álgebra.pdf", "Apunte Unidad 1 — Álgebra.pdf"],
        ["a:b*c?d.txt", "a_b_c_d.txt"],
        ["..\\..\\evil.bat", "_.._evil.bat"],
        ["../../evil.sh", "_.._evil.sh"],
        [".bashrc", "bashrc"],
        ["trailing dots... ", "trailing dots"],
        ["CON.txt", "_CON.txt"],
        ["nul", "_nul"],
        ["COM1.pdf", "_COM1.pdf"],
        ["CLAUDE.md", "_CLAUDE.md"],
        ["agents.MD", "_agents.MD"],
        ["desktop.ini", "_desktop.ini"],
        ["node_modules", "_node_modules"],
        ["Startup", "_Startup"],
        ["gpj‮exe.jpg", "gpj_exe.jpg"],
        ["line\nbreak\u0000.txt", "line_break_.txt"],
        ["", "file"],
        ["...", "file"],
    ])("turns %j into %j", (input, expected) => {
        expect(safeName(input)).toBe(expected);
    });

    it("cuts long names by bytes and keeps the extension", () => {
        const name = safeName(`${"á".repeat(300)}.pdf`);
        expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
        expect(name.endsWith(".pdf")).toBe(true);
    });
});

describe("resolveDownloadDirectory", () => {
    const root = resolve("/tmp/project");
    const extra = resolve("/tmp/extra");

    it("resolves relative directories under the first root", () => {
        expect(resolveDownloadDirectory("Bases de Datos/Unidad 1", [root])).toEqual({
            root,
            path: join(root, "Bases de Datos", "Unidad 1"),
        });
    });

    it("accepts absolute paths inside an extra root", () => {
        expect(resolveDownloadDirectory(join(extra, "materias"), [root, extra]).root).toBe(extra);
    });

    it.each([
        ["parent segments", "../outside"],
        ["nested parent segments", "a/../../outside"],
        ["dot directory", ".git/hooks"],
        ["agent config", ".claude"],
        ["hidden segment", "notes/.vscode"],
        ["node_modules", "node_modules/pkg"],
        ["startup folder", "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"],
        ["reserved name", "CON"],
        ["invalid characters", "a:b"],
        ["absolute outside the roots", resolve("/tmp/elsewhere")],
        ["absolute with dot segments", `${root}/../elsewhere`],
    ])("rejects %s", (_, directory) => {
        expect(() => resolveDownloadDirectory(directory, [root, extra])).toThrow(UnsafePathError);
    });
});

describe("makeDirectoryInside", () => {
    let base: string;
    beforeAll(async () => {
        base = await mkdtemp(join(tmpdir(), "unsada-paths-"));
        await mkdir(join(base, "root", "inner"), { recursive: true });
        await mkdir(join(base, "outside"));
        await symlink(join(base, "outside"), join(base, "root", "link"), "junction");
    });
    afterAll(() => rm(base, { recursive: true, force: true }));

    it("creates nested directories inside the root", async () => {
        await makeDirectoryInside(join(base, "root"), join(base, "root", "inner", "a", "b"));
        expect((await stat(join(base, "root", "inner", "a", "b"))).isDirectory()).toBe(true);
    });

    it("creates nothing through a link that leads outside", async () => {
        await expect(makeDirectoryInside(join(base, "root"), join(base, "root", "link", "deep"))).rejects.toThrow(
            UnsafePathError,
        );
        expect(await readdir(join(base, "outside"))).toEqual([]);
    });
});
