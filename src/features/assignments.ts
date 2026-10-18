import type { MoodleClient } from "../moodle/client.js";
import { type AssignmentSummary, parseAssignmentIndex } from "../scrape/assign.js";

export async function listAssignments(client: MoodleClient, courseId: number): Promise<AssignmentSummary[]> {
    return parseAssignmentIndex((await client.page(`/mod/assign/index.php?id=${courseId}`)).html);
}
