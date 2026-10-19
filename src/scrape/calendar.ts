import { clean, integerParam, load, richText, safeHref, truncate } from "./html.js";

export interface MonthEvent {
    id: number;
    dayStart: number;
}

export interface DayEvent {
    id?: number;
    kind?: string;
    title: string;
    time?: string;
    course?: string;
    courseId?: number;
    url?: string;
    description?: string;
}

export function parseMonthEvents(html: string): MonthEvent[] {
    const $ = load(html);
    const events: MonthEvent[] = [];
    $('li[class*="calendar_event"] a[href*="view=day"]').each((_, anchor) => {
        const href = $(anchor).attr("href") ?? "";
        const id = Number(href.match(/#event_(\d{1,10})$/)?.[1]);
        const dayStart = integerParam(href, "time");
        if (id && dayStart) events.push({ id, dayStart });
    });
    return events;
}

export function parseDayEvents(html: string): DayEvent[] {
    const $ = load(html);
    return $(".eventlist .event")
        .toArray()
        .map((element): DayEvent => {
            const event = $(element);
            const referer = event.find(".referer").first();
            const course = event.find(".course a").first();
            const description = richText($, event.find(".description").first());
            const id = event.attr("id")?.match(/^event_(\d{1,10})$/)?.[1];
            return {
                id: id ? Number(id) : undefined,
                kind: eventKind(event.find("img.icon").first().attr("src")),
                title: clean(referer.text()),
                time: clean(event.find(".date").first().text()) || undefined,
                course: clean(course.text()) || undefined,
                courseId: integerParam(course.attr("href")),
                url: safeHref(referer.find("a").attr("href")),
                description: description ? truncate(description, 400) : undefined,
            };
        });
}

// The icon tells the kind: an activity's own icon (`assign/<rev>/icon`) or `i/courseevent`, `i/siteevent`...
function eventKind(iconUrl: string | undefined): string | undefined {
    return (
        iconUrl?.match(/\/i\/(course|site|user|group)event$/)?.[1] ?? iconUrl?.match(/\/([a-z0-9]+)\/\d+\/icon$/)?.[1]
    );
}
