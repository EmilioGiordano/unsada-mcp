import { describe, expect, it } from "vitest";
import { DAY_MS, daysOverlapping, formatDay, monthMidpoints } from "../../src/lib/days.js";

const argentina = (iso: string) => Date.parse(`${iso}-03:00`);
const midMonth = (year: number, month: number) => Date.UTC(year, month - 1, 15) / 1000;

describe("monthMidpoints", () => {
    it("starts at the Argentina month even when UTC is already in the next one", () => {
        const from = argentina("2026-10-31T23:00:00");
        expect(monthMidpoints(from, from + DAY_MS)).toEqual([midMonth(2026, 10), midMonth(2026, 11)]);
    });

    it("crosses the year", () => {
        expect(monthMidpoints(argentina("2026-12-20T12:00:00"), argentina("2027-01-10T12:00:00"))).toEqual([
            midMonth(2026, 12),
            midMonth(2027, 1),
        ]);
    });
});

describe("daysOverlapping", () => {
    const day = (iso: string) => argentina(`${iso}T00:00:00`) / 1000;

    it("keeps the current day, drops days outside the range, sorts and dedupes", () => {
        const now = argentina("2026-10-18T15:00:00");
        const days = [day("2026-10-20"), day("2026-10-18"), day("2026-10-17"), day("2026-12-01"), day("2026-10-20")];
        expect(daysOverlapping(days, now, now + 30 * DAY_MS)).toEqual([day("2026-10-18"), day("2026-10-20")]);
    });
});

describe("formatDay", () => {
    it("prints the Argentina weekday and date", () => {
        expect(formatDay(argentina("2026-10-21T00:00:00") / 1000)).toBe("Wed 2026-10-21");
    });
});
