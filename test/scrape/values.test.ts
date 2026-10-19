import { describe, expect, it } from "vitest";
import { classroomDate, dateOrText, decimal, numberOrText } from "../../src/scrape/values.js";

describe("classroomDate", () => {
    it("reads Moodle's Spanish dates as Argentina time", () => {
        expect(classroomDate("jueves, 7 de mayo de 2026, 23:55")).toBe("2026-05-07T23:55-03:00");
        expect(classroomDate("lunes, 5 de Octubre de 2026, 9:05")).toBe("2026-10-05T09:05-03:00");
        expect(classroomDate("1 de setiembre de 2026")).toBe("2026-09-01");
        expect(classroomDate("jue, 2 de jul de 2026, 15:56")).toBe("2026-07-02T15:56-03:00");
        expect(classroomDate("3 de set de 2026")).toBe("2026-09-03");
    });

    it("finds no date in anything else", () => {
        expect(classroomDate("-")).toBeUndefined();
        expect(classroomDate("7 de brumario de 2026")).toBeUndefined();
        expect(classroomDate(undefined)).toBeUndefined();
    });
});

describe("dateOrText", () => {
    it("keeps dates it cannot read as text", () => {
        expect(dateOrText("mañana a las 9")).toBe("mañana a las 9");
        expect(dateOrText("-")).toBeUndefined();
    });
});

describe("decimal", () => {
    it("reads decimal commas, thousands and percentages", () => {
        expect(decimal("8,00")).toBe(8);
        expect(decimal("1.234,5")).toBe(1234.5);
        expect(decimal("80,00 %")).toBe(80);
        expect(decimal("-2")).toBe(-2);
        expect(decimal("8,00 (Aprobado)")).toBeUndefined();
    });
});

describe("numberOrText", () => {
    it("keeps scale grades and other text, and drops the dash", () => {
        expect(numberOrText("10,00")).toBe(10);
        expect(numberOrText("Aprobado")).toBe("Aprobado");
        expect(numberOrText("-")).toBeUndefined();
    });
});
