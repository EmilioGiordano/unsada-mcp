import { homedir } from "node:os";
import { join } from "node:path";

/** El aula virtual. Se puede cambiar con UNSADA_MOODLE_URL (por ejemplo, para probar contra otro Moodle 3.x). */
export const BASE_URL = (process.env.UNSADA_MOODLE_URL || "https://moodle.unsada.edu.ar").replace(/\/+$/, "");
export const ORIGIN = new URL(BASE_URL).origin;

/** Carpeta de datos: UNSADA_MCP_HOME, %APPDATA% en Windows, o XDG/~/.config en Linux y macOS. */
export function configDir(): string {
    if (process.env.UNSADA_MCP_HOME) return process.env.UNSADA_MCP_HOME;
    if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "unsada-mcp");
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "unsada-mcp");
}

/** Cookies y sesskey del aula. */
export const sessionFile = () => join(configDir(), "session.json");

/** Perfil del navegador del login: ahí Google recuerda tu cuenta entre un login y otro. */
export const browserProfileDir = () => join(configDir(), "browser-profile");
