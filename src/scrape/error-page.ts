import { clean, load, truncate } from "./html.js";

// Teachers' HTML keeps its classes, so a box inside course content is not Moodle's own.
const USER_CONTENT = ".no-overflow, .posting, .summary, .contentwithoutlink";

// Moodle 3.2 serves print_error() and notice() pages with HTTP 200.
export function parseErrorPage(html: string): string | undefined {
    if (!html.includes("errorbox") && !html.includes('id="notice"')) return undefined;
    const $ = load(html);
    const box = $(".errorbox, #notice")
        .filter((_, element) => $(element).closest(USER_CONTENT).length === 0)
        .first();
    const message = clean(box.find(".errormessage").first().text()) || clean(box.text());
    return message ? truncate(message, 300) : undefined;
}
