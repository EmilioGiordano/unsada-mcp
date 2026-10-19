#!/usr/bin/env node
import { BASE_URL, dataDir } from "./config.js";
import { UnsadaError } from "./errors.js";
import { logger } from "./logger.js";
import { MoodleClient } from "./moodle/client.js";
import { startServer } from "./server.js";
import { deleteSession, removeLegacyBrowserProfile } from "./session/store.js";

const USAGE = `Uso:
  unsada-mcp            servidor MCP por STDIO (lo lanza el cliente: Claude Code, Codex, OpenCode...)
  unsada-mcp login      abre el navegador para entrar al aula con Google
  unsada-mcp status     dice si hay una sesión activa
  unsada-mcp logout     borra la sesión guardada

Aula: ${BASE_URL}
Datos: ${dataDir()}`;

async function main(command: string | undefined): Promise<void> {
    await removeLegacyBrowserProfile();
    const client = new MoodleClient();
    switch (command) {
        case undefined:
            startServer(client);
            return;
        case "login":
            await client.signIn("untilDone");
            say("Listo: sesión iniciada. Ya podés usar unsada-mcp desde tu cliente MCP.");
            return;
        case "status": {
            const status = await client.status();
            say(
                status.signedIn
                    ? `Conectado (sesión iniciada el ${status.since}).`
                    : "Sin sesión: corré `unsada-mcp login`.",
            );
            return;
        }
        case "logout":
            await deleteSession();
            say("Sesión borrada.");
            return;
        case "help":
        case "-h":
        case "--help":
            say(USAGE);
            return;
        default:
            say(USAGE);
            process.exitCode = 1;
    }
}

// stdout carries the MCP protocol, so the CLI talks on stderr.
const say = (text: string) => process.stderr.write(`${text}\n`);

main(process.argv[2]).catch((error: unknown) => {
    logger.error(
        error instanceof UnsadaError
            ? error.message
            : error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
    );
    process.exit(1);
});
