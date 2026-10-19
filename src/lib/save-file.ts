import { randomBytes } from "node:crypto";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { hasErrorCode, isFileHeld, TooLargeError, UnsadaError } from "../errors.js";
import { logger } from "../logger.js";
import { splitExtension } from "./paths.js";

const MAX_COPIES = 100;
const RENAME_ATTEMPTS = 5;

export interface SavedFile {
    path: string;
    status: "saved" | "skipped";
    bytes: number;
}

export async function saveResponse(
    response: Response,
    directory: string,
    name: string,
    maxBytes: number,
    origin: string,
): Promise<SavedFile> {
    if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw new TooLargeError(`The file ${name}`, maxBytes);
    }
    const temporary = join(directory, `.${randomBytes(6).toString("hex")}.part`);
    try {
        const bytes = await writeLimited(response.body, temporary, maxBytes, name);
        await markAsDownloaded(temporary, origin);
        return await placeWithoutOverwrite(temporary, directory, name, bytes);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function writeLimited(
    body: ReadableStream<Uint8Array> | null,
    file: string,
    maxBytes: number,
    name: string,
): Promise<number> {
    const handle = await open(file, "wx", 0o644).catch(async (error: unknown) => {
        await body?.cancel();
        throw error;
    });
    const reader = body?.getReader();
    let total = 0;
    try {
        if (!reader) return 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return total;
            total += value.byteLength;
            if (total > maxBytes) throw new TooLargeError(`The file ${name}`, maxBytes);
            await handle.write(value);
        }
    } catch (error) {
        await reader?.cancel();
        throw error;
    } finally {
        await handle.close();
    }
}

// Antivirus scanners briefly hold new files open on Windows, which makes rename fail with EPERM or EBUSY.
async function renameWhenReleased(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await rename(from, to);
        } catch (error) {
            if (!isFileHeld(error) || attempt === RENAME_ATTEMPTS) throw error;
            await setTimeout(attempt * 100);
        }
    }
}

// Windows shows its SmartScreen warning before running a file only when it carries this mark;
// the stream moves with the file on rename. Drives without streams (FAT, exFAT) cannot hold it.
async function markAsDownloaded(file: string, origin: string): Promise<void> {
    if (process.platform !== "win32") return;
    await writeFile(
        `${file}:Zone.Identifier`,
        `[ZoneTransfer]
ZoneId=3
HostUrl=${origin}/
`,
    ).catch((error: unknown) =>
        logger.warn(`Could not mark ${file} as downloaded from the internet: ${String(error)}`),
    );
}

// The final name is reserved with an exclusive create, so a concurrent writer can never be overwritten.
async function placeWithoutOverwrite(temporary: string, directory: string, name: string, bytes: number) {
    const { stem, extension } = splitExtension(name);
    for (let copy = 1; copy <= MAX_COPIES; copy++) {
        const path = join(directory, copy === 1 ? name : `${stem} (${copy})${extension}`);
        const existing = await lstat(path).catch((error: unknown) => {
            if (hasErrorCode(error, "ENOENT")) return null;
            throw error;
        });
        if (existing) {
            if (existing.isFile() && existing.size === bytes) return { path, status: "skipped" as const, bytes };
            continue;
        }
        const reserved = await open(path, "wx").catch((error: unknown) => {
            if (hasErrorCode(error, "EEXIST")) return null;
            throw error;
        });
        if (!reserved) continue;
        await reserved.close();
        await renameWhenReleased(temporary, path).catch(async (error: unknown) => {
            await rm(path, { force: true });
            throw error;
        });
        return { path, status: "saved" as const, bytes };
    }
    throw new UnsadaError(`More than ${MAX_COPIES} different files named "${name}" already exist there.`);
}
