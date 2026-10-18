// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import { htmlToText } from "../lib/html-text.js";
import {
    type DocumentFormat,
    inMemoryDocument,
    type ParsedDocument,
    splitText,
    UnsupportedFormatError,
} from "./document.js";
import { detectOfficeFormat, openOffice } from "./office.js";
import { openPdf } from "./pdf.js";

const PDF = [0x25, 0x50, 0x44, 0x46];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

const IMAGES: readonly (readonly [readonly number[], string])[] = [
    [[0x89, 0x50, 0x4e, 0x47], "image/png"],
    [[0xff, 0xd8, 0xff], "image/jpeg"],
    [[0x47, 0x49, 0x46, 0x38], "image/gif"],
];

const TEXT_FORMATS: Readonly<Record<string, DocumentFormat>> = {
    txt: "txt",
    csv: "csv",
    md: "md",
    html: "html",
    htm: "html",
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((byte, i) => bytes[i] === byte);

export async function openDocument(bytes: Uint8Array, name: string): Promise<ParsedDocument> {
    if (startsWith(bytes, PDF)) return openPdf(bytes);

    for (const [signature, mimeType] of IMAGES) {
        if (startsWith(bytes, signature)) return inMemoryDocument("image", "image", [{ image: bytes, mimeType }]);
    }

    if (startsWith(bytes, ZIP)) {
        const format = detectOfficeFormat(bytes);
        if (!format) throw new UnsupportedFormatError("zip archive");
        return openOffice(bytes, format);
    }

    if (startsWith(bytes, OLE)) throw new UnsupportedFormatError("legacy Office (.doc, .xls, .ppt, .pps)");

    const extension = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "";
    const format = TEXT_FORMATS[extension];
    if (!format) throw new UnsupportedFormatError(extension ? `.${extension}` : "unknown");
    const text = new TextDecoder().decode(bytes);
    const plain = format === "html" ? htmlToText(text) : text;
    return inMemoryDocument(
        format,
        "chunk",
        splitText(plain).map((chunk) => ({ text: chunk })),
    );
}
