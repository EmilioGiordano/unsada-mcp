import { join, relative, sep } from "node:path";
import { downloadRoots, ORIGIN } from "../config.js";
import { LoginFailedError, LoginPendingError, SessionRejectedError, UnsadaError } from "../errors.js";
import { mapLimit } from "../lib/concurrency.js";
import { makeDirectoryInside, resolveDownloadDirectory, safeName } from "../lib/paths.js";
import { saveResponse } from "../lib/save-file.js";
import { logger } from "../logger.js";
import { MAX_CONCURRENT_REQUESTS, type MoodleClient } from "../moodle/client.js";
import { readableClassroomUrl } from "../moodle/urls.js";
import { fileName } from "../scrape/html.js";
import { parseFolder } from "../scrape/modules.js";
import { openClassroomFile } from "./files.js";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

export interface DownloadedFile {
    url: string;
    status: "saved" | "skipped" | "failed";
    path?: string;
    bytes?: number;
    error?: string;
}

export interface DownloadReport {
    directory: string;
    saved: number;
    skipped: number;
    failed: number;
    files: DownloadedFile[];
    omitted?: number;
}

interface PlannedFile {
    url: string;
    folders: string[];
}

export async function download(
    client: Pick<MoodleClient, "get" | "page">,
    urls: readonly string[],
    directory: string,
): Promise<DownloadReport> {
    const target = resolveDownloadDirectory(directory, downloadRoots());
    let signInError: UnsadaError | undefined;
    // Without a session every file would fail the same way, each one waiting for its own sign-in.
    const attempt = async <T>(run: () => Promise<T>): Promise<T | { failure: string }> => {
        if (signInError) return { failure: signInError.message };
        try {
            return await run();
        } catch (error) {
            if (needsSignIn(error)) signInError ??= error;
            return { failure: failureMessage(error) };
        }
    };

    const plans = (
        await mapLimit([...new Set(urls.map(withoutDownloadFlag))], MAX_CONCURRENT_REQUESTS, async (url) => {
            const result = await attempt(() => plan(client, url));
            return "failure" in result ? [{ url, error: result.failure }] : result;
        })
    ).flat();

    const planned = uniqueByUrl(plans.filter((item): item is PlannedFile => !("error" in item)));
    const accepted = planned.slice(0, MAX_FILES);
    const fetched = await mapLimit(accepted, MAX_CONCURRENT_REQUESTS, async (file): Promise<DownloadedFile> => {
        const result = await attempt(() => save(client, file, target));
        return "failure" in result ? { url: file.url, status: "failed", error: result.failure } : result;
    });
    const failedPlans = plans.flatMap((item): DownloadedFile[] =>
        "error" in item ? [{ url: item.url, status: "failed", error: item.error }] : [],
    );

    const files = [...fetched, ...failedPlans];
    const count = (status: DownloadedFile["status"]) => files.filter((file) => file.status === status).length;
    return {
        directory: target.path,
        saved: count("saved"),
        skipped: count("skipped"),
        failed: count("failed"),
        files,
        omitted: planned.length - accepted.length || undefined,
    };
}

async function plan(client: Pick<MoodleClient, "page">, input: string): Promise<PlannedFile[]> {
    const url = readableClassroomUrl(input);
    if (url.pathname !== "/mod/folder/view.php") return [{ url: url.href, folders: [] }];
    const folder = parseFolder((await client.page(url.href)).html);
    return folder.files.map((file) => ({
        url: withoutDownloadFlag(new URL(file.url, url).href),
        folders: [folder.title, ...file.path.split("/").slice(0, -1)].filter(Boolean),
    }));
}

async function save(
    client: Pick<MoodleClient, "get">,
    file: PlannedFile,
    target: { root: string; path: string },
): Promise<DownloadedFile> {
    const directory = join(target.path, ...file.folders.map(safeName));
    await makeDirectoryInside(target.root, directory);
    const { url, response } = await openClassroomFile(client, file.url);
    const saved = await saveResponse(response, directory, safeName(fileName(url.href)), MAX_FILE_BYTES, ORIGIN);
    return {
        url: url.href,
        status: saved.status,
        path: relative(target.path, saved.path).split(sep).join("/"),
        bytes: saved.bytes,
    };
}

// The same file is linked with and without forcedownload; both must count as one download.
function withoutDownloadFlag(input: string): string {
    if (!URL.canParse(input, ORIGIN)) return input;
    const url = new URL(input, ORIGIN);
    url.searchParams.delete("forcedownload");
    url.hash = "";
    return url.href;
}

function uniqueByUrl(files: PlannedFile[]): PlannedFile[] {
    return [...new Map(files.map((file) => [file.url, file])).values()];
}

const needsSignIn = (error: unknown): error is LoginPendingError | LoginFailedError | SessionRejectedError =>
    error instanceof LoginPendingError || error instanceof LoginFailedError || error instanceof SessionRejectedError;

function failureMessage(error: unknown): string {
    if (error instanceof UnsadaError) return error.message;
    logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return error instanceof Error ? error.message : String(error);
}
