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

// Every server process shares this file: a process must not overwrite a session that another one
// renewed or deleted after this one read it, so updates only land on the same sign-in.
export function updateSession(session: StoredSession): Promise<boolean> {
    const snapshot = JSON.stringify(session);
    const update = pendingWrite.then(async () => {
        if ((await readSession())?.savedAt !== session.savedAt) return false;
        await writeAtomically(sessionFile(), snapshot);
        return true;
    });
    pendingWrite = update.then(
        () => undefined,
        () => undefined,
    );
    return update;
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
