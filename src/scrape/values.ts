const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
];

const CLASSROOM_DATE = /(\d{1,2}) de ([a-z]{3,}) de (\d{4})(?:,? (\d{1,2}):(\d{2}))?/i;

// Argentina has kept UTC-3 all year since 2009.
const ARGENTINA_OFFSET = "-03:00";

const pad = (value: string | number) => String(value).padStart(2, "0");

export function classroomDate(text: string | undefined): string | undefined {
    const match = text?.match(CLASSROOM_DATE);
    if (!match) return undefined;
    const [, day = "", monthName = "", year = "", hour, minute] = match;
    // Lists abbreviate months ("jul", "set"); "set" is the Rioplatense spelling of septiembre.
    const prefix = monthName.toLowerCase().slice(0, 3).replace("set", "sep");
    const month = MONTHS.findIndex((name) => name.startsWith(prefix)) + 1;
    if (!month) return undefined;
    const date = `${year}-${pad(month)}-${pad(day)}`;
    return hour && minute ? `${date}T${pad(hour)}:${minute}${ARGENTINA_OFFSET}` : date;
}

// A date Moodle printed in a format not understood is kept as text rather than lost.
export function dateOrText(text: string): string | undefined {
    if (!text || text === "-") return undefined;
    return classroomDate(text) ?? text;
}

const DECIMAL = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;

export function decimal(text: string): number | undefined {
    const number = text.replace(/\s*%$/, "");
    return DECIMAL.test(number) ? Number(number.replace(/\./g, "").replace(",", ".")) : undefined;
}

export function numberOrText(text: string): number | string | undefined {
    if (!text || text === "-") return undefined;
    return decimal(text) ?? text;
}
