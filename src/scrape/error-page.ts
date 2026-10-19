import { clean, load, truncate } from "./html.js";

// Moodle 3.2 serves print_error() and notice() pages with HTTP 200.
export function parseErrorPage(html: string): string | undefined {
    if (!html.includes("errorbox") && !html.includes('id="notice"')) return undefined;
    const $ = load(html);
    const message = clean($(".errorbox .errormessage").first().text()) || clean($(".errorbox, #notice").first().text());
    return message ? truncate(message, 300) : undefined;
}
