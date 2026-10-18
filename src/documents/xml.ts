export type XmlToken =
    | { kind: "open"; name: string; attributes: string; selfClosing: boolean }
    | { kind: "close"; name: string }
    | { kind: "text"; text: string };

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const MAX_CODE_POINT = 0x10ffff;

export function* xmlTokens(xml: string): Generator<XmlToken> {
    let position = 0;
    while (position < xml.length) {
        const tagStart = xml.indexOf("<", position);
        if (tagStart < 0) {
            yield { kind: "text", text: xml.slice(position) };
            return;
        }
        if (tagStart > position) yield { kind: "text", text: xml.slice(position, tagStart) };
        const tagEnd = findTagEnd(xml, tagStart + 1);
        if (tagEnd < 0) return;
        position = tagEnd + 1;

        const inner = xml.slice(tagStart + 1, tagEnd);
        if (inner.startsWith("?") || inner.startsWith("!")) continue;
        if (inner.startsWith("/")) {
            yield { kind: "close", name: inner.slice(1).trim() };
            continue;
        }
        const selfClosing = inner.endsWith("/");
        const body = selfClosing ? inner.slice(0, -1) : inner;
        const nameEnd = body.search(/\s/);
        yield {
            kind: "open",
            name: nameEnd < 0 ? body : body.slice(0, nameEnd),
            attributes: nameEnd < 0 ? "" : body.slice(nameEnd),
            selfClosing,
        };
    }
}

export function attribute(attributes: string, name: string): string | undefined {
    const prefix = `${name}=`;
    for (let at = attributes.indexOf(prefix); at >= 0; at = attributes.indexOf(prefix, at + 1)) {
        if (at > 0 && !/\s/.test(attributes[at - 1] ?? "")) continue;
        const quote = attributes[at + prefix.length];
        if (quote !== '"' && quote !== "'") continue;
        const valueStart = at + prefix.length + 1;
        const valueEnd = attributes.indexOf(quote, valueStart);
        return valueEnd < 0 ? undefined : decodeEntities(attributes.slice(valueStart, valueEnd));
    }
    return undefined;
}

export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (entity, body: string) => {
        if (!body.startsWith("#")) return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
        const codePoint =
            body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
        return codePoint <= MAX_CODE_POINT ? String.fromCodePoint(codePoint) : entity;
    });
}

function findTagEnd(xml: string, from: number): number {
    let quote: string | null = null;
    for (let index = from; index < xml.length; index++) {
        const char = xml[index];
        if (quote) {
            if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === ">") {
            return index;
        }
    }
    return -1;
}
