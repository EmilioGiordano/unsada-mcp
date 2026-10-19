import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sessionFile } from "../config.js";
import { logger } from "../logger.js";

export interface StoredSession {
    cookies: Record<string, string>;
    sesskey: string | null;
    savedAt: string;
}

export async function readSession(): Promise<StoredSession | null> {
    let raw: string;
    try {
        raw = await readFile(sessionFile(), "utf8");
    } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
    }
    const parsed = parseJson(raw);
    if (isStoredSession(parsed)) return parsed;
    logger.warn("The saved session file is unreadable; a new sign-in will replace it.");
    return null;
}

let pendingWrite: Promise<void> = Promise.resolve();

export function writeSession(session: StoredSession): Promise<void> {
    const snapshot = JSON.stringify(session);
    const write = pendingWrite.then(() => writeAtomically(sessionFile(), snapshot));
    pendingWrite = write.catch(() => undefined);
    return write;
}

export interface SessionChanges {
    cookies?: ReadonlyMap<string, string | null>;
    sesskey?: string;
}

// Every server process shares this file, and several requests answer at once. Changes are applied to
// the file as it is now, and only when it still holds the sign-in the request was sent with.
export function updateSession(savedAt: string, changes: SessionChanges): Promise<void> {
    const update = pendingWrite.then(async () => {
        const current = await readSession();
        if (current?.savedAt !== savedAt || !applySessionChanges(current, changes)) return;
        await writeAtomically(sessionFile(), JSON.stringify(current));
    });
    pendingWrite = update.catch(() => undefined);
    return update;
}

export function applySessionChanges(session: StoredSession, changes: SessionChanges): boolean {
    let changed = false;
    for (const [name, value] of changes.cookies ?? []) {
        if (value === null && name in session.cookies) {
            delete session.cookies[name];
            changed = true;
        } else if (value !== null && session.cookies[name] !== value) {
            session.cookies[name] = value;
            changed = true;
        }
    }
    if (changes.sesskey !== undefined && session.sesskey !== changes.sesskey) {
        session.sesskey = changes.sesskey;
        changed = true;
    }
    return changed;
}

export async function deleteSession(): Promise<void> {
    await pendingWrite;
    await rm(sessionFile(), { force: true });
}

async function writeAtomically(file: string, contents: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
        await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function isStoredSession(value: unknown): value is StoredSession {
    if (typeof value !== "object" || value === null) return false;
    const { cookies, sesskey, savedAt } = value as Record<string, unknown>;
    return (
        typeof savedAt === "string" &&
        (sesskey === null || typeof sesskey === "string") &&
        typeof cookies === "object" &&
        cookies !== null &&
        Object.values(cookies).every((cookie) => typeof cookie === "string")
    );
}

const isMissingFile = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
