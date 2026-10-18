import { LoginPendingError } from "../errors.js";
import { withTimeout } from "../lib/concurrency.js";
import { logger } from "../logger.js";
import { browserLogin } from "./browser-login.js";
import { readSession, type StoredSession, writeSession } from "./store.js";

const TOOL_LOGIN_WAIT_MS = 90_000;

export type LoginWait = "untilDone" | "toolBudget";

export class AuthSession {
    private stored: StoredSession | null = null;
    private loaded = false;
    private signingIn: Promise<StoredSession> | null = null;

    get isSigningIn(): boolean {
        return this.signingIn !== null;
    }

    get sesskey(): string | null {
        return this.stored?.sesskey ?? null;
    }

    async saved(): Promise<StoredSession | null> {
        if (!this.loaded) {
            this.stored = await readSession();
            this.loaded = true;
        }
        return this.stored;
    }

    async current(): Promise<StoredSession> {
        return (await this.saved()) ?? this.signIn("toolBudget");
    }

    async replaceExpired(expired: StoredSession): Promise<StoredSession> {
        const onDisk = await readSession();
        if (onDisk && onDisk.savedAt !== expired.savedAt) {
            this.stored = onDisk;
            return onDisk;
        }
        this.stored = null;
        return this.signIn("toolBudget");
    }

    signIn(wait: LoginWait): Promise<StoredSession> {
        const signingIn = this.startSignIn();
        if (wait === "untilDone") return signingIn;
        return withTimeout(signingIn, TOOL_LOGIN_WAIT_MS, () => new LoginPendingError());
    }

    cookieHeader(): string {
        return Object.entries(this.stored?.cookies ?? {})
            .map(([name, value]) => `${name}=${value}`)
            .join("; ");
    }

    async applyCookies(changes: ReadonlyMap<string, string | null>): Promise<void> {
        const stored = this.stored;
        if (!stored) return;
        let changed = false;
        for (const [name, value] of changes) {
            if (value === null && name in stored.cookies) {
                delete stored.cookies[name];
                changed = true;
            } else if (value !== null && stored.cookies[name] !== value) {
                stored.cookies[name] = value;
                changed = true;
            }
        }
        if (changed) await writeSession(stored);
    }

    async applySesskey(sesskey: string): Promise<void> {
        const stored = this.stored;
        if (!stored || stored.sesskey === sesskey) return;
        stored.sesskey = sesskey;
        await writeSession(stored);
    }

    private startSignIn(): Promise<StoredSession> {
        if (this.signingIn) return this.signingIn;
        const signingIn = browserLogin()
            .then(async (session) => {
                await writeSession(session);
                this.stored = session;
                this.loaded = true;
                return session;
            })
            .finally(() => {
                this.signingIn = null;
            });
        // A tool may stop waiting before the user finishes; the failure must still be observed.
        signingIn.catch((error: unknown) => logger.warn(`Sign-in did not complete: ${String(error)}`));
        this.signingIn = signingIn;
        return signingIn;
    }
}
