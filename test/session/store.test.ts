import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeLegacyBrowserProfile, writeSession } from "../../src/session/store.js";

describe("the old browser profile", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "unsada-store-"));
        vi.stubEnv("UNSADA_MCP_HOME", home);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(home, { recursive: true, force: true });
    });

    it("is deleted and the session is kept", async () => {
        await mkdir(join(home, "browser-profile", "Default"), { recursive: true });
        await writeFile(join(home, "browser-profile", "Local State"), "{}");
        await writeFile(join(home, "browser-profile", "Default", "Cookies"), "google");
        await writeSession({ cookies: { MoodleSession: "abc" }, sesskey: "key", savedAt: "2026-01-01T00:00:00Z" });
        await removeLegacyBrowserProfile();
        expect(await readdir(home)).toEqual(["session.json"]);
    });

    it("is kept when the folder is not a browser profile", async () => {
        await mkdir(join(home, "browser-profile"));
        await writeFile(join(home, "browser-profile", "notes.txt"), "mine");
        await removeLegacyBrowserProfile();
        expect(await readdir(join(home, "browser-profile"))).toEqual(["notes.txt"]);
    });

    it("is not required to exist", async () => {
        await expect(removeLegacyBrowserProfile()).resolves.toBeUndefined();
    });
});
