import {
    carriesSesskey,
    clean,
    decodeComponent,
    type FileLink,
    fileLinks,
    load,
    mainRegion,
    richText,
} from "./html.js";

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

export function parseModulePage(html: string): ModulePage {
    const $ = load(html);
    const main = mainRegion($);
    const body = main.find("[role=main]").first().clone();
    body.find(".row-fluid .heading-rts, .footer-rts, h2").remove();
    return { title: clean(main.find("h2").first().text()), text: richText($, body), files: fileLinks($, body) };
}

export function parseContentPage(html: string): ContentPage {
    const $ = load(html);
    const main = mainRegion($);
    const box = main.find(".box.generalbox").first();
    return {
        title: clean(main.find("h2").first().text()),
        text: richText($, box),
        files: fileLinks($, box),
        modified: clean(main.find(".modified").text()) || undefined,
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
