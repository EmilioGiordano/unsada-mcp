import { mapLimit } from "../lib/concurrency.js";
import { DAY_MS, daysOverlapping, formatDay, monthMidpoints } from "../lib/days.js";
import { MAX_CONCURRENT_REQUESTS, type MoodleClient } from "../moodle/client.js";
import { type DayEvent, parseDayEvents, parseMonthEvents } from "../scrape/calendar.js";

const MAX_DAYS_WITH_EVENTS = 60;

export interface CalendarEvent extends DayEvent {
    date: string;
}

export interface Calendar {
    events: CalendarEvent[];
    truncated?: true;
}

export async function getCalendar(
    client: Pick<MoodleClient, "page">,
    daysAhead: number,
    daysBack: number,
): Promise<Calendar> {
    const now = Date.now();
    const from = now - daysBack * DAY_MS;
    const to = now + daysAhead * DAY_MS;

    const monthEvents = (
        await mapLimit(monthMidpoints(from, to), MAX_CONCURRENT_REQUESTS, async (time) =>
            parseMonthEvents((await client.page(`/calendar/view.php?view=month&time=${time}`)).html),
        )
    ).flat();

    const days = daysOverlapping(
        monthEvents.map((event) => event.dayStart),
        from,
        to,
    );
    const fetched = days.slice(0, MAX_DAYS_WITH_EVENTS);

    const byDay = await mapLimit(fetched, MAX_CONCURRENT_REQUESTS, async (dayStart) => ({
        dayStart,
        events: parseDayEvents((await client.page(`/calendar/view.php?view=day&time=${dayStart}`)).html),
    }));

    return {
        events: byDay.flatMap(({ dayStart, events }) =>
            events.map((event) => ({ date: formatDay(dayStart), ...event })),
        ),
        truncated: days.length > fetched.length || undefined,
    };
}
