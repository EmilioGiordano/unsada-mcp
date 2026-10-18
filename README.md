# UNSAdA-MCP

Servidor MCP **no oficial** para el aula virtual de la UNSAdA ([moodle.unsada.edu.ar](https://moodle.unsada.edu.ar)). Le permite a tu agente (Claude, Codex, OpenCode, Cursor...) leer tus cursos, apuntes, foros, tareas, notas y calendario.

Inspirado en [utn-mcp](https://github.com/nialvape/utn-mcp).

## Qué podés pedirle

- *"¿Qué tengo que entregar esta semana?"*
- *"¿Qué dijo la profe en el foro de Trabajo de Grado?"*
- *"Resumime el apunte de la semana 3."*
- *"¿Qué nota me pusieron en el TP1 y qué me corrigieron?"*
- *"¿A qué hora es el examen final de Lenguajes?"*

## Tools

| Tool | Qué hace |
|---|---|
| `unsada_cursos` | Tus cursos, los más recientes primero. Es el punto de partida. |
| `unsada_curso` | Secciones, actividades y recursos de un curso. |
| `unsada_abrir` | Abre un foro, una discusión, una página, una carpeta, una tarea o un enlace. |
| `unsada_leer_archivo` | Lee PDF, Word, PowerPoint, Excel, imágenes y texto, por partes. |
| `unsada_tareas` | Tareas de un curso con vencimiento, estado y nota. |
| `unsada_notas` | Notas de todos los cursos o el detalle de uno. |
| `unsada_calendario` | Próximos vencimientos y eventos, con hora exacta. |
| `unsada_iniciar_sesion` | Abre el navegador para volver a entrar. |

Por ahora **solo lee**: no publica, no entrega, no modifica nada.

## Cómo funciona el login

El aula usa Moodle 3.2, sin servicio para apps móviles, y se entra con Google. Por eso no hay usuario y contraseña que guardar:

1. La primera vez que hace falta, se abre una ventana de **Edge** (o Chrome) en el aula, directo en la pantalla de Google.
2. Entrás con tu cuenta. La ventana se cierra sola y la sesión queda guardada en tu compu.
3. Mientras el servidor está corriendo, le avisa al aula cada 10 minutos que la sesión sigue en uso. Si igual vence, vuelve a abrir la ventana; como Google ya te recuerda, suele bastar un clic.

La sesión y el perfil del navegador quedan en `%APPDATA%\unsada-mcp` (Windows) o `~/.config/unsada-mcp` (Linux/macOS). No salen de tu computadora.

## Instalación

Necesitás Node 20 o más nuevo y Edge o Chrome instalado.

```bash
npx -y unsada-mcp login       # se abre el navegador: entrá con Google
```

Después lo conectás a tu cliente.

**Claude Code** (`-s user` lo deja disponible en todas tus carpetas)

```bash
claude mcp add unsada -s user -- npx -y unsada-mcp
```

**Claude Desktop**: en `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "unsada": { "command": "npx", "args": ["-y", "unsada-mcp"] }
  }
}
```

**Codex**: en `~/.codex/config.toml`

```toml
[mcp_servers.unsada]
command = "npx"
args = ["-y", "unsada-mcp"]
```

**OpenCode**: en `opencode.json`

```json
{
  "mcp": {
    "unsada": { "type": "local", "command": ["npx", "-y", "unsada-mcp"] }
  }
}
```

### Desde el código

```bash
git clone https://github.com/EmilioGiordano/unsada-mcp
cd unsada-mcp
npm install
npm run build
claude mcp add unsada -s user -- node C:/ruta/a/unsada-mcp/build/index.js
```

## Comandos

```
unsada-mcp            servidor MCP por STDIO (lo lanza el cliente)
unsada-mcp login      abre el navegador para entrar con Google
unsada-mcp status     dice si hay una sesión activa
unsada-mcp logout     borra la sesión guardada
```

Variables opcionales: `UNSADA_BROWSER` (`msedge`, `chrome`...), `UNSADA_MCP_HOME` (otra carpeta de datos), `UNSADA_MOODLE_URL` (otro Moodle 3.x).

## Cómo está hecho

Como el aula no expone una API usable, el servidor lee las mismas páginas que ves en el navegador, con tu sesión, y las convierte en datos (`src/aula/parse.ts`). Si la UNSAdA actualiza Moodle o cambia el tema, ese archivo es el que hay que ajustar.

La lectura de documentos (`src/shared/documents/`) viene de utn-mcp; ver `THIRD_PARTY_NOTICES`.
