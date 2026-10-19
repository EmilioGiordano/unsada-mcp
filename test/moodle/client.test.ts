import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import {
    ClassroomHttpError,
    ClassroomUnreachableError,
    ExternalRedirectError,
    ForbiddenUrlError,
    NotEnrolledError,
} from "../../src/errors.js";
import { MoodleClient } from "../../src/moodle/client.js";
import { deleteSession, writeSession } from "../../src/session/store.js";

vi.mock("../../src/session/browser-login.js", () => ({
    browserLogin: () => Promise.reject(new Error("no browser in tests")),
}));

const html = (body: string, headers: Record<string, string> = {}) =>
    new Response(`<html><body>${body}</body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });

const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });

interface Call {
    url: string;
    cookie: string;
}

function stubFetch(
    answer: (url: URL, call: number, signal?: AbortSignal | null) => Response | Promise<Response>,
): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL, init: RequestInit) => {
            const headers = new Headers(init.headers);
            calls.push({ url: input.href, cookie: headers.get("cookie") ?? "" });
            return answer(input, calls.length, init.signal);
        }),
    );
    return calls;
}

describe("MoodleClient", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "unsada-client-"));
        vi.stubEnv("UNSADA_MCP_HOME", home);
        await writeSession({ cookies: { MoodleSession: "first" }, sesskey: "key1", savedAt: "2026-01-01T00:00:00Z" });
    });
    afterEach(async () => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.useRealTimers();
        await rm(home, { recursive: true, force: true });
    });

    const savedSession = async () => JSON.parse(await readFile(join(home, "session.json"), "utf8"));

    it("sends the session cookie and reads the page", async () => {
        const calls = stubFetch(() => html("<h1>Tablero</h1>"));
        const page = await new MoodleClient().page("/my/");
        expect(page.html).toContain("Tablero");
        expect(calls).toEqual([{ url: `${ORIGIN}/my/`, cookie: "MoodleSession=first" }]);
    });

    it("rejects forbidden urls before any request", async () => {
        const calls = stubFetch(() => html(""));
        const client = new MoodleClient();
        for (const url of [
            "https://evil.example/my/",
            "/login/logout.php?sesskey=key1",
            "/mod/forum/post.php?reply=1",
            "/course/view.php?id=1&sesskey=key1",
            `https://user:pass@${new URL(ORIGIN).host}/my/`,
        ]) {
            await expect(client.page(url)).rejects.toThrow(ForbiddenUrlError);
        }
        expect(calls).toEqual([]);
    });

    it("follows a readable redirect inside the classroom", async () => {
        const calls = stubFetch((url) => (url.pathname === "/my/index.php" ? redirect("/my/") : html("ok")));
        const page = await new MoodleClient().page("/my/index.php");
        expect(page.url.pathname).toBe("/my/");
        expect(calls.map((call) => call.url)).toEqual([`${ORIGIN}/my/index.php`, `${ORIGIN}/my/`]);
    });

    it("stops at a redirect to an action endpoint without requesting it", async () => {
        const calls = stubFetch(() => redirect("/mod/forum/subscribe.php?id=1&sesskey=key1"));
        await expect(new MoodleClient().page("/my/")).rejects.toThrow(ForbiddenUrlError);
        expect(calls).toHaveLength(1);
    });

    it("reports a redirect outside the classroom and never sends the cookie there", async () => {
        const calls = stubFetch(() => redirect("https://evil.example/steal"));
        const client = new MoodleClient();
        expect(await client.get("/mod/url/view.php?id=5")).toMatchObject({
            kind: "external",
            target: "https://evil.example/steal",
        });
        await expect(client.page("/mod/url/view.php?id=5")).rejects.toThrow(ExternalRedirectError);
        expect(calls.every((call) => call.url.startsWith(ORIGIN))).toBe(true);
    });

    it("reports courses the user is not enrolled in", async () => {
        stubFetch(() => redirect("/enrol/index.php?id=9"));
        await expect(new MoodleClient().page("/course/view.php?id=9")).rejects.toThrow(NotEnrolledError);
    });

    it("turns HTTP errors into classroom errors", async () => {
        stubFetch(() => new Response("missing", { status: 404 }));
        await expect(new MoodleClient().page("/course/view.php?id=9")).rejects.toThrow(ClassroomHttpError);
    });

    it("gives up on redirect loops", async () => {
        const calls = stubFetch(() => redirect("/my/"));
        await expect(new MoodleClient().page("/my/")).rejects.toThrow(/too many times/);
        expect(calls).toHaveLength(11);
    });

    it("returns files without reading them as pages", async () => {
        stubFetch(() => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
        const response = await new MoodleClient().get("/pluginfile.php/1/mod_resource/content/1/a.pdf");
        expect(response.kind).toBe("file");
        if (response.kind === "file") expect(await response.response.text()).toBe("%PDF-1.7");
    });

    it("keeps cookie and sesskey changes in the session file", async () => {
        stubFetch(() =>
            html('<script>M.cfg = {"sesskey":"key2"};</script>', {
                "set-cookie": "MoodleSession=second; path=/; HttpOnly",
            }),
        );
        await new MoodleClient().page("/my/");
        expect(await savedSession()).toMatchObject({ cookies: { MoodleSession: "second" }, sesskey: "key2" });
    });

    it("retries once with a session renewed by another process", async () => {
        const calls = stubFetch(async (_, call) => {
            if (call > 1) return html("ok");
            await writeSession({
                cookies: { MoodleSession: "renewed" },
                sesskey: null,
                savedAt: "2026-02-01T00:00:00Z",
            });
            return redirect("/login/index.php");
        });
        await new MoodleClient().page("/my/");
        expect(calls.map((call) => call.cookie)).toEqual(["MoodleSession=first", "MoodleSession=renewed"]);
    });

    it("never overwrites a session another process renewed meanwhile", async () => {
        const renewed = { cookies: { MoodleSession: "renewed" }, sesskey: "key9", savedAt: "2026-02-01T00:00:00Z" };
        const calls = stubFetch(async (_, call) => {
            if (call === 1) {
                await writeSession(renewed);
                return html('<script>M.cfg = {"sesskey":"stale"};</script>', {
                    "set-cookie": "MoodleSession=anonymous; path=/",
                });
            }
            return html("ok");
        });
        const client = new MoodleClient();
        await client.page("/my/");
        expect(await savedSession()).toEqual(renewed);
        await client.page("/my/");
        expect(calls.map((call) => call.cookie)).toEqual(["MoodleSession=first", "MoodleSession=renewed"]);
    });

    it("stops using a session deleted by logout", async () => {
        const calls = stubFetch(() => html("ok"));
        const client = new MoodleClient();
        await client.page("/my/");
        await deleteSession();
        await expect(client.page("/my/")).rejects.toThrow("no browser in tests");
        expect(calls).toHaveLength(1);
        await expect(readFile(join(home, "session.json"))).rejects.toThrow();
    });

    it("treats the login form as an expired session", async () => {
        stubFetch(() => html('<div id="login"><form action="/login/index.php"></form></div>'));
        await expect(new MoodleClient().page("/my/")).rejects.toThrow("no browser in tests");
    });

    it("aborts a request whose headers never arrive", async () => {
        vi.useFakeTimers();
        let markRequested = () => {};
        const requested = new Promise<void>((resolve) => {
            markRequested = resolve;
        });
        stubFetch(
            (_url, _call, signal) =>
                new Promise<Response>((_, reject) => {
                    signal?.addEventListener("abort", () => reject(signal.reason));
                    markRequested();
                }),
        );
        const pending = new MoodleClient().page("/my/");
        const assertion = expect(pending).rejects.toThrow(ClassroomUnreachableError);
        await requested;
        await vi.advanceTimersByTimeAsync(30_000);
        await assertion;
    });
});
