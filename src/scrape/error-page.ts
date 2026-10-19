import { clean, load, truncate } from "./html.js";

// Moodle 3.2 serves print_error() and notice() pages with HTTP 200. Their box sits right under
// the main region, where course content, always wrapped, never does.
export function parseErrorPage(html: string): string | undefined {
    if (!html.includes("errorbox") && !html.includes('id="notice"')) return undefined;
    const $ = load(html);
    const box = $('[role="main"] > .errorbox, [role="main"] > #notice').first();
    const message = clean(box.find(".errormessage").first().text()) || clean(box.text());
    return message ? truncate(message, 300) : undefined;
}
