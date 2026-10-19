import { LoginPendingError } from "../errors.js";
import { withTimeout } from "../lib/concurrency.js";
import { logger } from "../logger.js";
import { browserLogin } from "./browser-login.js";
import { readSession, type StoredSession, writeSession } from "./store.js";

const TOOL_LOGIN_WAIT_MS = 90_000;

export type LoginWait = "untilDone" | "toolBudget";

export class AuthSession {
    private signingIn: Promise<StoredSession> | null = null;

    get isSigningIn(): boolean {
        return this.signingIn !== null;
    }

    // Read on every request: another server process may have renewed the session, or `logout` deleted it.
    saved(): Promise<StoredSession | null> {
        return readSession();
    }

    async current(): Promise<StoredSession> {
        return (await this.saved()) ?? this.signIn("toolBudget");
    }

    async replaceExpired(expired: StoredSession): Promise<StoredSession> {
        const onDisk = await readSession();
        if (onDisk && onDisk.savedAt !== expired.savedAt) return onDisk;
        return this.signIn("toolBudget");
    }

    signIn(wait: LoginWait): Promise<StoredSession> {
        const signingIn = this.startSignIn();
        if (wait === "untilDone") return signingIn;
        return withTimeout(signingIn, TOOL_LOGIN_WAIT_MS, () => new LoginPendingError());
    }

    private startSignIn(): Promise<StoredSession> {
        if (this.signingIn) return this.signingIn;
        const signingIn = browserLogin()
            .then(async (signIn) => {
                // A session saved by another process is already on disk, and may have been updated since.
                if (signIn.kind === "thisWindow") await writeSession(signIn.session);
                return signIn.session;
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
