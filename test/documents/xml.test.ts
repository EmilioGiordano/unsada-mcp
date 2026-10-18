import { describe, expect, it } from "vitest";
import { attribute, decodeEntities, xmlTokens } from "../../src/documents/xml.js";

describe("xmlTokens", () => {
    it("tokenizes tags, attributes and text", () => {
        const tokens = [...xmlTokens('<?xml version="1.0"?><a x="1 > 2"><b/>text</a><!-- note -->')];
        expect(tokens).toEqual([
            { kind: "open", name: "a", attributes: ' x="1 > 2"', selfClosing: false },
            { kind: "open", name: "b", attributes: "", selfClosing: true },
            { kind: "text", text: "text" },
            { kind: "close", name: "a" },
        ]);
    });

    it("stops at an unterminated tag", () => {
        expect([...xmlTokens('<a>ok</a><b x="')]).toHaveLength(3);
    });

    it.each([
        ["unclosed tags", "<a".repeat(200_000)],
        ["unclosed quotes", `<a ${'x="'.repeat(200_000)}`],
        ["nested opens", "<w:t>".repeat(100_000)],
        ["long text", "x".repeat(1_000_000)],
    ])("stays linear on %s", (_, input) => {
        const start = performance.now();
        for (const _token of xmlTokens(input)) {
        }
        expect(performance.now() - start).toBeLessThan(1_000);
    });
});

describe("attribute", () => {
    it("matches whole attribute names only", () => {
        expect(attribute(' r:id="rId1" id="x"', "id")).toBe("x");
        expect(attribute(' r:id="rId1"', "r:id")).toBe("rId1");
        expect(attribute(" name='Hoja 1'", "name")).toBe("Hoja 1");
        expect(attribute(' xname="a"', "name")).toBeUndefined();
    });
});

describe("decodeEntities", () => {
    it("decodes named and numeric entities and leaves invalid ones", () => {
        expect(decodeEntities("&lt;a&gt; &amp; &quot;b&quot; &#233; &#x1F600; &#99999999;")).toBe(
            '<a> & "b" é 😀 &#99999999;',
        );
    });
});
