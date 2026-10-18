import { TIME_ZONE } from "../config.js";

export const DAY_MS = 86_400_000;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });

export function monthMidpoints(from: number, to: number): number[] {
    let { year, month } = localMonth(from);
    const last = localMonth(to);
    const months: number[] = [];
    while (year < last.year || (year === last.year && month <= last.month)) {
        months.push(Date.UTC(year, month - 1, 15) / 1000);
        [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
    }
    return months;
}

function localMonth(time: number): { year: number; month: number } {
    const [year = 0, month = 0] = dateFormat.format(new Date(time)).split("-").map(Number);
    return { year, month };
}

// A classroom day starts at 00:00 in Argentina: it counts if it ends after `from` and starts before `to`.
export function daysOverlapping(dayStarts: Iterable<number>, from: number, to: number): number[] {
    return [...new Set(dayStarts)]
        .filter((start) => start * 1000 + DAY_MS > from && start * 1000 <= to)
        .sort((a, b) => a - b);
}

export function formatDay(dayStart: number): string {
    const date = new Date(dayStart * 1000);
    return `${weekdayFormat.format(date)} ${dateFormat.format(date)}`;
}
