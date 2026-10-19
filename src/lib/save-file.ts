import { randomBytes } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode, TooLargeError, UnsadaError } from "../errors.js";
import { splitExtension } from "./paths.js";

const MAX_COPIES = 100;

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
): Promise<SavedFile> {
    if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw new TooLargeError(`The file ${name}`, maxBytes);
    }
    const temporary = join(directory, `.${randomBytes(6).toString("hex")}.part`);
    try {
        const bytes = await writeLimited(response.body, temporary, maxBytes, name);
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
    const handle = await open(file, "wx", 0o644);
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
        await rename(temporary, path).catch(async (error: unknown) => {
            await rm(path, { force: true });
            throw error;
        });
        return { path, status: "saved" as const, bytes };
    }
    throw new UnsadaError(`More than ${MAX_COPIES} different files named "${name}" already exist there.`);
}
