#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AulaClient } from "./aula/client.js";
import { clearSession } from "./aula/store.js";
import { BASE_URL, configDir } from "./config.js";
import { logger } from "./shared/logger.js";
import { registerTools } from "./tools.js";

const VERSION = "0.1.0";

const USAGE = `Uso:
  unsada-mcp            servidor MCP por STDIO (lo lanza el cliente: Claude, Codex, OpenCode...)
  unsada-mcp login      abre el navegador para entrar al aula con Google
  unsada-mcp status     dice si hay una sesión activa
  unsada-mcp logout     borra la sesión guardada

Aula: ${BASE_URL}
Datos: ${configDir()}`;

async function main() {
    const command = process.argv[2];
    const client = new AulaClient();

    if (command === "-h" || command === "--help" || command === "help") {
        console.error(USAGE);
        return;
    }
    if (command === "login") {
        await client.login({ wait: "forever" });
        console.error("Listo: sesión iniciada. Ya podés usar unsada-mcp desde tu cliente MCP.");
        return;
    }
    if (command === "status") {
        const s = await client.status();
        console.error(s.conectado ? `Conectado (sesión iniciada el ${s.desde}).` : "Sin sesión: corré `unsada-mcp login`.");
        return;
    }
    if (command === "logout") {
        await clearSession();
        console.error("Sesión borrada.");
        return;
    }
    if (command) {
        console.error(USAGE);
        process.exit(1);
    }

    // Una sola sesión para todas las conexiones del proceso: es el usuario de esta compu.
    serveStdio(
        () => {
            const server = new McpServer({ name: "UNSAdA-MCP", version: VERSION });
            registerTools(server, client);
            return server;
        },
        { onerror: (e) => logger.error(e.message) },
    );
    logger.info("Servidor MCP iniciado en STDIO");
}

main().catch((e) => {
    logger.error((e as Error).message);
    process.exit(1);
});
