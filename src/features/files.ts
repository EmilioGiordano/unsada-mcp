import { type ParsedDocument, type Part, UnsupportedFormatError } from "../documents/document.js";
import { openDocument } from "../documents/open-document.js";
import { ExternalRedirectError, TooLargeError, UnsadaError } from "../errors.js";
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
const KEEP_FILE_MS = 10 * 60_000;
const KEPT_BYTES = 60 * 1024 * 1024;

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
    if (url.pathname === "/mod/url/view.php") {
        throw new UnsadaError("/mod/url/view.php is a link to another site, not a file. Open it with unsada_open.");
    }
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

export type FileReader = (input: string, from?: number, withFigures?: boolean) => Promise<FileRead>;

interface FetchedFile {
    keys: string[];
    url: URL;
    bytes: Uint8Array;
    expires: number;
}

// The model reads a file one call per group of parts; keeping the bytes spares a download per call.
export function fileReader(client: Pick<MoodleClient, "get">): FileReader {
    let fetched: FetchedFile[] = [];

    const fetchFile = async (input: string): Promise<FetchedFile> => {
        const key = readableClassroomUrl(input).href;
        const now = Date.now();
        fetched = fetched.filter((file) => file.expires > now);
        const known = fetched.find((file) => file.keys.includes(key));
        if (known) return known;

        const { url, response } = await openClassroomFile(client, input);
        const name = fileName(url.href);
        const bytes = await readLimited(response, MAX_FILE_BYTES, `The file ${name}`).catch((error: unknown) => {
            throw readError(name, url, error);
        });
        const file = { keys: [key, url.href], url, bytes, expires: now + KEEP_FILE_MS };
        fetched = [file, ...fetched];
        let kept = 0;
        fetched = fetched.filter((entry) => {
            kept += entry.bytes.byteLength;
            return kept <= KEPT_BYTES || entry === file;
        });
        return file;
    };

    return async (input, from = 1, withFigures = false) => {
        const { url, bytes } = await fetchFile(input);
        const name = fileName(url.href);
        const tooSlow = () => new UnsadaError(`Reading "${name}" took longer than ${PARSE_TIMEOUT_MS / 1000} s.`);
        const explain = (error: unknown): never => {
            throw readError(name, url, error);
        };
        // pdf.js can take over the buffer it is given, and the kept bytes must survive for the next call.
        const document = await withTimeout(openDocument(bytes.slice(), name), PARSE_TIMEOUT_MS, tooSlow).catch(explain);
        try {
            return await withTimeout(
                readParts(document, name, url, from, withFigures),
                PARSE_TIMEOUT_MS,
                tooSlow,
            ).catch(explain);
        } finally {
            await document.close();
        }
    };
}

function readError(name: string, url: URL, error: unknown): UnsadaError {
    if (error instanceof TooLargeError)
        return new UnsadaError(`${error.message} Save it with unsada_download instead.`);
    if (error instanceof UnsupportedFormatError) return new UnsadaError(`${error.message} ${downloadHint(url)}`);
    if (error instanceof UnsadaError) return error;
    return new UnsadaError(damaged(`"${name}"`, url, error));
}

const downloadHint = (url: URL) => `The user can download the file from ${url.href}`;

const damaged = (subject: string, url: URL, error: unknown) =>
    `${subject} looks damaged and could not be read (${error instanceof Error ? error.message : String(error)}). ${downloadHint(url)}`;

async function readParts(
    document: ParsedDocument,
    name: string,
    url: URL,
    from: number,
    withFigures: boolean,
): Promise<FileRead> {
    if (from > document.total) {
        throw new UnsadaError(`"${name}" ends at ${document.unit} ${document.total}; reading from ${from} was asked.`);
    }
    const parts: FileRead["parts"] = [];
    const failures: unknown[] = [];
    let readable = false;
    let spent = 0;
    let number = from;
    for (; number <= document.total; number++) {
        let part: Part;
        try {
            part = await document.part(number, withFigures);
            readable = true;
        } catch (error) {
            // A page the parser chokes on must not hide the rest; typed errors carry their own instructions.
            if (error instanceof UnsadaError) throw error;
            failures.push(error);
            part = { title: "unreadable", text: damaged(`${document.unit} ${number}`, url, error) };
        }
        const cost = "text" in part ? part.text.length + (part.figureImage ? IMAGE_COST_CHARS : 0) : IMAGE_COST_CHARS;
        // At least one part per call, even when it alone exceeds the budget.
        if (parts.length > 0 && spent + cost > BUDGET_CHARS) break;
        parts.push({ ...part, number });
        spent += cost;
    }
    if (!readable) throw readError(name, url, failures[0]);
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
