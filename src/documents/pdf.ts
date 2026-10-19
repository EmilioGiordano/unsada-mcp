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
const MIN_FIGURE_PIXELS = 100 * 100;
const MIN_FIGURE_SHARE = 0.03;
const MAX_FIGURE_SHARE = 0.9;
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
    const imagesByPage = new Map<number, Promise<PageImages>>();
    const imagesOf = (number: number): Promise<PageImages> | undefined => {
        if (number < 1 || number > pdf.numPages) return undefined;
        const known = imagesByPage.get(number) ?? pdf.getPage(number).then((page) => pageImages(lib, page));
        imagesByPage.set(number, known);
        return known;
    };
    return {
        format: "pdf",
        unit: "page",
        total: pdf.numPages,
        part: async (number, withFigures = false) => {
            imagesByPage.delete(number - 2);
            const [images, ...neighbours] = await Promise.all(
                [number, number - 1, number + 1].flatMap((n) => imagesOf(n) ?? []),
            );
            const repeated = new Set(neighbours.flatMap(({ placements }) => placements.map(signature)));
            return readPage(await pdf.getPage(number), images, repeated, withFigures);
        },
        close: () => loadingTask.destroy(),
    };
}

async function readPage(
    page: PDFPageProxy,
    { canvas, placements }: PageImages,
    repeated: Set<string>,
    withFigures: boolean,
): Promise<Part> {
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    }
    text = text
        .replace(/[ \t]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .trim();

    if (text.length >= MIN_TEXT_CHARS) {
        const figures = placements.filter((placement) => isFigure(placement, canvas, repeated));
        if (!figures.length) return { text };
        const picture = withFigures ? await paintImages(page, canvas, figures) : null;
        return picture
            ? { text, figures: figures.length, figureImage: { image: picture, mimeType: "image/png" } }
            : { text, figures: figures.length };
    }

    const scan = await paintImages(page, canvas, placements.slice(0, MAX_IMAGES_PER_PAGE));
    if (scan) return { title: "scanned, as an image", image: scan, mimeType: "image/png" };
    return { text: text || "(page without text)" };
}

interface Canvas {
    width: number;
    height: number;
    transform: Matrix;
}

interface Placement {
    source: string | PdfImage;
    pixels: number;
    matrix: Matrix;
}

interface PageImages {
    canvas: Canvas;
    placements: Placement[];
}

function pageCanvas(page: PDFPageProxy): Canvas {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: IMAGE_LONG_SIDE / Math.max(base.width, base.height) });
    return {
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        transform: toMatrix(viewport.transform) ?? IDENTITY,
    };
}

async function pageImages({ OPS }: PdfJs, page: PDFPageProxy): Promise<PageImages> {
    const canvas = pageCanvas(page);
    const operators = await page.getOperatorList();
    let ctm = IDENTITY;
    const stack: Matrix[] = [];
    const placements: Placement[] = [];

    for (let index = 0; index < operators.fnArray.length; index++) {
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
            case OPS.paintImageXObject: {
                const [id, width, height] = args;
                if (typeof id === "string" && typeof width === "number" && typeof height === "number") {
                    placements.push({ source: id, pixels: width * height, matrix: multiply(canvas.transform, ctm) });
                }
                break;
            }
            case OPS.paintInlineImageXObject: {
                const image = toPdfImage(args[0]);
                if (image) {
                    const pixels = image.width * image.height;
                    placements.push({ source: image, pixels, matrix: multiply(canvas.transform, ctm) });
                }
                break;
            }
        }
    }
    return { canvas, placements };
}

// Slide decks repeat backgrounds, logos and bullets on every page, shared ("g_") or embedded again per
// page under a new id; an image in the same place on a neighbouring page is taken as part of the template.
function isFigure(placement: Placement, canvas: Canvas, repeated: Set<string>): boolean {
    const { source, pixels, matrix } = placement;
    if (typeof source === "string" && source.startsWith("g_")) return false;
    if (repeated.has(signature(placement))) return false;
    const [a, b, c, d] = matrix;
    const share = Math.abs(a * d - b * c) / (canvas.width * canvas.height);
    return pixels >= MIN_FIGURE_PIXELS && share >= MIN_FIGURE_SHARE && share < MAX_FIGURE_SHARE;
}

async function paintImages(page: PDFPageProxy, canvas: Canvas, placements: Placement[]): Promise<Uint8Array | null> {
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height).fill(255);
    let box: Box | null = null;
    for (const { source, matrix } of placements) {
        const image = typeof source === "string" ? await imageObject(page, source) : source;
        const painted = image ? paint(pixels, width, height, image, matrix) : null;
        if (painted) box = box ? union(box, painted) : painted;
    }
    if (!box) return null;
    const [x0, y0, x1, y1] = box;
    const cropped = new Uint8Array((x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) cropped.set(pixels.subarray(y * width + x0, y * width + x1), (y - y0) * (x1 - x0));
    return grayscalePng(x1 - x0, y1 - y0, cropped);
}

const signature = ({ pixels, matrix }: Placement) => `${pixels}:${matrix.map(Math.round).join(",")}`;

type Box = [number, number, number, number];

const union = ([a0, b0, a1, b1]: Box, [c0, d0, c1, d1]: Box): Box => [
    Math.min(a0, c0),
    Math.min(b0, d0),
    Math.max(a1, c1),
    Math.max(b1, d1),
];

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

function paint(canvas: Uint8Array, width: number, height: number, image: PdfImage, m: Matrix): Box | null {
    const [a, b, c, d, e, f] = m;
    const determinant = a * d - b * c;
    if (!determinant) return null;
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
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
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
