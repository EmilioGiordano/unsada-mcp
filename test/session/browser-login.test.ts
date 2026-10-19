import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import { browserLogin } from "../../src/session/browser-login.js";
import { writeSession } from "../../src/session/store.js";

const loginWindow = vi.hoisted((): { url: string; sesskey: string | null } => ({ url: "", sesskey: null }));

vi.mock("playwright-core", () => {
    const page = {
        on: () => undefined,
        goto: async () => undefined,
        url: () => loginWindow.url,
        locator: () => ({ first: () => ({ count: async () => 0 }) }),
        evaluate: async () => loginWindow.sesskey,
    };
    const context = { newPage: async () => page, cookies: async () => [{ name: "MoodleSession", value: "mine" }] };
    return { chromium: { launch: async () => ({ newContext: async () => context, close: async () => undefined }) } };
});

describe("the sign-in window", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "unsada-login-"));
        vi.stubEnv("UNSADA_MCP_HOME", home);
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(home, { recursive: true, force: true });
    });

    it("closes with the session another process saved after it opened", async () => {
        loginWindow.url = `${ORIGIN}/login/index.php`;
        loginWindow.sesskey = null;
        const signingIn = browserLogin();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const elsewhere = { cookies: { MoodleSession: "theirs" }, sesskey: "key", savedAt: new Date().toISOString() };
        await writeSession(elsewhere);
        await expect(signingIn).resolves.toEqual({ kind: "anotherProcess", session: elsewhere });
    });

    it("fails when the saved session cannot be read for a reason other than a busy file", async () => {
        await mkdir(join(home, "session.json"));
        loginWindow.url = `${ORIGIN}/login/index.php`;
        loginWindow.sesskey = null;
        await expect(browserLogin()).rejects.toThrow(/Could not read the saved session file.*EISDIR/);
    });

    it("ignores a session saved before it opened", async () => {
        await writeSession({
            cookies: { MoodleSession: "old" },
            sesskey: "old",
            savedAt: new Date(Date.now() - 60_000).toISOString(),
        });
        loginWindow.url = `${ORIGIN}/my/`;
        loginWindow.sesskey = "new";
        await expect(browserLogin()).resolves.toMatchObject({
            kind: "thisWindow",
            session: { cookies: { MoodleSession: "mine" }, sesskey: "new" },
        });
    });
});
