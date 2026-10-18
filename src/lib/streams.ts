import { TooLargeError } from "../errors.js";

export async function readLimited(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
    if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw new TooLargeError(what, maxBytes);
    }
    if (!response.body) return new Uint8Array();

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new TooLargeError(what, maxBytes);
        }
        chunks.push(value);
    }
    return concatBytes(chunks, total);
}

export async function readLimitedText(response: Response, maxBytes: number, what: string): Promise<string> {
    return new TextDecoder().decode(await readLimited(response, maxBytes, what));
}

export function concatBytes(chunks: readonly Uint8Array[], total = chunks.reduce((sum, c) => sum + c.byteLength, 0)) {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
