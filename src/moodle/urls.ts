import { BASE_URL, ORIGIN } from "../config.js";
import { ForbiddenUrlError } from "../errors.js";

const INTEGER = /^\d{1,10}$/;

const PARAMS = {
    id: INTEGER,
    section: INTEGER,
    page: INTEGER,
    f: INTEGER,
    d: INTEGER,
    parent: INTEGER,
    course: INTEGER,
    time: INTEGER,
    view: /^(day|month|upcoming)$/,
    forcedownload: /^[01]$/,
    preview: /^(thumb|bigthumb|tinyicon)$/,
} as const;

type Param = keyof typeof PARAMS;

interface ReadablePage {
    path: RegExp;
    params: readonly Param[];
}

const READABLE_PAGES: readonly ReadablePage[] = [
    { path: /^\/my\/(index\.php)?$/, params: [] },
    { path: /^\/course\/view\.php$/, params: ["id", "section"] },
    { path: /^\/mod\/forum\/view\.php$/, params: ["id", "f", "page"] },
    { path: /^\/mod\/forum\/discuss\.php$/, params: ["d", "parent"] },
    { path: /^\/mod\/[a-z0-9]+\/view\.php$/, params: ["id"] },
    { path: /^\/mod\/[a-z0-9]+\/index\.php$/, params: ["id"] },
    { path: /^\/grade\/report\/(overview|user)\/index\.php$/, params: ["id"] },
    { path: /^\/calendar\/view\.php$/, params: ["view", "time", "course"] },
    { path: /^\/pluginfile\.php\/.+$/, params: ["forcedownload", "time", "preview"] },
];

export function readableClassroomUrl(input: string): URL {
    if (!input.trim()) throw new ForbiddenUrlError("The url is empty. Pass a url returned by the other tools.");
    let url: URL;
    try {
        url = new URL(input, BASE_URL);
    } catch {
        throw new ForbiddenUrlError(`"${input}" is not a valid URL.`);
    }
    assertReadable(url);
    url.hash = "";
    return url;
}

export function assertReadable(url: URL): void {
    if (url.origin !== ORIGIN || url.username || url.password) {
        throw new ForbiddenUrlError(`Only classroom addresses (${ORIGIN}) can be opened.`);
    }
    if (!isReadable(url)) {
        throw new ForbiddenUrlError(
            `${url.pathname} with these parameters is not a page this server reads. Use the URLs returned by the other tools: ` +
                "courses, activities, forums, discussions, files, grades and the calendar.",
        );
    }
}

export function isReadable(url: URL): boolean {
    if (url.origin !== ORIGIN || url.username || url.password) return false;
    return READABLE_PAGES.some((page) => page.path.test(url.pathname) && acceptsParams(page, url.searchParams));
}

function acceptsParams(page: ReadablePage, params: URLSearchParams): boolean {
    for (const [name, value] of params) {
        if (!isParam(name) || !page.params.includes(name) || !PARAMS[name].test(value)) return false;
    }
    return true;
}

const isParam = (name: string): name is Param => Object.hasOwn(PARAMS, name);
