import { openDocument, UnsupportedFormat, type Part } from "../shared/documents/index.js";
import type { AulaClient } from "./client.js";
import { findResourceFile } from "./parse.js";

/** Cuánto se devuelve por llamada, en caracteres de texto. */
const BUDGET_CHARS = 30_000;
/** Lo que cuesta una página como imagen (~1.600 tokens), medido en caracteres de texto. */
const IMAGE_COST_CHARS = 6_000;
const MAX_BYTES = 30 * 1024 * 1024;

/** Lo que ve el modelo de una lectura más las partes leídas. */
export interface FileRead {
    archivo: string;
    formato: string;
    unidad: string;
    total: number;
    desde: number;
    hasta: number;
    /** El `desde` para pedir lo que sigue; no está si ya se leyó todo. */
    siguiente?: number;
    urlParaUsuario: string;
    parts: (Part & { number: number })[];
}

/**
 * La URL del archivo en sí. Acepta la de pluginfile.php o la de un recurso (mod/resource/view.php),
 * que el aula redirige al archivo o muestra en una página con el link.
 */
export async function resolveFileUrl(client: AulaClient, url: string): Promise<string> {
    const href = client.resolve(url);
    const path = new URL(href).pathname;
    if (path.startsWith("/pluginfile.php/")) return href;
    if (path !== "/mod/resource/view.php") {
        throw new Error("Solo se pueden leer archivos del aula (pluginfile.php) o recursos (mod/resource/view.php).");
    }
    const res = await client.request(href);
    if (res.external) throw new Error(`El recurso apunta fuera del aula: ${res.external}`);
    if (new URL(res.url).pathname.startsWith("/pluginfile.php/")) {
        await res.response?.body?.cancel();
        return res.url;
    }
    const file = findResourceFile((await res.response?.text()) ?? "");
    if (!file) throw new Error("No se encontró el archivo en la página del recurso.");
    return file;
}

/** Baja un archivo del aula y devuelve desde la parte `from` tantas como entren en el presupuesto. */
export async function readAulaFile(client: AulaClient, url: string, from = 1): Promise<FileRead> {
    const fileUrl = await resolveFileUrl(client, url);
    const fileName = decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() ?? "");
    const res = await client.request(fileUrl);
    if (!res.response) throw new Error("El aula no devolvió el archivo.");
    const bytes = await readWithLimit(res.response, MAX_BYTES);

    let doc;
    try {
        doc = await openDocument(bytes, fileName);
    } catch (e) {
        if (e instanceof UnsupportedFormat) throw new Error(`${e.message} El usuario lo puede bajar desde ${fileUrl}`);
        throw e;
    }

    try {
        if (from > doc.total) throw new Error(`"${fileName}" termina en ${doc.unit} ${doc.total}; se pidió desde ${from}.`);

        const parts: FileRead["parts"] = [];
        let spent = 0;
        let n = from;
        for (; n <= doc.total; n++) {
            const part = await doc.part(n);
            const cost = "text" in part ? part.text.length : IMAGE_COST_CHARS;
            // Siempre al menos una parte, aunque sola se pase del presupuesto.
            if (parts.length > 0 && spent + cost > BUDGET_CHARS) break;
            parts.push({ ...part, number: n });
            spent += cost;
        }

        return {
            archivo: fileName,
            formato: doc.format,
            unidad: doc.unit,
            total: doc.total,
            desde: from,
            hasta: n - 1,
            siguiente: n <= doc.total ? n : undefined,
            urlParaUsuario: fileUrl,
            parts,
        };
    } finally {
        await doc.close();
    }
}

/** Lee el cuerpo cortando apenas pasa el límite, sin esperar a bajarlo entero. */
async function readWithLimit(res: Response, maxBytes: number): Promise<Uint8Array> {
    const tooBig = `El archivo pesa más de ${Math.round(maxBytes / 1024 / 1024)} MB; es demasiado para leerlo.`;
    if (Number(res.headers.get("content-length")) > maxBytes) {
        await res.body?.cancel();
        throw new Error(tooBig);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) throw new Error(tooBig);
        chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let i = 0;
    for (const c of chunks) {
        bytes.set(c, i);
        i += c.length;
    }
    return bytes;
}
