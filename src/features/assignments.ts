import type { MoodleClient } from "../moodle/client.js";
import { type AssignmentSummary, parseAssignmentIndex } from "../scrape/assign.js";

export async function listAssignments(
    client: Pick<MoodleClient, "page">,
    courseId: number,
): Promise<AssignmentSummary[]> {
    return parseAssignmentIndex((await client.page(`/mod/assign/index.php?id=${courseId}`)).html);
}
