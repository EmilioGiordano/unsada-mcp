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
| `unsada_list_courses` | Tus cursos, los más recientes primero. Es el punto de partida. |
| `unsada_get_course` | Secciones, actividades y recursos de un curso. |
| `unsada_open` | Abre un foro, una discusión, una página, una carpeta, una tarea o un enlace. |
| `unsada_read_file` | Lee PDF, Word, PowerPoint, Excel, imágenes y texto, por partes. |
| `unsada_download` | Guarda archivos, recursos o carpetas enteras del aula en tu disco. |
| `unsada_list_assignments` | Tareas de un curso con vencimiento, estado y nota. |
| `unsada_get_grades` | Notas de todos los cursos o el detalle de uno. |
| `unsada_get_calendar` | Próximos vencimientos y eventos, con hora exacta. |
| `unsada_login` | Abre el navegador para volver a entrar. |

En el aula **solo lee**: no publica, no entrega, no modifica nada. Antes de cada pedido, el servidor verifica que la dirección sea una página de lectura conocida del aula; cualquier otra (cerrar sesión, suscribirse, publicar, otro sitio) se rechaza sin pedirla. Como cualquier visita tuya, abrir una actividad queda en los registros del aula y puede marcarla como vista.

`unsada_download` es lo único que escribe, y solo en tu disco: guarda siempre en una subcarpeta (por ejemplo `Bases de Datos/Unidad 1`) dentro de la carpeta donde abriste el agente, nunca suelto en esa carpeta. Nunca pisa un archivo existente (si ya está con el mismo tamaño lo saltea, si es distinto agrega ` (2)`), nunca escribe en carpetas ocultas como `.git` o `.claude`, le pone un `_` adelante a nombres sensibles como `CLAUDE.md` u `opencode.json`, y en Windows marca los archivos como bajados de internet para que SmartScreen avise antes de ejecutarlos. Para permitir otras carpetas, agregalas a `UNSADA_DOWNLOAD_ROOTS`.

## Cómo funciona el login

El aula usa Moodle 3.2, sin servicio para apps móviles, y se entra con Google. Por eso no hay usuario y contraseña que guardar:

1. La primera vez que hace falta, se abre una ventana de **Edge** (o Chrome) en el aula, directo en la pantalla de Google.
2. Entrás con tu cuenta. La ventana se cierra sola y la sesión queda guardada en tu compu.
3. Mientras el servidor está corriendo, le avisa al aula cada 10 minutos que la sesión sigue en uso. Si igual vence, vuelve a abrir la ventana; como Google ya te recuerda, suele bastar un clic.

La sesión y el perfil del navegador quedan en `%APPDATA%\unsada-mcp` (Windows) o `~/.config/unsada-mcp` (Linux/macOS). No salen de tu computadora.

## Instalación

Necesitás Node 22 o más nuevo y Edge o Chrome instalado.

```bash
npx -y unsada-mcp@latest login  # se abre el navegador: entrá con Google
```

Después lo conectás a tu cliente.

**Claude Code** (`-s user` lo deja disponible en todas tus carpetas)

```bash
claude mcp add unsada -s user -- npx -y unsada-mcp@latest
```

**Claude Desktop**: en `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "unsada": { "command": "npx", "args": ["-y", "unsada-mcp@latest"] }
  }
}
```

**Codex**: en `~/.codex/config.toml`

```toml
[mcp_servers.unsada]
command = "npx"
args = ["-y", "unsada-mcp@latest"]
```

**OpenCode**: en `opencode.json`

```json
{
  "mcp": {
    "unsada": { "type": "local", "command": ["npx", "-y", "unsada-mcp@latest"] }
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

Variables opcionales: `UNSADA_BROWSER` (`msedge`, `chrome`...), `UNSADA_MCP_HOME` (otra carpeta de datos), `UNSADA_MOODLE_URL` (otro Moodle 3.x), `UNSADA_DOWNLOAD_ROOTS` (carpetas extra donde se puede descargar, separadas por `;` en Windows y `:` en Linux y macOS).

## Cómo está hecho

Como el aula no expone una API usable, el servidor lee las mismas páginas que ves en el navegador, con tu sesión, y las convierte en datos (`src/scrape/`, un archivo por tipo de página). Si la UNSAdA actualiza Moodle o cambia el tema, esos archivos son los que hay que ajustar; los tests en `test/scrape/` usan páginas de ejemplo inventadas.

La lectura de documentos (`src/documents/`) viene de utn-mcp; ver `THIRD_PARTY_NOTICES`.

## Desarrollo

```bash
npm run typecheck   # TypeScript
npm run lint        # Biome
npm test            # Vitest
npm run build
```

Las reglas del proyecto (estructura, seguridad, estilo) están en `AGENTS.md`.
