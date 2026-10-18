// Derived from utn-mcp (ISC, (c) 2026 Joaquín Peñalva): https://github.com/nialvape/utn-mcp
// Ships only the pdf.js files the server loads, so installs skip pdfjs-dist and its native canvas.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const target = join(root, "vendor", "pdfjs");

const FILES = [
    "LICENSE",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.mjs",
    "wasm/jbig2_nowasm_fallback.js",
    "wasm/openjpeg_nowasm_fallback.js",
    "wasm/LICENSE_PDFJS_JBIG2",
    "wasm/LICENSE_PDFJS_OPENJPEG",
];

rmSync(target, { recursive: true, force: true });
for (const file of FILES) {
    const destination = join(target, file.replace(/^legacy\/build\//, ""));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(source, file), destination);
}
console.error(`pdf.js copiado a vendor/pdfjs (${FILES.length} archivos)`);
