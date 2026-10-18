import { type BrowserContext, chromium, type Page } from "playwright-core";
import { BASE_URL, browserProfileDir, ORIGIN } from "../config.js";
import { LoginFailedError } from "../errors.js";
import { logger } from "../logger.js";
import type { StoredSession } from "./store.js";

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1_000;
const GOOGLE_SIGN_IN = 'a[href^="https://accounts.google.com/"]';

export async function browserLogin(): Promise<StoredSession> {
    logger.info("Opening the browser to sign in to the classroom.");
    const context = await launch();
    try {
        return await waitForSignIn(context);
    } finally {
        await context.close().catch((error: unknown) => logger.warn(`Could not close the login browser: ${error}`));
    }
}

function browserChannels(): string[] {
    if (process.env.UNSADA_BROWSER) return [process.env.UNSADA_BROWSER];
    return process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
}

async function launch(): Promise<BrowserContext> {
    const failures: string[] = [];
    for (const channel of browserChannels()) {
        try {
            return await chromium.launchPersistentContext(browserProfileDir(), {
                channel,
                headless: false,
                viewport: null,
                args: ["--window-size=520,760"],
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/ProcessSingleton|already in use|lock/i.test(message)) {
                throw new LoginFailedError(
                    "A classroom sign-in window is already open. Ask the user to finish signing in there and try again.",
                );
            }
            failures.push(`${channel}: ${message.split("\n")[0]}`);
        }
    }
    throw new LoginFailedError(`Could not open Edge or Chrome to sign in. ${failures.join(" | ")}`);
}

async function waitForSignIn(context: BrowserContext): Promise<StoredSession> {
    const page = context.pages()[0] ?? (await context.newPage());
    let closed = false;
    page.on("close", () => {
        closed = true;
    });

    await page.goto(`${BASE_URL}/my/`);
    await skipToGoogle(page);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (closed) throw new LoginFailedError("The sign-in window was closed before the user finished signing in.");
        const sesskey = await signedInSesskey(page);
        if (sesskey) {
            const cookies = Object.fromEntries((await context.cookies(BASE_URL)).map((c) => [c.name, c.value]));
            logger.info("Signed in to the classroom.");
            return { cookies, sesskey, savedAt: new Date().toISOString() };
        }
        await sleep(POLL_MS);
    }
    throw new LoginFailedError("Five minutes passed without the user finishing the sign-in.");
}

async function skipToGoogle(page: Page): Promise<void> {
    if (!new URL(page.url()).pathname.startsWith("/login/")) return;
    const google = page.locator(GOOGLE_SIGN_IN).first();
    if ((await google.count()) === 0) return;
    const href = await google.getAttribute("href");
    if (href) await page.goto(href);
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
