import { type ParsedDocument, type Part, UnsupportedFormatError } from "../documents/document.js";
import { openDocument } from "../documents/open-document.js";
import { ExternalRedirectError, UnsadaError } from "../errors.js";
import { withTimeout } from "../lib/concurrency.js";
import { readLimited } from "../lib/streams.js";
import type { MoodleClient } from "../moodle/client.js";
import { readableClassroomUrl } from "../moodle/urls.js";
import { fileName } from "../scrape/html.js";
import { findResourceFile } from "../scrape/modules.js";

const BUDGET_CHARS = 30_000;
const IMAGE_COST_CHARS = 6_000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 60_000;

export interface FileRead {
    file: string;
    format: string;
    unit: string;
    total: number;
    from: number;
    to: number;
    next?: number;
    url: string;
    parts: (Part & { number: number })[];
}

export interface ClassroomFile {
    url: URL;
    response: Response;
}

export async function openClassroomFile(client: Pick<MoodleClient, "get">, input: string): Promise<ClassroomFile> {
    const url = readableClassroomUrl(input);
    if (!url.pathname.startsWith("/pluginfile.php/") && url.pathname !== "/mod/resource/view.php") {
        throw new UnsadaError(
            "Only classroom files (pluginfile.php) and resources (mod/resource/view.php) can be read.",
        );
    }
    const response = await client.get(url.href);
    switch (response.kind) {
        case "external":
            throw new ExternalRedirectError(response.target);
        case "file":
            return { url: response.url, response: response.response };
        case "page": {
            const file = url.pathname === "/mod/resource/view.php" ? findResourceFile(response.html) : undefined;
            if (!file) throw new UnsadaError(`${url.pathname} is a page that links to no file.`);
            const linked = await client.get(new URL(file, response.url).href);
            if (linked.kind !== "file") throw new UnsadaError(`The file linked from ${url.pathname} is not a file.`);
            return { url: linked.url, response: linked.response };
        }
    }
}

export async function readClassroomFile(client: MoodleClient, input: string, from = 1): Promise<FileRead> {
    const { url, response } = await openClassroomFile(client, input);
    const name = fileName(url.href);
    const bytes = await readLimited(response, MAX_FILE_BYTES, `The file ${name}`);
    const tooSlow = () => new UnsadaError(`Reading "${name}" took longer than ${PARSE_TIMEOUT_MS / 1000} s.`);
    const explain = (error: unknown): never => {
        throw readError(name, url, error);
    };

    const document = await withTimeout(openDocument(bytes, name), PARSE_TIMEOUT_MS, tooSlow).catch(explain);
    try {
        return await withTimeout(readParts(document, name, url, from), PARSE_TIMEOUT_MS, tooSlow).catch(explain);
    } finally {
        await document.close();
    }
}

function readError(name: string, url: URL, error: unknown): UnsadaError {
    const download = `The user can download it from ${url.href}`;
    if (error instanceof UnsupportedFormatError) return new UnsadaError(`${error.message} ${download}`);
    if (error instanceof UnsadaError) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return new UnsadaError(`"${name}" looks damaged and could not be read (${detail}). ${download}`);
}

async function readParts(document: ParsedDocument, name: string, url: URL, from: number): Promise<FileRead> {
    if (from > document.total) {
        throw new UnsadaError(`"${name}" ends at ${document.unit} ${document.total}; reading from ${from} was asked.`);
    }
    const parts: FileRead["parts"] = [];
    let spent = 0;
    let number = from;
    for (; number <= document.total; number++) {
        const part = await document.part(number);
        const cost = "text" in part ? part.text.length : IMAGE_COST_CHARS;
        // At least one part per call, even when it alone exceeds the budget.
        if (parts.length > 0 && spent + cost > BUDGET_CHARS) break;
        parts.push({ ...part, number });
        spent += cost;
    }
    return {
        file: name,
        format: document.format,
        unit: document.unit,
        total: document.total,
        from,
        to: number - 1,
        next: number <= document.total ? number : undefined,
        url: url.href,
        parts,
    };
}
