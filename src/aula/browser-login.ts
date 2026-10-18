import { chromium, type BrowserContext, type Page } from "playwright-core";
import { BASE_URL, browserProfileDir } from "../config.js";
import { logger } from "../shared/logger.js";
import type { StoredSession } from "./store.js";

/** Cuánto esperamos a que el usuario termine de entrar con Google. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1_000;

/**
 * Navegadores que ya estén instalados, en orden. No bajamos ninguno: Edge viene con Windows.
 * UNSADA_BROWSER fuerza uno (chrome, msedge, chrome-beta...).
 */
function channels(): string[] {
    if (process.env.UNSADA_BROWSER) return [process.env.UNSADA_BROWSER];
    return process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
}

async function launch(): Promise<BrowserContext> {
    const errors: string[] = [];
    for (const channel of channels()) {
        try {
            return await chromium.launchPersistentContext(browserProfileDir(), {
                channel,
                headless: false,
                viewport: null,
                args: ["--window-size=520,760"],
            });
        } catch (e) {
            const message = (e as Error).message;
            // Otro proceso de unsada-mcp (otro cliente MCP) ya tiene abierta la ventana con este perfil.
            if (/ProcessSingleton|already in use|lock/i.test(message)) {
                throw new Error("Ya hay una ventana de login del aula abierta. Terminá de entrar ahí y volvé a intentar.");
            }
            errors.push(`${channel}: ${message.split("\n")[0]}`);
        }
    }
    throw new Error(`No se pudo abrir Edge ni Chrome para iniciar sesión. ${errors.join(" | ")}`);
}

/**
 * Abre una ventana del navegador en el aula, deja que el usuario entre con Google y se queda con
 * las cookies de la sesión. El perfil es propio de unsada-mcp y persiste: la próxima vez Google ya
 * recuerda la cuenta y suele bastar un clic.
 */
export async function browserLogin(): Promise<StoredSession> {
    logger.info("Abriendo el navegador para iniciar sesión en el aula...");
    const context = await launch();
    try {
        const page = context.pages()[0] ?? (await context.newPage());
        let closed = false;
        page.on("close", () => (closed = true));

        await page.goto(`${BASE_URL}/my/`);
        await skipToGoogle(page);

        const deadline = Date.now() + LOGIN_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (closed) throw new Error("Se cerró la ventana antes de terminar el login.");
            const sesskey = await loggedInSesskey(page);
            if (sesskey) {
                const cookies = Object.fromEntries((await context.cookies(BASE_URL)).map((c) => [c.name, c.value]));
                logger.info("Sesión del aula iniciada.");
                return { cookies, sesskey, savedAt: new Date().toISOString() };
            }
            await page.waitForTimeout(POLL_MS).catch(() => {});
        }
        throw new Error("Pasaron 5 minutos sin completar el login.");
    } finally {
        await context.close().catch(() => {});
    }
}

/** En la página de login del aula, va directo al botón de Google para ahorrarle un clic al usuario. */
async function skipToGoogle(page: Page): Promise<void> {
    if (!new URL(page.url()).pathname.startsWith("/login/")) return;
    const href = await page
        .locator('a[href^="https://accounts.google.com/"]')
        .first()
        .getAttribute("href", { timeout: 5_000 })
        .catch(() => null);
    if (href) await page.goto(href).catch(() => {});
}

/** El sesskey si la página es del aula y el usuario está adentro; si no, null. */
async function loggedInSesskey(page: Page): Promise<string | null> {
    let url: URL;
    try {
        url = new URL(page.url());
    } catch {
        return null;
    }
    if (url.origin !== new URL(BASE_URL).origin) return null;
    if (url.pathname.startsWith("/login/") || url.pathname.startsWith("/auth/")) return null;
    return page
        .evaluate(() => {
            const w = window as unknown as { M?: { cfg?: { sesskey?: string } } };
            const loggedIn = !!document.querySelector('a[href*="/login/logout.php"]');
            return loggedIn ? (w.M?.cfg?.sesskey ?? null) : null;
        })
        .catch(() => null); // la página está navegando
}
