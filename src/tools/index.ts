import type { McpServer } from "@modelcontextprotocol/server";
import type { MoodleClient } from "../moodle/client.js";
import { registerAcademicTools } from "./academics.js";
import { registerContentTools } from "./content.js";
import { registerCourseTools } from "./courses.js";
import { registerFileTools } from "./files.js";
import { registerSessionTools } from "./session.js";

export function registerTools(server: McpServer, client: MoodleClient): void {
    registerCourseTools(server, client);
    registerContentTools(server, client);
    registerFileTools(server, client);
    registerAcademicTools(server, client);
    registerSessionTools(server, client);
}
