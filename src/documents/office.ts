// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import { inMemoryDocument, type ParsedDocument, splitText } from "./document.js";
import { attribute, decodeEntities, xmlTokens } from "./xml.js";
import { inflateEntries, listZip } from "./zip.js";

export type OfficeFormat = "docx" | "pptx" | "xlsx";

const INFLATE_LIMITS = { maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 };

const MARKERS: Record<OfficeFormat, string> = {
    docx: "word/document.xml",
    pptx: "ppt/presentation.xml",
    xlsx: "xl/workbook.xml",
};

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;

type XmlFiles = ReadonlyMap<string, string>;

export function detectOfficeFormat(bytes: Uint8Array): OfficeFormat | null {
    const names = new Set(listZip(bytes).map((entry) => entry.name));
    const formats: OfficeFormat[] = ["docx", "pptx", "xlsx"];
    return formats.find((format) => names.has(MARKERS[format])) ?? null;
}

export function openOffice(bytes: Uint8Array, format: OfficeFormat): ParsedDocument {
    const needed = listZip(bytes).filter((entry) => isNeeded(format, entry.name));
    const decoder = new TextDecoder();
    const files: XmlFiles = new Map(
        [...inflateEntries(bytes, needed, INFLATE_LIMITS)].map(([name, data]) => [name, decoder.decode(data)]),
    );

    switch (format) {
        case "docx":
            return inMemoryDocument(
                "docx",
                "chunk",
                splitText(paragraphText(read(files, MARKERS.docx), "w")).map((text) => ({ text })),
            );
        case "pptx":
            return inMemoryDocument("pptx", "slide", slides(files));
        case "xlsx":
            return inMemoryDocument(
                "xlsx",
                "chunk",
                sheets(files).flatMap(({ name, text }) => {
                    const chunks = splitText(text);
                    return chunks.map((chunk, index) => ({
                        title:
                            chunks.length > 1 ? `sheet "${name}" (${index + 1}/${chunks.length})` : `sheet "${name}"`,
                        text: chunk,
                    }));
                }),
            );
    }
}

function isNeeded(format: OfficeFormat, name: string): boolean {
    switch (format) {
        case "docx":
            return name === MARKERS.docx;
        case "pptx":
            return SLIDE.test(name);
        case "xlsx":
            return (
                name === MARKERS.xlsx ||
                name === "xl/sharedStrings.xml" ||
                name === "xl/_rels/workbook.xml.rels" ||
                name.startsWith("xl/worksheets/")
            );
    }
}

const read = (files: XmlFiles, path: string) => files.get(path) ?? "";

function slides(files: XmlFiles) {
    return [...files.keys()]
        .flatMap((path) => {
            const number = path.match(SLIDE)?.[1];
            return number ? [{ path, number: Number(number) }] : [];
        })
        .sort((a, b) => a.number - b.number)
        .map(({ path }) => ({ text: paragraphText(read(files, path), "a") || "(slide without text)" }));
}

function paragraphText(xml: string, namespace: "w" | "a"): string {
    const tag = (name: string) => `${namespace}:${name}`;
    let out = "";
    let inText = false;
    let cellDepth = 0;
    for (const token of xmlTokens(xml)) {
        if (token.kind === "text") {
            if (inText) out += decodeEntities(token.text);
            continue;
        }
        const closing = token.kind === "close";
        const selfClosing = token.kind === "open" && token.selfClosing;
        switch (token.name) {
            case tag("t"):
                inText = !closing && !selfClosing;
                break;
            case tag("tc"):
                if (selfClosing) break;
                cellDepth = Math.max(0, cellDepth + (closing ? -1 : 1));
                if (closing) out += " | ";
                break;
            case tag("tr"):
                if (closing) out += "\n";
                break;
            case tag("p"):
                if (closing) out += cellDepth ? " " : "\n";
                break;
            case tag("tab"):
                out += " ";
                break;
            case tag("br"):
                out += cellDepth ? " " : "\n";
                break;
        }
    }
    return tidyLines(out);
}

function tidyLines(text: string): string {
    return text
        .split("\n")
        .map((line) =>
            line
                .replace(/\s+/g, " ")
                .replace(/ ?\| ?$/, "")
                .trim(),
        )
        .filter((line, index, all) => line !== "|" && (line !== "" || all[index - 1] !== ""))
        .join("\n")
        .trim();
}

function sheets(files: XmlFiles): { name: string; text: string }[] {
    const sharedStrings = readSharedStrings(read(files, "xl/sharedStrings.xml"));
    const targets = readRelationships(read(files, "xl/_rels/workbook.xml.rels"));
    const result: { name: string; text: string }[] = [];
    for (const token of xmlTokens(read(files, MARKERS.xlsx))) {
        if (token.kind !== "open" || token.name !== "sheet") continue;
        const target = targets.get(attribute(token.attributes, "r:id") ?? "") ?? "";
        const path = target.replace(/^\//, "").replace(/^(xl\/)?/, "xl/");
        const text = readRows(read(files, path), sharedStrings);
        result.push({ name: attribute(token.attributes, "name") ?? "", text: text || "(empty sheet)" });
    }
    return result;
}

function readSharedStrings(xml: string): string[] {
    const strings: string[] = [];
    let current: string | null = null;
    let inText = false;
    for (const token of xmlTokens(xml)) {
        if (token.kind === "text") {
            if (inText && current !== null) current += decodeEntities(token.text);
        } else if (token.name === "si") {
            if (token.kind === "open" && !token.selfClosing) current = "";
            else {
                strings.push(current ?? "");
                current = null;
            }
        } else if (token.name === "t") {
            inText = token.kind === "open" && !token.selfClosing;
        }
    }
    return strings;
}

function readRelationships(xml: string): Map<string, string> {
    const targets = new Map<string, string>();
    for (const token of xmlTokens(xml)) {
        if (token.kind !== "open" || token.name !== "Relationship") continue;
        const id = attribute(token.attributes, "Id");
        const target = attribute(token.attributes, "Target");
        if (id && target) targets.set(id, target);
    }
    return targets;
}

function readRows(xml: string, sharedStrings: readonly string[]): string {
    const rows: string[] = [];
    let cells: string[] = [];
    let cellType: string | undefined;
    let value = "";
    let inValue = false;
    for (const token of xmlTokens(xml)) {
        if (token.kind === "text") {
            if (inValue) value += decodeEntities(token.text);
            continue;
        }
        const opening = token.kind === "open" && !token.selfClosing;
        switch (token.name) {
            case "row":
                if (token.kind === "close" || (token.kind === "open" && token.selfClosing)) {
                    rows.push(cells.join("\t").replace(/\t+$/, ""));
                    cells = [];
                }
                break;
            case "c":
                if (token.kind === "open") {
                    cellType = attribute(token.attributes, "t");
                    value = "";
                }
                if (token.kind === "close" || (token.kind === "open" && token.selfClosing)) {
                    cells.push(cellType === "s" ? (sharedStrings[Number(value)] ?? "") : value);
                }
                break;
            case "v":
            case "t":
                inValue = opening;
                break;
        }
    }
    return rows.filter(Boolean).join("\n");
}
