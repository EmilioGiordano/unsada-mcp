import { ORIGIN } from "../config.js";
import {
    ClassroomHttpError,
    ClassroomUnreachableError,
    ExternalRedirectError,
    NotEnrolledError,
    SessionExpiredError,
    SessionRejectedError,
    UnsadaError,
} from "../errors.js";
import { readLimitedText } from "../lib/streams.js";
import { logger } from "../logger.js";
import { AuthSession, type LoginWait } from "../session/auth-session.js";
import { applySessionChanges, type StoredSession, updateSession } from "../session/store.js";
import { assertReadable, readableClassroomUrl } from "./urls.js";

export const MAX_CONCURRENT_REQUESTS = 4;

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DEADLINE_MS = 60 * 60_000;
const MAX_REDIRECTS = 10;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const KEEPALIVE_INTERVAL_MS = 10 * 60_000;

export type ClassroomResponse =
    | { kind: "page"; url: URL; html: string }
    | { kind: "file"; url: URL; response: Response }
    | { kind: "external"; url: URL; target: string };

export interface SessionStatus {
    signedIn: boolean;
    since?: string;
}

export class MoodleClient {
    private readonly session = new AuthSession();
    private keepalive: NodeJS.Timeout | null = null;

    async get(input: string): Promise<ClassroomResponse> {
        const url = readableClassroomUrl(input);
        const session = await this.session.current();
        this.startKeepalive();
        try {
            return await this.follow(url, session);
        } catch (error) {
            if (!(error instanceof SessionExpiredError)) throw error;
        }
        const renewed = await this.session.replaceExpired(session);
        try {
            return await this.follow(url, renewed);
        } catch (error) {
            if (error instanceof SessionExpiredError) throw new SessionRejectedError();
            throw error;
        }
    }

    async page(input: string): Promise<{ url: URL; html: string }> {
        const response = await this.get(input);
        if (response.kind === "external") throw new ExternalRedirectError(response.target);
        if (response.kind === "file") {
            await response.response.body?.cancel();
            throw new UnsadaError(`${response.url.pathname} is a file, not a page. Read it with unsada_read_file.`);
        }
        return response;
    }

    async signIn(wait: LoginWait): Promise<void> {
        await this.session.signIn(wait);
        this.startKeepalive();
    }

    async status(): Promise<SessionStatus> {
        const saved = await this.session.saved();
        if (!saved) return { signedIn: false };
        try {
            await this.follow(new URL("/my/", ORIGIN), saved);
            return { signedIn: true, since: saved.savedAt };
        } catch (error) {
            if (error instanceof SessionExpiredError) return { signedIn: false };
            throw error;
        }
    }

