import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSession } from "../../src/session/auth-session.js";
import { readSession, writeSession } from "../../src/session/store.js";

const adopted = { cookies: { MoodleSession: "before" }, sesskey: "key", savedAt: "2026-05-01T10:00:00.000Z" };

vi.mock("../../src/session/browser-login.js", () => ({
    browserLogin: async () => ({ kind: "anotherProcess", session: adopted }),
}));

describe("a sign-in finished by another process", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "unsada-auth-"));
        vi.stubEnv("UNSADA_MCP_HOME", home);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(home, { recursive: true, force: true });
    });

    it("leaves the saved session as that process last wrote it", async () => {
        const renewed = { ...adopted, cookies: { MoodleSession: "after" } };
        await writeSession(renewed);
        await expect(new AuthSession().signIn("untilDone")).resolves.toEqual(adopted);
        expect(await readSession()).toEqual(renewed);
    });
});
