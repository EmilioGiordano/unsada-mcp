import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const BLOCK_ELEMENTS = "p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol";

export function htmlToText(html: string): string {
    const $ = cheerio.load(html);
    return elementText($, $.root());
}

export function elementText($: cheerio.CheerioAPI, element: cheerio.Cheerio<AnyNode>): string {
    const copy = element.clone();
    copy.find("script, style, noscript, template").remove();
    copy.find("br").replaceWith("\n");
    copy.find(BLOCK_ELEMENTS).each((_, block) => {
        $(block).append("\n");
    });
    return normalizeWhitespace(copy.text());
}

export function normalizeWhitespace(text: string): string {
    return text
        .replace(/[ \t\f\v ]+/g, " ")
        .replace(/ ?\n\s*/g, "\n")
        .trim();
}
