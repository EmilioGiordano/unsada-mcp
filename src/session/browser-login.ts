import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { BASE_URL, ORIGIN } from "../config.js";
import { LoginFailedError } from "../errors.js";
import { logger } from "../logger.js";
import { readSession, type StoredSession } from "./store.js";

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1_000;
const GOOGLE_SIGN_IN = 'a[href^="https://accounts.google.com/"]';

export type SignIn =
    | { kind: "thisWindow"; session: StoredSession }
    | { kind: "anotherProcess"; session: StoredSession };

// The window keeps nothing on disk: a saved Google sign-in would hand the user's whole account to any
// local script, so every sign-in asks for the Google credentials again.
export async function browserLogin(): Promise<SignIn> {
    const startedAt = Date.now();
    logger.info("Opening the browser to sign in to the classroom.");
    const browser = await launch();
    try {
        const context = await browser.newContext({ viewport: null });
        return await waitForSignIn(context, startedAt);
    } finally {
        await browser.close().catch((error: unknown) => logger.warn(`Could not close the login browser: ${error}`));
    }
}

function browserChannels(): string[] {
    if (process.env.UNSADA_BROWSER) return [process.env.UNSADA_BROWSER];
    return process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
}

async function launch(): Promise<Browser> {
    const failures: string[] = [];
    for (const channel of browserChannels()) {
        try {
            return await chromium.launch({ channel, headless: false, args: ["--window-size=520,760"] });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${channel}: ${message.split("\n")[0]}`);
        }
    }
    throw new LoginFailedError(`Could not open Edge or Chrome to sign in. ${failures.join(" | ")}`);
}

async function waitForSignIn(context: BrowserContext, startedAt: number): Promise<SignIn> {
    const page = await context.newPage();
    let closed = false;
    page.on("close", () => {
        closed = true;
    });

    await page.goto(`${BASE_URL}/my/`);
    await skipToGoogle(page);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (closed) throw new LoginFailedError("The sign-in window was closed before the user finished signing in.");
        // Another server process may have opened its own window; once the user signs in there, this one closes.
        const saved = await savedSession();
        if (saved && Date.parse(saved.savedAt) > startedAt) return { kind: "anotherProcess", session: saved };
        const sesskey = await signedInSesskey(page);
        if (sesskey) {
            const cookies = Object.fromEntries((await context.cookies(BASE_URL)).map((c) => [c.name, c.value]));
            logger.info("Signed in to the classroom.");
            return { kind: "thisWindow", session: { cookies, sesskey, savedAt: new Date().toISOString() } };
        }
        await sleep(POLL_MS);
    }
    throw new LoginFailedError("Five minutes passed without the user finishing the sign-in.");
}

async function savedSession(): Promise<StoredSession | null> {
    try {
        return await readSession();
    } catch (error) {
        // Windows refuses a read for a moment while another process replaces the file; the next poll reads it.
        if (!isBusyFile(error)) throw error;
        logger.warn(`The saved session file is busy; reading it again: ${String(error)}`);
        return null;
    }
}

const isBusyFile = (error: unknown) =>
    error instanceof Error && "code" in error && (error.code === "EBUSY" || error.code === "EPERM");

async function skipToGoogle(page: Page): Promise<void> {
    if (!new URL(page.url()).pathname.startsWith("/login/")) return;
    const google = page.locator(GOOGLE_SIGN_IN).first();
    if ((await google.count()) === 0) return;
    // A goto to Google throws ERR_ABORTED when Google redirects before the load event; a click tolerates that abort.
    await google.click();
}

async function signedInSesskey(page: Page): Promise<string | null> {
    const url = URL.parse(page.url());
    if (!url || url.origin !== ORIGIN) return null;
    if (url.pathname.startsWith("/login/") || url.pathname.startsWith("/auth/")) return null;
    try {
        return await page.evaluate(() => {
            const logout = document.querySelector<HTMLAnchorElement>('a[href*="/login/logout.php"]');
            return logout ? new URL(logout.href).searchParams.get("sesskey") : null;
        });
    } catch {
        // The page is navigating between the classroom and Google; the next poll reads the new page.
        return null;
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
