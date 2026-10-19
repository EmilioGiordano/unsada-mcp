import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    InMemoryTransport,
    type JSONRPCMessage,
    LATEST_PROTOCOL_VERSION,
    McpServer,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../../src/moodle/client.js";
import { registerTools } from "../../src/tools/index.js";

vi.mock("../../src/session/browser-login.js", () => ({
    browserLogin: () => Promise.reject(new Error("no browser in tests")),
}));

interface ListedTool {
    name: string;
    description: string;
    inputSchema: { properties?: Record<string, unknown> };
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

async function connect() {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, new MoodleClient());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const answers = new Map<number, (message: JSONRPCMessage) => void>();
    clientSide.onmessage = (message) => {
        if ("id" in message && typeof message.id === "number") answers.get(message.id)?.(message);
    };
    await server.connect(serverSide);
    await clientSide.start();

    let nextId = 0;
    const request = async (method: string, params: Record<string, unknown> = {}) => {
        const id = ++nextId;
        const answer = new Promise<JSONRPCMessage>((resolve) => answers.set(id, resolve));
        await clientSide.send({ jsonrpc: "2.0", id, method, params });
        const message = await answer;
        if (!("result" in message)) throw new Error(JSON.stringify(message));
        return message.result;
    };
    await request("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
    });
    await clientSide.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return { request, close: () => server.close() };
}

describe("registered tools", () => {
    let session: Awaited<ReturnType<typeof connect>>;
    beforeEach(async () => {
        vi.stubEnv("UNSADA_MCP_HOME", join(tmpdir(), "unsada-tools-no-session"));
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new Error("no network in tests"))),
        );
        session = await connect();
    });
    afterEach(async () => {
        await session.close();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    const listTools = async () => (await session.request("tools/list")).tools as ListedTool[];

    it("exposes the documented tools with honest annotations", async () => {
        const tools = await listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "unsada_download",
            "unsada_get_calendar",
            "unsada_get_course",
            "unsada_get_grades",
            "unsada_list_assignments",
            "unsada_list_courses",
            "unsada_login",
            "unsada_open",
            "unsada_read_file",
        ]);
        for (const tool of tools) {
            expect(tool.description.length).toBeGreaterThan(80);
            const writesLocally = tool.name === "unsada_download" || tool.name === "unsada_login";
            expect(tool.annotations?.readOnlyHint ?? false).toBe(!writesLocally);
            if (writesLocally) expect(tool.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });
        }
    });

    it("turns a forbidden url into a tool error without any request", async () => {
        const result = await session.request("tools/call", {
            name: "unsada_open",
            arguments: { url: "https://evil.example/mod/forum/view.php?id=1" },
        });
        expect(result).toMatchObject({ isError: true });
        expect(JSON.stringify(result)).toContain("Only classroom addresses");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects arguments outside the schema bounds", async () => {
        const result = await session.request("tools/call", {
            name: "unsada_get_course",
            arguments: { courseId: -1 },
        });
        expect(result).toMatchObject({ isError: true });
        expect(fetch).not.toHaveBeenCalled();
    });
});
