import {
    carriesSesskey,
    clean,
    decodeComponent,
    type FileLink,
    type Fragment,
    fileLinks,
    type Html,
    load,
    mainRegion,
    richText,
} from "./html.js";
import { dateOrText } from "./values.js";

export interface ModulePage {
    title: string;
    text: string;
    files: FileLink[];
}

export interface ContentPage extends ModulePage {
    modified?: string;
}

export interface FolderFile extends FileLink {
    path: string;
}

export interface Folder {
    title: string;
    description?: string;
    files: FolderFile[];
}

export interface LinkPage extends ModulePage {
    target?: string;
}

export function parseModulePage(html: string): ModulePage {
    const $ = load(html);
    return modulePage($, moduleBody($));
}

export function parseLinkPage(html: string): LinkPage {
    const $ = load(html);
    const body = moduleBody($);
    const workaround = body.find(".urlworkaround").first();
    const target = workaround.find("a[href]").first().attr("href");
    if (!target || !/^https?:\/\//i.test(target) || carriesSesskey(target)) return modulePage($, body);
    workaround.remove();
    return { target, ...modulePage($, body) };
}

function moduleBody($: Html): Fragment {
    const body = mainRegion($).find("[role=main]").first().clone();
    body.find(".row-fluid .heading-rts, .footer-rts, h2").remove();
    return body;
}

function modulePage($: Html, body: Fragment): ModulePage {
    return {
        title: clean(mainRegion($).find("h2").first().text()),
        text: richText($, body),
        files: fileLinks($, body),
    };
}

export function parseContentPage(html: string): ContentPage {
    const $ = load(html);
    const main = mainRegion($);
    const box = main.find(".box.generalbox").first();
    return {
        title: clean(main.find("h2").first().text()),
        text: richText($, box),
        files: fileLinks($, box),
        modified: dateOrText(clean(main.find(".modified").text())),
    };
}

export function parseFolder(html: string): Folder {
    const $ = load(html);
    const main = mainRegion($);
    return {
        title: clean(main.find("h2").first().text()),
        description: richText($, main.find("#intro").first()) || undefined,
        files: fileLinks($, main.find(".foldertree")).map((file) => ({ ...file, path: folderPath(file) })),
    };
}

export function findResourceFile(html: string): string | undefined {
    const $ = load(html);
    const main = mainRegion($);
    const candidates = [
        [".resourceworkaround a", "href"],
        ["object", "data"],
        ["iframe", "src"],
        ["a", "href"],
        ["img", "src"],
    ] as const;
    for (const [selector, attribute] of candidates) {
        for (const element of main.find(`${selector}[${attribute}*="/pluginfile.php/"]`).toArray()) {
            const url = $(element).attr(attribute);
            if (url && !carriesSesskey(url)) return url;
        }
    }
    return undefined;
}

function folderPath(file: FileLink): string {
    const path = URL.parse(file.url)?.pathname ?? "";
    const marker = "/content/0/";
    const start = path.indexOf(marker);
    return start < 0 ? file.name : decodeComponent(path.slice(start + marker.length));
}
