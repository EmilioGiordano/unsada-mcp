// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import { UnsadaError } from "../errors.js";

export type DocumentFormat = "pdf" | "docx" | "pptx" | "xlsx" | "image" | "txt" | "csv" | "md" | "html";
export type DocumentUnit = "page" | "slide" | "chunk" | "image";

export interface Picture {
    image: Uint8Array;
    mimeType: string;
}

export type Part =
    | { title?: string; text: string; figures?: number; figureImage?: Picture }
    | ({ title?: string } & Picture);

export interface ParsedDocument {
    format: DocumentFormat;
    unit: DocumentUnit;
    total: number;
    part(number: number, withFigures?: boolean): Promise<Part>;
    close(): Promise<void>;
}

export class UnsupportedFormatError extends UnsadaError {
    constructor(description: string) {
        super(`Files of type ${description} cannot be read.`);
    }
}

const CHUNK_CHARS = 15_000;

export function inMemoryDocument(format: DocumentFormat, unit: DocumentUnit, parts: readonly Part[]): ParsedDocument {
    return {
        format,
        unit,
        total: parts.length,
        part: async (number) => {
            const part = parts[number - 1];
            if (!part) throw new UnsadaError(`There is no ${unit} ${number}; the document has ${parts.length}.`);
            return part;
        },
        close: async () => undefined,
    };
}

export function splitText(text: string, maxChars = CHUNK_CHARS): string[] {
    const chunks: string[] = [];
    let rest = text.trim();
    while (rest.length > maxChars) {
        const lineBreak = rest.lastIndexOf("\n", maxChars);
        const end = lineBreak > maxChars / 2 ? lineBreak : maxChars;
        chunks.push(rest.slice(0, end).trim());
        rest = rest.slice(end).trim();
    }
    if (rest || chunks.length === 0) chunks.push(rest);
    return chunks;
}
