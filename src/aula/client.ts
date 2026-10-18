import { BASE_URL, ORIGIN } from "../config.js";
import { logger } from "../shared/logger.js";
import { browserLogin } from "./browser-login.js";
import { loadSession, saveSession, type StoredSession } from "./store.js";

const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 20;
/** Cuánto espera una tool a que el usuario termine el login antes de contestar que lo reintente. */
const LOGIN_WAIT_MS = 90_000;
/** Cada cuánto le avisamos al aula que la sesión sigue en uso. */
const KEEPALIVE_MS = 10 * 60_000;

export class LoginPendingError extends Error {
    constructor() {
        super(
            "Se abrió una ventana del navegador para iniciar sesión en el aula de la UNSAdA. " +
                "Pedile al usuario que entre con Google ahí y, cuando termine, volvé a intentar.",
        );
        this.name = "LoginPendingError";
    }
}

class SessionExpired extends Error {}

/** Una respuesta del aula: HTML, o el destino si la página redirige fuera del aula (mod/url). */
export interface AulaResponse {
    url: string;
    status: number;
    contentType: string | null;
    response: Response | null;
    /** Si el aula redirigió a otro sitio, a dónde. */
    external?: string;
}

/**
 * Habla con el aula como el navegador del usuario: con sus cookies. Si la sesión vence, abre el
 * login en el navegador y reintenta. Una sola instancia por proceso.
 */
export class AulaClient {
    private session: StoredSession | null = null;
    private loaded = false;
    private loggingIn: Promise<StoredSession> | null = null;
    private keepalive: NodeJS.Timeout | null = null;

    /** GET de una página del aula; devuelve el HTML y la URL final. */
    async page(pathOrUrl: string): Promise<{ url: string; html: string }> {
        const res = await this.request(pathOrUrl);
        if (res.external) throw new Error(`La página redirige fuera del aula: ${res.external}`);
        return { url: res.url, html: (await res.response?.text()) ?? "" };
    }

    /**
     * GET con la sesión, siguiendo redirecciones dentro del aula. Reintenta una vez tras renovar la
     * sesión. Quien llama lee `response` o lo cancela.
     */
    async request(pathOrUrl: string): Promise<AulaResponse> {
        const url = this.resolve(pathOrUrl);
        await this.ensureSession();
        try {
            return await this.fetchFollowing(url);
        } catch (e) {
            if (!(e instanceof SessionExpired)) throw e;
        }
        await this.renew();
        try {
            return await this.fetchFollowing(url);
        } catch (e) {
            if (e instanceof SessionExpired) throw new Error("El aula rechazó la sesión recién iniciada.");
            throw e;
        }
    }

    /**
     * Login explícito: abre el navegador aunque haya una sesión guardada. La CLI espera lo que haga
     * falta; una tool, a lo sumo lo que tolera un cliente MCP (`waitForLogin`).
     */
    async login(opts: { wait: "forever" | "tool" }): Promise<void> {
        if (opts.wait === "forever") this.session = await this.startLogin();
        else await this.waitForLogin();
    }

    /** Si hay una sesión guardada que el aula todavía acepta. No abre el navegador. */
    async status(): Promise<{ conectado: boolean; desde?: string }> {
        await this.load();
        if (!this.session) return { conectado: false };
        try {
            const res = await this.fetchFollowing(`${BASE_URL}/my/`);
            await res.response?.body?.cancel();
            return { conectado: true, desde: this.session.savedAt };
        } catch (e) {
            if (e instanceof SessionExpired) return { conectado: false };
            throw e;
        }
    }

    /** Solo URLs del aula: si no, mandaríamos las cookies del usuario a donde diga el modelo. */
    resolve(pathOrUrl: string): string {
        let u: URL;
        try {
            u = new URL(pathOrUrl, BASE_URL);
        } catch {
            throw new Error(`URL inválida: "${pathOrUrl}".`);
        }
        if (u.origin !== ORIGIN) throw new Error(`Solo se pueden abrir direcciones del aula (${ORIGIN}).`);
        return u.href;
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        this.session = await loadSession();
        this.loaded = true;
        if (this.session) this.startKeepalive();
    }

    private async ensureSession(): Promise<void> {
        await this.load();
        if (!this.session) await this.waitForLogin();
    }

    /**
     * La sesión venció. Antes de abrir el navegador mira el disco: otro proceso de unsada-mcp
     * (otro cliente MCP) puede haber iniciado sesión mientras tanto.
     */
    private async renew(): Promise<void> {
        const onDisk = await loadSession();
        if (onDisk && onDisk.savedAt !== this.session?.savedAt) {
            this.session = onDisk;
            return;
        }
        this.session = null;
        await this.waitForLogin();
    }

