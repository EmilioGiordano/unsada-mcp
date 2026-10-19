import { afterEach, describe, expect, it, vi } from "vitest";
import { ORIGIN } from "../../src/config.js";
import { LoginPendingError } from "../../src/errors.js";
import { fileReader } from "../../src/features/files.js";
import type { ClassroomResponse } from "../../src/moodle/client.js";

const FILE_URL = `${ORIGIN}/pluginfile.php/7/mod_resource/content/1/apunte.txt`;
const RESOURCE_URL = `${ORIGIN}/mod/resource/view.php?id=55`;
const RESOURCE_PAGE = `<div id="region-main"><div class="resourceworkaround"><a href="${FILE_URL}">apunte.txt</a></div></div>`;

function stubClient() {
    return {
        get: vi.fn(async (input: string): Promise<ClassroomResponse> => {
            const url = new URL(input);
            if (url.href === RESOURCE_URL) return { kind: "page", url, html: RESOURCE_PAGE };
            return { kind: "file", url, response: new Response("Unidad 1: conjuntos.") };
        }),
    };
}

describe("fileReader", () => {
    afterEach(() => vi.useRealTimers());

    it("downloads a file once while the model reads it in several calls", async () => {
        const client = stubClient();
        const read = fileReader(client);
        const first = await read(FILE_URL);
        const again = await read(first.url);
        expect(again.parts[0]).toMatchObject({ text: "Unidad 1: conjuntos." });
        expect(client.get).toHaveBeenCalledTimes(1);
    });

    it("keeps a resource under the file url it resolved to", async () => {
        const client = stubClient();
        const read = fileReader(client);
        const first = await read(RESOURCE_URL);
        expect(first.url).toBe(FILE_URL);
        await read(first.url);
        await read(RESOURCE_URL);
        expect(client.get).toHaveBeenCalledTimes(2);
    });

    it("downloads the file again after ten minutes", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const client = stubClient();
        const read = fileReader(client);
        await read(FILE_URL);
        vi.setSystemTime(Date.now() + 11 * 60_000);
        await read(FILE_URL);
        expect(client.get).toHaveBeenCalledTimes(2);
    });

    it("keeps no failure", async () => {
        const client = stubClient();
        client.get.mockRejectedValueOnce(new LoginPendingError());
        const read = fileReader(client);
        await expect(read(FILE_URL)).rejects.toBeInstanceOf(LoginPendingError);
        expect((await read(FILE_URL)).parts).toHaveLength(1);
        expect(client.get).toHaveBeenCalledTimes(2);
    });
});
