import { UnsadaError } from "../errors.js";
import type { MoodleClient } from "../moodle/client.js";
import { readableClassroomUrl } from "../moodle/urls.js";
import { type Assignment, parseAssignment } from "../scrape/assign.js";
import { type Discussion, type Forum, parseDiscussion, parseForum } from "../scrape/forum.js";
import { fileName, integerParam } from "../scrape/html.js";
import {
    type ContentPage,
    type Folder,
    type ModulePage,
    parseContentPage,
    parseFolder,
    parseModulePage,
} from "../scrape/modules.js";
import { type Course, getCourse } from "./courses.js";
import { openClassroomFile } from "./files.js";

const READ_FILE_HINT = "Read it with unsada_read_file using this url.";

export type Opened =
    | ({ kind: "course" } & Course)
    | ({ kind: "forum" } & Forum)
    | ({ kind: "discussion" } & Discussion)
    | ({ kind: "page" } & ContentPage)
    | ({ kind: "folder" } & Folder)
    | ({ kind: "assignment" } & Assignment)
    | { kind: "file"; name: string; url: string; hint: string }
    | ({ kind: "link"; url: string } & Partial<ModulePage>)
    | ({ kind: "module"; module: string } & ModulePage);

export async function open(client: Pick<MoodleClient, "get" | "page">, input: string, page = 0): Promise<Opened> {
    const url = readableClassroomUrl(input);
    const fetchHtml = async () => (await client.page(url.href)).html;

    switch (url.pathname) {
        case "/course/view.php": {
            const id = integerParam(url.href);
            if (id === undefined) throw new UnsadaError("The course url has no valid id.");
            return { kind: "course", ...(await getCourse(client, id)) };
        }
        case "/mod/forum/view.php":
            if (page > 0) url.searchParams.set("page", String(page));
            return { kind: "forum", ...parseForum(await fetchHtml(), page) };
        case "/mod/forum/discuss.php":
            return { kind: "discussion", ...parseDiscussion(await fetchHtml()) };
        case "/mod/page/view.php":
            return { kind: "page", ...parseContentPage(await fetchHtml()) };
        case "/mod/folder/view.php":
            return { kind: "folder", ...parseFolder(await fetchHtml()) };
        case "/mod/assign/view.php":
            return { kind: "assignment", ...parseAssignment(await fetchHtml()) };
        case "/mod/resource/view.php": {
            const file = await openClassroomFile(client, url.href);
            await file.response.body?.cancel();
            return fileResult(file.url);
        }
        case "/mod/url/view.php":
            return openLink(client, url);
    }
    if (url.pathname.startsWith("/pluginfile.php/")) return fileResult(url);

    const module = url.pathname.match(/^\/mod\/([a-z0-9]+)\/view\.php$/)?.[1];
    if (!module) {
        throw new UnsadaError(
            `unsada_open does not read ${url.pathname}; use the tool for courses, grades or the calendar.`,
        );
    }
    return { kind: "module", module, ...parseModulePage(await fetchHtml()) };
}

async function openLink(client: Pick<MoodleClient, "get">, url: URL): Promise<Opened> {
    const response = await client.get(url.href);
    switch (response.kind) {
        case "external":
            return { kind: "link", url: response.target };
        case "file":
            await response.response.body?.cancel();
            return fileResult(response.url);
        case "page":
            return { kind: "link", url: url.href, ...parseModulePage(response.html) };
    }
}

const fileResult = (url: URL): Opened => ({
    kind: "file",
    name: fileName(url.href),
    url: url.href,
    hint: READ_FILE_HINT,
});
