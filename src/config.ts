import { homedir } from "node:os";
import { join } from "node:path";

export const BASE_URL = (process.env.UNSADA_MOODLE_URL || "https://moodle.unsada.edu.ar").replace(/\/+$/, "");
export const ORIGIN = new URL(BASE_URL).origin;
export const TIME_ZONE = "America/Argentina/Buenos_Aires";

export function dataDir(): string {
    if (process.env.UNSADA_MCP_HOME) return process.env.UNSADA_MCP_HOME;
    if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "unsada-mcp");
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "unsada-mcp");
}

export const sessionFile = () => join(dataDir(), "session.json");
export const browserProfileDir = () => join(dataDir(), "browser-profile");