    private async waitForLogin(): Promise<void> {
        const login = this.startLogin();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new LoginPendingError()), LOGIN_WAIT_MS);
        });
        try {
            this.session = await Promise.race([login, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /** Un solo login a la vez, aunque varias tools lo necesiten juntas. Sigue aunque la tool deje de esperar. */
    private startLogin(): Promise<StoredSession> {
        this.loggingIn ??= browserLogin()
            .then(async (session) => {
                await saveSession(session);
                this.session = session;
                this.startKeepalive();
                return session;
            })
            .finally(() => {
                this.loggingIn = null;
            });
        // Si nadie espera el resultado (la tool ya contestó), que el error no tumbe el proceso.
        this.loggingIn.catch((e) => logger.warn("Login:", (e as Error).message));
        return this.loggingIn;
    }

    private startKeepalive(): void {
        if (this.keepalive) return;
        this.keepalive = setInterval(() => void this.ping(), KEEPALIVE_MS);
        this.keepalive.unref();
    }

    /** Mantiene viva la sesión mientras el servidor corre. Si ya venció, no abre nada: espera a la próxima tool. */
    private async ping(): Promise<void> {
        const session = this.session;
        if (!session?.sesskey || this.loggingIn) return;
        try {
            const res = await fetch(`${BASE_URL}/lib/sessionkeepalive_ajax.php?sesskey=${session.sesskey}`, {
                headers: { cookie: cookieHeader(session) },
                redirect: "manual",
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const text = await res.text();
            if (text.includes('"error"')) logger.warn("La sesión del aula venció; se renueva en la próxima consulta.");
        } catch (e) {
            logger.warn("Keepalive:", (e as Error).message);
        }
    }

    /** GET siguiendo redirecciones a mano: así vemos si el aula nos manda al login. */
    private async fetchFollowing(start: string): Promise<AulaResponse> {
        const session = this.session;
        if (!session) throw new SessionExpired();
        let url = start;
        for (let i = 0; i < MAX_REDIRECTS; i++) {
            let res: Response;
            try {
                res = await fetch(url, {
                    headers: { cookie: cookieHeader(session) },
                    redirect: "manual",
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });
            } catch (e) {
                throw new Error(`No se pudo conectar con el aula: ${(e as Error).message}`);
            }
            await this.absorbCookies(session, res);

            const location = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && location) {
                await res.body?.cancel();
                const next = new URL(location, url);
                if (next.origin !== ORIGIN) return { url, status: res.status, contentType: null, response: null, external: next.href };
                if (next.pathname.startsWith("/login/")) throw new SessionExpired();
                if (next.pathname.startsWith("/enrol/")) throw new Error("No estás inscripto en ese curso.");
                url = next.href;
                continue;
            }

            const contentType = res.headers.get("content-type");
            if (res.status === 404) {
                await res.body?.cancel();
                throw new Error(`El aula no encontró ${new URL(url).pathname} (404).`);
            }
            if (!res.ok) {
                await res.body?.cancel();
                throw new Error(`El aula respondió HTTP ${res.status} en ${new URL(url).pathname}.`);
            }
            if (contentType?.includes("text/html")) {
                // Algunas páginas no redirigen: muestran el formulario de login en el lugar.
                const html = await res.text();
                if (isLoginPage(html)) throw new SessionExpired();
                this.refreshSesskey(session, html);
                return { url, status: res.status, contentType, response: new Response(html) };
            }
            return { url, status: res.status, contentType, response: res };
        }
        throw new Error("Demasiadas redirecciones en el aula.");
    }

    private async absorbCookies(session: StoredSession, res: Response): Promise<void> {
        let changed = false;
        for (const c of res.headers.getSetCookie()) {
            const [pair] = c.split(";");
            const i = pair.indexOf("=");
            const name = pair.slice(0, i).trim();
            const value = pair.slice(i + 1).trim();
            if (value === "deleted" || /max-age=0/i.test(c)) {
                changed ||= name in session.cookies;
                delete session.cookies[name];
            } else if (session.cookies[name] !== value) {
                session.cookies[name] = value;
                changed = true;
            }
        }
        if (changed) await saveSession(session);
    }

    private refreshSesskey(session: StoredSession, html: string): void {
        const sesskey = html.match(/"sesskey":"([^"]+)"/)?.[1];
        if (sesskey && sesskey !== session.sesskey) {
            session.sesskey = sesskey;
            void saveSession(session);
        }
    }
}

const cookieHeader = (s: StoredSession) =>
    Object.entries(s.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

const isLoginPage = (html: string) =>
    /<form[^>]+id="login"/.test(html) && !/\/login\/logout\.php/.test(html);
