import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { elementText } from "../lib/html-text.js";

export type Html = cheerio.CheerioAPI;
export type Fragment = cheerio.Cheerio<AnyNode>;

export interface FileLink {
    name: string;
    url: string;
}

const PARSE_BASE = "https://classroom.invalid/";

export const load = (html: string): Html => cheerio.load(html);

export const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export function integerParam(href: string | undefined, name = "id"): number | undefined {
    if (!href) return undefined;
    const value = URL.parse(href, PARSE_BASE)?.searchParams.get(name);
    return value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
}

export function fileName(url: string): string {
    const path = URL.parse(url, PARSE_BASE)?.pathname ?? "";
    return decodeComponent(path.slice(path.lastIndexOf("/") + 1));
}

export function decodeComponent(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

export const carriesSesskey = (href: string) => /[?&]sesskey=/i.test(href);

export const safeHref = (href: string | undefined) => (href && !carriesSesskey(href) ? href : undefined);

export function mainRegion($: Html): Fragment {
    const main = $("#region-main");
    return main.length ? main : $("body");
}

export function richText($: Html, element: Fragment): string {
    const copy = element.clone();
    copy.find("script, style, form, .accesshide").remove();
    copy.find("a[href]").each((_, anchor) => {
        const link = $(anchor);
        const href = link.attr("href") ?? "";
        const text = clean(link.text());
        if (!text) link.remove();
        else if (href && !href.startsWith("#") && !carriesSesskey(href) && text !== href) {
            link.replaceWith(textNode($, `${text} (${href})`));
        }
    });
    copy.find("iframe[src]").each((_, frame) => {
        $(frame).replaceWith(textNode($, `[embedded: ${safeHref($(frame).attr("src")) ?? ""}]`));
    });
    return elementText($, copy);
}

// A string passed to replaceWith is parsed as markup; scraped text must stay text.
const textNode = ($: Html, text: string) => $("<span>").text(text);

export function fileLinks($: Html, element: Fragment): FileLink[] {
    const seen = new Set<string>();
    const links: FileLink[] = [];
    element.find('a[href*="/pluginfile.php/"]').each((_, anchor) => {
        const url = $(anchor).attr("href");
        if (!url || seen.has(url) || carriesSesskey(url)) return;
        seen.add(url);
        links.push({ name: clean($(anchor).text()) || fileName(url), url });
    });
    return links;
}
