import { describe, expect, it } from "vitest";
import { TooLargeError } from "../../src/errors.js";
import { mapLimit, withTimeout } from "../../src/lib/concurrency.js";
import { htmlToText } from "../../src/lib/html-text.js";
import { readLimited } from "../../src/lib/streams.js";
import { load, richText } from "../../src/scrape/html.js";

describe("htmlToText", () => {
    it("keeps block structure and drops scripts", () => {
        expect(htmlToText("<p>uno<br>dos</p><ul><li>a</li><li>b</li></ul><style>p{}</style>")).toBe("uno\ndos\na\nb");
    });

    it("stays linear on adversarial whitespace", () => {
        const start = performance.now();
        htmlToText(`<p>${" \n\t".repeat(300_000)}x</p>`);
        expect(performance.now() - start).toBeLessThan(2_000);
    });
});

describe("richText", () => {
    it("keeps link text literal instead of parsing it as markup", () => {
        const $ = load('<div><a href="https://example.org/a">&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;</a></div>');
        expect(richText($, $("div"))).toBe("<b>bold</b> <script> (https://example.org/a)");
    });

    it("never prints sesskey links", () => {
        const $ = load('<div><a href="/login/logout.php?sesskey=SECRET">Salir</a></div>');
        expect(richText($, $("div"))).toBe("Salir");
    });
});

describe("readLimited", () => {
    it("reads bodies under the limit", async () => {
        expect(await readLimited(new Response("hello"), 10, "x")).toEqual(new TextEncoder().encode("hello"));
    });

    it("rejects a declared length over the limit", async () => {
        const response = new Response("hello", { headers: { "content-length": "999" } });
        await expect(readLimited(response, 10, "x")).rejects.toThrow(TooLargeError);
    });

    it("stops a body that grows past the limit", async () => {
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new Uint8Array(1024));
            },
        });
        await expect(readLimited(new Response(stream), 10_000, "x")).rejects.toThrow(TooLargeError);
    });
});

describe("concurrency", () => {
    it("never runs more than the limit at once", async () => {
        let running = 0;
        let peak = 0;
        const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running--;
            return n * 2;
        });
        expect(peak).toBe(4);
        expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    it("times out with the given error", async () => {
        await expect(withTimeout(new Promise(() => {}), 10, () => new Error("late"))).rejects.toThrow("late");
    });
});

describe("mapLimit after a failure", () => {
    it("stops starting new work", async () => {
        const started: number[] = [];
        const run = mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
            started.push(n);
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (n === 1) throw new Error("boom");
            return n;
        });
        await expect(run).rejects.toThrow("boom");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(started.length).toBeLessThanOrEqual(3);
    });
});
