// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api.js";
import type { ParsedDocument, Part } from "./document.js";
import { grayscalePng } from "./png.js";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type Matrix = [number, number, number, number, number, number];

interface PdfImage {
    width: number;
    height: number;
    kind: number;
    data: Uint8Array | Uint8ClampedArray;
}

// scripts/vendor-pdfjs.mjs copies pdf.js here; the path is the same from src/ and build/.
const VENDOR = new URL("../../vendor/pdfjs/", import.meta.url);

const MIN_TEXT_CHARS = 20;
const IMAGE_LONG_SIDE = 1568;
const SUPERSAMPLING = 2;
const IMAGE_WAIT_MS = 10_000;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_IMAGES_PER_PAGE = 64;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

let loadingPdfJs: Promise<PdfJs> | undefined;

function pdfjs(): Promise<PdfJs> {
    loadingPdfJs ??= import(new URL("pdf.mjs", VENDOR).href) as Promise<PdfJs>;
    return loadingPdfJs;
}

export async function openPdf(bytes: Uint8Array): Promise<ParsedDocument> {
    const lib = await pdfjs();
    const loadingTask = lib.getDocument({
        data: bytes,
        verbosity: 0,
        isOffscreenCanvasSupported: false,
        disableFontFace: true,
        maxImageSize: MAX_IMAGE_PIXELS,
        useWasm: false,
        wasmUrl: new URL("wasm/", VENDOR).href,
    });
    const pdf = await loadingTask.promise;
    return {
        format: "pdf",
        unit: "page",
        total: pdf.numPages,
        part: async (number) => readPage(lib, await pdf.getPage(number)),
        close: () => loadingTask.destroy(),
    };
}

async function readPage(lib: PdfJs, page: PDFPageProxy): Promise<Part> {
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    }
    text = text
        .replace(/[ \t]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .trim();
    if (text.length >= MIN_TEXT_CHARS) return { text };

    const scan = await rasterizeImages(lib, page);
    if (scan) return { title: "scanned, as an image", image: scan, mimeType: "image/png" };
    return { text: text || "(page without text)" };
}

async function rasterizeImages({ OPS }: PdfJs, page: PDFPageProxy): Promise<Uint8Array | null> {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: IMAGE_LONG_SIDE / Math.max(base.width, base.height) });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    const canvas = new Uint8Array(width * height).fill(255);
    const pageTransform = toMatrix(viewport.transform) ?? IDENTITY;

    const operators = await page.getOperatorList();
    let ctm = IDENTITY;
    const stack: Matrix[] = [];
    let painted = 0;

    for (let index = 0; index < operators.fnArray.length && painted < MAX_IMAGES_PER_PAGE; index++) {
        const args: unknown[] = operators.argsArray[index] ?? [];
        switch (operators.fnArray[index]) {
            case OPS.save:
            case OPS.paintFormXObjectBegin:
                stack.push(ctm);
                if (operators.fnArray[index] === OPS.paintFormXObjectBegin)
                    ctm = multiply(ctm, toMatrix(args[0]) ?? IDENTITY);
                break;
            case OPS.restore:
            case OPS.paintFormXObjectEnd:
                ctm = stack.pop() ?? ctm;
                break;
            case OPS.transform:
                ctm = multiply(ctm, toMatrix(args) ?? IDENTITY);
                break;
            case OPS.paintImageXObject:
            case OPS.paintInlineImageXObject: {
                const image = typeof args[0] === "string" ? await imageObject(page, args[0]) : toPdfImage(args[0]);
                if (image && paint(canvas, width, height, image, multiply(pageTransform, ctm))) painted++;
                break;
            }
        }
    }
    return painted ? grayscalePng(width, height, canvas) : null;
}

// Images shared between pages ("g_" ids) live in commonObjs; waiting on page.objs never resolves.
async function imageObject(page: PDFPageProxy, id: string): Promise<PdfImage | null> {
    const store = id.startsWith("g_") ? page.commonObjs : page.objs;
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            new Promise<PdfImage | null>((resolve) => store.get(id, (value: unknown) => resolve(toPdfImage(value)))),
            new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function paint(canvas: Uint8Array, width: number, height: number, image: PdfImage, m: Matrix): boolean {
    const [a, b, c, d, e, f] = m;
    const determinant = a * d - b * c;
    if (!determinant) return false;
    const inverse = [
        d / determinant,
        -b / determinant,
        -c / determinant,
        a / determinant,
        (c * f - d * e) / determinant,
        (b * e - a * f) / determinant,
    ];

    const xs = [e, a + e, c + e, a + c + e];
    const ys = [f, b + f, d + f, b + d + f];
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)));

    const { width: w, height: h, kind, data } = image;
    const bytesPerRow = (w + 7) >> 3;
    const channels = kind === 2 ? 3 : 4;
    const gray = (column: number, row: number) => {
        if (kind === 1) return ((data[row * bytesPerRow + (column >> 3)] >> (7 - (column & 7))) & 1) * 255;
        const i = (row * w + column) * channels;
        return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    };

    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            let sum = 0;
            let samples = 0;
            for (let sy = 0; sy < SUPERSAMPLING; sy++) {
                for (let sx = 0; sx < SUPERSAMPLING; sx++) {
                    const px = x + (sx + 0.5) / SUPERSAMPLING;
                    const py = y + (sy + 0.5) / SUPERSAMPLING;
                    const u = inverse[0] * px + inverse[2] * py + inverse[4];
                    const v = inverse[1] * px + inverse[3] * py + inverse[5];
                    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
                    // Image space grows upwards; the rows of data grow downwards.
                    sum += gray(Math.floor(u * w), Math.floor((1 - v) * h));
                    samples++;
                }
            }
            if (samples) canvas[y * width + x] = sum / samples;
        }
    }
    return true;
}

function multiply([a1, b1, c1, d1, e1, f1]: Matrix, [a2, b2, c2, d2, e2, f2]: Matrix): Matrix {
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

// pdf.js hands operator arguments over untyped; the guards below check them before each cast.
function toMatrix(value: unknown): Matrix | null {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
    const numbers = Array.from(value as ArrayLike<unknown>);
    if (numbers.length !== 6 || !numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const [a, b, c, d, e, f] = numbers as number[];
    return [a, b, c, d, e, f];
}

function toPdfImage(value: unknown): PdfImage | null {
    if (typeof value !== "object" || value === null) return null;
    const { width, height, kind, data } = value as Partial<Record<keyof PdfImage, unknown>>;
    if (typeof width !== "number" || typeof height !== "number" || typeof kind !== "number") return null;
    if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) return null;
    if (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) return null;
    return { width, height, kind, data };
}
