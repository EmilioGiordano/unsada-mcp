import { clean, type Fragment, type Html, load, richText, safeHref, truncate } from "./html.js";

export interface Activity {
    module?: string;
    name?: string;
    id?: number;
    url?: string;
    fileType?: string;
    text?: string;
    textTruncated?: true;
    hidden?: true;
    restricted?: string;
}

export interface Section {
    number: number;
    name: string;
    summary?: string;
    activities: Activity[];
}

export interface CoursePage {
    name: string;
    format?: string;
    sections: Section[];
    otherSectionUrls: string[];
}

export function parseCoursePage(html: string): CoursePage {
    const $ = load(html);
    const sections: Section[] = [];
    $("li.section.main").each((_, item) => {
        const section = $(item);
        const number = Number(section.attr("id")?.replace("section-", ""));
        if (!Number.isInteger(number)) return;
        sections.push({
            number,
            name: clean(section.attr("aria-label")) || clean(section.find(".sectionname").first().text()),
            summary: richText($, section.find(".summary").first()) || undefined,
            activities: section
                .find("li.activity")
                .toArray()
                .flatMap((activity) => parseActivity($, $(activity)) ?? []),
        });
    });

    const otherSectionUrls = new Set<string>();
    $(".single-section .nav-tabs a[href*='section=']").each((_, anchor) => {
        const href = safeHref($(anchor).attr("href"));
        if (href) otherSectionUrls.add(href);
    });

    return {
        name: clean($("h1").first().text()),
        format: $("body")
            .attr("class")
            ?.match(/format-(\w+)/)?.[1],
        sections,
        otherSectionUrls: [...otherSectionUrls],
    };
}

function parseActivity($: Html, activity: Fragment): Activity | undefined {
    const module = activity.attr("class")?.match(/modtype_(\w+)/)?.[1];
    const moduleId = activity.attr("id")?.match(/^module-(\d{1,10})$/)?.[1];
    const id = moduleId ? Number(moduleId) : undefined;
    const instanceName = activity.find(".activityinstance .instancename").first().clone();
    instanceName.find(".accesshide").remove();
    const name = clean(instanceName.text());
    const access = {
        hidden: activity.find(".activityinstance a.dimmed").length > 0 || undefined,
        restricted: truncate(clean(activity.find(".availabilityinfo").first().text()), 300) || undefined,
    };

    if (!name) {
        const text = richText($, activity.find(".contentwithoutlink, .no-overflow").first());
        // Labels holding only a banner image have no text to give.
        return text ? { module, id, ...limitedText(text, 2_000), ...access } : undefined;
    }

    return {
        module,
        name,
        id,
        url: safeHref(activity.find(".activityinstance a").first().attr("href")),
        fileType: fileTypeOf(activity.find("img.activityicon").attr("src")),
        ...limitedText(richText($, activity.find(".contentafterlink").first()), 600),
        ...access,
    };
}

function limitedText(text: string, max: number): Pick<Activity, "text" | "textTruncated"> {
    if (!text) return {};
    return { text: truncate(text, max), textTruncated: text.length > max || undefined };
}

// Resources show the file type only through their icon, for example `f/pdf-24`.
function fileTypeOf(iconUrl: string | undefined): string | undefined {
    const type = iconUrl?.match(/\/f\/(\w+?)(-\d+)?$/)?.[1];
    return type === "unknown" ? undefined : type;
}
