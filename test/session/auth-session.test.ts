import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSession } from "../../src/session/auth-session.js";
import { readSession, writeSession } from "../../src/session/store.js";

const adopted = { cookies: { MoodleSession: "before" }, sesskey: "key", savedAt: "2026-05-01T10:00:00.000Z" };
const signIn = vi.hoisted(() => ({ kind: "anotherProcess" }));

vi.mock("../../src/session/browser-login.js", () => ({
    browserLogin: async () => ({ kind: signIn.kind, session: adopted }),
}));

describe("a sign-in", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "unsada-auth-"));
        vi.stubEnv("UNSADA_MCP_HOME", home);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(home, { recursive: true, force: true });
    });

    it("finished by another process leaves the saved session as that process last wrote it", async () => {
        signIn.kind = "anotherProcess";
        const renewed = { ...adopted, cookies: { MoodleSession: "after" } };
        await writeSession(renewed);
        await expect(new AuthSession().signIn("untilDone")).resolves.toEqual(adopted);
        expect(await readSession()).toEqual(renewed);
    });

    it("finished in this window is saved", async () => {
        signIn.kind = "thisWindow";
        await new AuthSession().signIn("untilDone");
        expect(await readSession()).toEqual(adopted);
    });
});
