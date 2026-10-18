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
import { assertReadable, readableClassroomUrl } from "./urls.js";

export const MAX_CONCURRENT_REQUESTS = 4;

const REQUEST_TIMEOUT_MS = 30_000;
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
            return await this.follow(url);
        } catch (error) {
            if (!(error instanceof SessionExpiredError)) throw error;
        }
        await this.session.replaceExpired(session);
        try {
            return await this.follow(url);
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
            await this.follow(new URL("/my/", ORIGIN));
            return { signedIn: true, since: saved.savedAt };
        } catch (error) {
            if (error instanceof SessionExpiredError) return { signedIn: false };
            throw error;
        }
    }

    private async follow(start: URL): Promise<ClassroomResponse> {
        let url = start;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const response = await this.fetchWithSession(url);
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
            await this.absorbSesskey(html);
            return { kind: "page", url, html };
        }
        throw new UnsadaError(`The classroom redirected ${start.pathname} too many times.`);
    }

    private async fetchWithSession(url: URL): Promise<Response> {
        let response: Response;
        try {
            response = await fetch(url, {
                headers: { cookie: this.session.cookieHeader() },
                redirect: "manual",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            throw new ClassroomUnreachableError(error);
        }
        await this.session.applyCookies(cookieChanges(response));
        return response;
    }

    private async absorbSesskey(html: string): Promise<void> {
        const sesskey = html.match(/"sesskey":"(\w{1,64})"/)?.[1];
        if (sesskey) await this.session.applySesskey(sesskey);
    }

    private startKeepalive(): void {
        if (this.keepalive) return;
        this.keepalive = setInterval(() => {
            this.keepAlive().catch((error: unknown) => logger.warn(`Keepalive failed: ${String(error)}`));
        }, KEEPALIVE_INTERVAL_MS);
        this.keepalive.unref();
    }

    private async keepAlive(): Promise<void> {
        const sesskey = this.session.sesskey;
        if (!sesskey || this.session.isSigningIn) return;
        // The only request that carries sesskey: a fixed endpoint that only extends the session.
        const url = new URL("/lib/sessionkeepalive_ajax.php", ORIGIN);
        url.searchParams.set("sesskey", sesskey);
        const response = await this.fetchWithSession(url);
        const body = await readLimitedText(response, 64 * 1024, "The keepalive answer");
        if (!response.ok || body.includes('"error"')) {
            logger.warn("The classroom session expired; the next tool call will renew it.");
        }
    }
}

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

const isHtml = (response: Response) => response.headers.get("content-type")?.includes("text/html") ?? false;

const isLoginPage = (html: string) =>
    html.includes('id="login"') && html.includes("<form") && !html.includes("/login/logout.php");
