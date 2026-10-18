import { clean, type Fragment, type Html, integerParam, load, richText, safeHref, truncate } from "./html.js";

export interface Activity {
    module?: string;
    name: string;
    id?: number;
    url?: string;
    text?: string;
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
                .map((activity) => parseActivity($, $(activity))),
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

function parseActivity($: Html, activity: Fragment): Activity {
    const module = activity.attr("class")?.match(/modtype_(\w+)/)?.[1];
    const link = activity.find(".activityinstance a").first();

    if (module === "label" || !link.length) {
        const text = richText($, activity.find(".contentwithoutlink, .no-overflow").first());
        return { module, name: truncate(text.split("\n")[0] ?? "", 80), text: truncate(text, 2_000) || undefined };
    }

    const name = link.find(".instancename").clone();
    name.find(".accesshide").remove();
    const url = safeHref(link.attr("href"));
    const text = richText($, activity.find(".contentafterlink").first());
    return {
        module,
        name: clean(name.text()),
        id: integerParam(url),
        url,
        text: text ? truncate(text, 600) : undefined,
    };
}
