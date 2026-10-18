import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sessionFile } from "../config.js";

/** Lo que hace falta para hablar con el aula como si fuera el navegador del usuario. */
export interface StoredSession {
    /** Cookies del aula por nombre (MoodleSession y compañía). */
    cookies: Record<string, string>;
    /** Token anti-CSRF de Moodle; lo pide el keepalive. */
    sesskey: string | null;
    savedAt: string;
}

export async function loadSession(): Promise<StoredSession | null> {
    try {
        return JSON.parse(await readFile(sessionFile(), "utf8")) as StoredSession;
    } catch {
        return null;
    }
}

export async function saveSession(session: StoredSession): Promise<void> {
    const file = sessionFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(session, null, 2), { mode: 0o600 });
    await chmod(file, 0o600).catch(() => {}); // no-op en Windows
}

export async function clearSession(): Promise<void> {
    await rm(sessionFile(), { force: true });
}