    private async follow(start: URL, session: StoredSession): Promise<ClassroomResponse> {
        let url = start;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const response = await this.fetchWithSession(url, session);
            const location = response.headers.get("location");
            if (response.status >= 300 && response.status < 400 && location) {
                await response.body?.cancel();
                const next = new URL(location, url);
                if (next.origin !== ORIGIN) return { kind: "external", url, target: next.href };
                if (next.pathname.startsWith("/login/")) throw new SessionExpiredError();
                if (next.pathname.startsWith("/enrol/")) throw new NotEnrolledError(start.pathname);
                assertReadable(next);
                url = next;
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                throw new ClassroomHttpError(response.status, url.pathname);
            }
            if (url.pathname.startsWith("/pluginfile.php/") || !isHtml(response)) {
                return { kind: "file", url, response };
            }
            const html = await readLimitedText(response, MAX_PAGE_BYTES, `The page ${url.pathname}`);
            if (isLoginPage(html)) throw new SessionExpiredError();
            await this.absorbSesskey(session, html);
            return { kind: "page", url, html };
        }
        throw new UnsadaError(`The classroom redirected ${start.pathname} too many times.`);
    }

    private async fetchWithSession(url: URL, session: StoredSession): Promise<Response> {
        const controller = new AbortController();
        const abortAfter = (milliseconds: number, message: string) => {
            const timer = setTimeout(() => controller.abort(new UnsadaError(message)), milliseconds);
            timer.unref();
            return timer;
        };
        const timers: RequestTimers = {
            stalled: abortAfter(
                REQUEST_TIMEOUT_MS,
                `The classroom stopped answering for ${REQUEST_TIMEOUT_MS / 1000} s.`,
            ),
            deadline: abortAfter(
                REQUEST_DEADLINE_MS,
                `The request took longer than ${REQUEST_DEADLINE_MS / 60_000} minutes.`,
            ),
        };
        let response: Response;
        try {
            response = await fetch(url, {
                headers: { cookie: cookieHeader(session) },
                redirect: "manual",
                signal: controller.signal,
            });
        } catch (error) {
            clearTimers(timers);
            throw new ClassroomUnreachableError(error);
        }
        timers.stalled.refresh();
        try {
            const changes = { cookies: cookieChanges(response) };
            // The next hop of a redirect chain must carry cookies this response rotated.
            applySessionChanges(session, changes);
            await updateSession(session.savedAt, changes);
        } catch (error) {
            clearTimers(timers);
            await response.body?.cancel();
            throw error;
        }
        return withIdleTimeout(response, timers);
    }

    private async absorbSesskey(session: StoredSession, html: string): Promise<void> {
        const sesskey = html.match(/"sesskey":"(\w{1,64})"/)?.[1];
        if (sesskey) await updateSession(session.savedAt, { sesskey });
    }

    private startKeepalive(): void {
        if (this.keepalive) return;
        this.keepalive = setInterval(() => {
            this.keepAlive().catch((error: unknown) => logger.warn(`Keepalive failed: ${String(error)}`));
        }, KEEPALIVE_INTERVAL_MS);
        this.keepalive.unref();
    }

    private async keepAlive(): Promise<void> {
        if (this.session.isSigningIn) return;
        const session = await this.session.saved();
        const sesskey = session?.sesskey;
        if (!session || !sesskey) return;
        // The only request that carries sesskey: a fixed endpoint that only extends the session.
        const url = new URL("/lib/sessionkeepalive_ajax.php", ORIGIN);
        url.searchParams.set("sesskey", sesskey);
        const response = await this.fetchWithSession(url, session);
        const body = await readLimitedText(response, 64 * 1024, "The keepalive answer");
        if (!response.ok || body.includes('"error"')) {
            logger.warn("The classroom session expired; the next tool call will renew it.");
        }
    }
}

interface RequestTimers {
    stalled: NodeJS.Timeout;
    deadline: NodeJS.Timeout;
}

const clearTimers = (timers: RequestTimers) => {
    clearTimeout(timers.stalled);
    clearTimeout(timers.deadline);
};

// The stall timeout restarts on every chunk, so a large file that keeps arriving is not cut off;
// the deadline never restarts, so a body trickling one byte at a time still ends.
function withIdleTimeout(response: Response, timers: RequestTimers): Response {
    if (!response.body || NULL_BODY_STATUSES.has(response.status)) {
        clearTimers(timers);
        return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    clearTimers(timers);
                    controller.close();
                    return;
                }
                timers.stalled.refresh();
                controller.enqueue(value);
            } catch (error) {
                clearTimers(timers);
                throw error;
            }
        },
        cancel(reason) {
            clearTimers(timers);
            return reader.cancel(reason);
        },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function cookieChanges(response: Response): Map<string, string | null> {
    const changes = new Map<string, string | null>();
    for (const header of response.headers.getSetCookie()) {
        const [pair = ""] = header.split(";");
        const separator = pair.indexOf("=");
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        const expired = value === "deleted" || /max-age=0/i.test(header);
        changes.set(name, expired ? null : value);
    }
    return changes;
}

const cookieHeader = (session: StoredSession) =>
    Object.entries(session.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");

const isHtml = (response: Response) => response.headers.get("content-type")?.includes("text/html") ?? false;

const isLoginPage = (html: string) =>
    html.includes('id="login"') && html.includes("<form") && !html.includes("/login/logout.php");
