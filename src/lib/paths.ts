import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hasErrorCode, UnsafePathError } from "../errors.js";

const MAX_NAME_BYTES = 200;
const MAX_EXTENSION_LENGTH = 10;
const FALLBACK_NAME = "file";

// Format characters include bidi controls, which can disguise "gpj.exe" as "exe.jpg".
const INVALID_CHARACTERS = /[<>:"/\\|?*\p{Cc}\p{Cf}]/gu;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(\.|$)/i;
// Explorer reads these when it only lists the folder, and can send the user's NTLM hash to a remote host.
const EXPLORER_PARSED_EXTENSION = /\.(url|scf|lnk|library-ms|searchconnector-ms)$/i;

// Places where a written file runs at login or is loaded as code or agent instructions.
const PROTECTED_NAMES = new Set([
    "node_modules",
    "appdata",
    "start menu",
    "startup",
    "autostart",
    "launchagents",
    "launchdaemons",
    "claude.md",
    "claude.local.md",
    "agents.md",
    "agents.override.md",
    "opencode.json",
    "opencode.jsonc",
    "gemini.md",
    "copilot-instructions.md",
    "desktop.ini",
    "autorun.inf",
]);

export interface DownloadDirectory {
    root: string;
    path: string;
}

export function safeName(name: string): string {
    let safe = name
        .normalize("NFC")
        .replace(INVALID_CHARACTERS, "_")
        .replace(/^[.\s]+|[.\s]+$/g, "");
    if (!safe) safe = FALLBACK_NAME;
    if (RESERVED_WINDOWS_NAME.test(safe) || PROTECTED_NAMES.has(safe.toLowerCase())) safe = `_${safe}`;
    if (EXPLORER_PARSED_EXTENSION.test(safe)) safe = `${safe}.txt`;
    return truncateName(safe);
}

export function splitExtension(name: string): { stem: string; extension: string } {
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || name.length - dot > MAX_EXTENSION_LENGTH) return { stem: name, extension: "" };
    return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

export function resolveDownloadDirectory(directory: string, roots: readonly string[]): DownloadDirectory {
    const dotted = directory.split(/[\\/]+/).find((segment) => segment.startsWith("."));
    if (dotted !== undefined) throw new UnsafePathError(`"${dotted}" cannot be part of a download directory.`);

    const path = resolve(roots[0] ?? process.cwd(), directory);
    const root = roots.find((candidate) => isInside(candidate, path));
    if (root === undefined) {
        throw new UnsafePathError(
            "Downloads go under the directory the client was opened in. Pass a relative directory, " +
                "or ask the user to add the destination to UNSADA_DOWNLOAD_ROOTS.",
        );
    }
    const inner = relative(root, path).split(sep).filter(Boolean);
    if (inner.length === 0) {
        throw new UnsafePathError(
            "Downloads go into a subfolder, never straight into the directory the client was opened in, " +
                'where agents read their configuration. Pass a directory such as "Bases de Datos".',
        );
    }
    const unsafeInner = inner.find((segment) => segment.startsWith(".") || segment !== safeName(segment));
    if (unsafeInner !== undefined) {
        throw new UnsafePathError(`"${unsafeInner}" cannot be part of a download directory.`);
    }
    return { root, path };
}

// One level at a time, checked before going deeper, so a link to elsewhere never gets folders created through it.
export async function makeDirectoryInside(root: string, path: string): Promise<void> {
    const realRoot = await realpath(root);
    let current = root;
    for (const segment of relative(root, path).split(sep).filter(Boolean)) {
        current = join(current, segment);
        await mkdir(current).catch((error: unknown) => {
            if (!hasErrorCode(error, "EEXIST")) throw error;
        });
        if (!isInside(realRoot, await realpath(current))) {
            throw new UnsafePathError(`${current} resolves outside the download directory through a link.`);
        }
    }
}

export function isInside(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return path === "" || (path.split(sep)[0] !== ".." && !isAbsolute(path));
}

function truncateName(name: string): string {
    if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name;
    const { stem, extension } = splitExtension(name);
    let kept = "";
    for (const character of stem) {
        if (Buffer.byteLength(kept + character + extension) > MAX_NAME_BYTES) break;
        kept += character;
    }
    return `${kept.replace(/[.\s]+$/, "")}${extension}`;
}
