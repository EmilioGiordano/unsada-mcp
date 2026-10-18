import { describe, expect, it } from "vitest";
import { BASE_URL } from "../../src/config.js";
import { ForbiddenUrlError } from "../../src/errors.js";
import { readableClassroomUrl } from "../../src/moodle/urls.js";

const allowed = [
    "/my/",
    "/my/index.php",
    "/course/view.php?id=123",
    "/course/view.php?id=123&section=4",
    "/mod/forum/view.php?id=9&page=2",
    "/mod/forum/view.php?f=55",
    "/mod/forum/discuss.php?d=77",
    "/mod/forum/discuss.php?d=77&parent=1",
    "/mod/page/view.php?id=1",
    "/mod/quiz/view.php?id=1",
    "/mod/assign/index.php?id=12",
    "/grade/report/overview/index.php",
    "/grade/report/user/index.php?id=12",
    "/calendar/view.php?view=month&time=1760000000",
    "/calendar/view.php?view=day&time=1760000000&course=12",
    "/pluginfile.php/123/mod_resource/content/1/Apunte%20Unidad%201.pdf",
    "/pluginfile.php/123/mod_folder/content/0/sub/file.docx?forcedownload=1",
];

const forbidden = [
    ["sesskey", "/course/view.php?id=1&sesskey=abc"],
    ["logout", "/login/logout.php"],
    ["logout with sesskey", "/login/logout.php?sesskey=abc"],
    ["forum subscription", "/mod/forum/subscribe.php?id=1"],
    ["post", "/mod/forum/post.php?reply=1"],
    ["assignment action", "/mod/assign/view.php?id=1&action=editsubmission"],
    ["quiz attempt", "/mod/quiz/startattempt.php?cmid=1"],
    ["course edit", "/course/view.php?id=1&edit=on"],
    ["user profile edit", "/user/edit.php"],
    ["unknown parameter", "/mod/page/view.php?id=1&foo=bar"],
    ["non integer id", "/course/view.php?id=1abc"],
    ["huge id", "/course/view.php?id=12345678901"],
    ["calendar view", "/calendar/view.php?view=new"],
    ["web service", "/webservice/rest/server.php?wstoken=x"],
    ["ajax service", "/lib/ajax/service.php"],
    ["keepalive", "/lib/sessionkeepalive_ajax.php?sesskey=abc"],
    ["admin", "/admin/index.php"],
    ["another origin", "https://evil.example/my/"],
    ["subdomain", `${BASE_URL.replace("://", "://evil.")}/my/`],
    ["plain http", `${BASE_URL.replace("https://", "http://")}/my/`],
    ["userinfo", `${BASE_URL.replace("https://", "https://user:pass@")}/my/`],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["dot segments into logout", "/course/../login/logout.php"],
    ["encoded dot segments", "/mod/page/%2e%2e/%2e%2e/login/logout.php"],
    ["repeated parameter", "/course/view.php?id=1&id=2&sesskey=x"],
] as const;

describe("readableClassroomUrl", () => {
    it.each(allowed)("allows %s", (path) => {
        expect(readableClassroomUrl(path).origin).toBe(new URL(BASE_URL).origin);
    });

    it.each(forbidden)("rejects %s", (_, input) => {
        expect(() => readableClassroomUrl(input)).toThrow(ForbiddenUrlError);
    });

    it("resolves relative paths against the classroom", () => {
        expect(readableClassroomUrl("/my/").href).toBe(`${new URL(BASE_URL).origin}/my/`);
    });

    it("drops the fragment", () => {
        expect(readableClassroomUrl("/mod/forum/discuss.php?d=1#p5").hash).toBe("");
    });

    it("never echoes the query in its error", () => {
        try {
            readableClassroomUrl("/course/view.php?id=1&sesskey=SECRET123");
            expect.unreachable();
        } catch (error) {
            expect(String(error)).not.toContain("SECRET123");
        }
    });
});
