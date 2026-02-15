# Minecraft MCP Server (Root)

This guide explains how to install, start, and run this project in:

- `terminal` mode (command-line bot control)
- `mcp` mode (for MCP clients such as Claude Desktop)

## 1. Prerequisites

- Node.js `18+` (Node `20+` recommended)
- npm
- A Minecraft Java server the bot can connect to

Check versions:

```cmd
node -v
npm -v
```

## 2. Install

From project root (`C:\git\minecraft-mcp`):

```cmd
npm install
```

If PowerShell blocks `npm` scripts, use:

```cmd
npm.cmd install
```

`npm install` may show security warnings from transitive packages (`npm audit`).  
These are warnings, not install failures. You can continue to run the project.

Do not run `npm audit fix --force` unless you intend to review dependency breaking changes.

## 3. Configure Environment

Create your `.env` from `.env.example`:

```cmd
copy .env.example .env
```

Minimum values to set in `.env`:

```env
MODE=terminal
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-key

MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=BotGirl
MC_VERSION=1.20.1
MC_AUTH=offline

AUTO_REGISTER=true
BOT_PASSWORD=YourSecurePassword123
```

Mode-specific note:

- If `MODE=terminal`, you must set a valid AI key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).
- If `MODE=mcp`, AI keys are not required for startup in the current implementation.
## 4. Build

```cmd
npm run build
```

## 5. Run in Command-Line Mode (CMD / Terminal)

Development mode:

```cmd
npm run dev:terminal
```

Production build mode:

```cmd
npm run start:terminal
```

If terminal input does not appear, make sure you started `terminal` mode (not `mcp` mode).  
`mcp` mode is for MCP clients and does not provide an interactive command prompt.

Useful terminal commands once running:

- `/help`
- `/status`
- `/say <message>`
- `/goto <x> <y> <z>`
- `/follow <player> [distance]`
- `/stop`
- `/quit`

## 5.1 In-Game @Mention Control

You can control the bot directly from Minecraft chat with natural language.
The bot detects intent from the message and replies in the same language (Spanish/English).

Use:

- `@<botname> help`
- `@<botname> status`
- `@<botname> goto <x> <y> <z>`
- `@<botname> follow <player|me> [distance]`
- `@<botname> stop`
- `@<botname> say <message>`

Example (if bot username is `kokoro`):

- `@kokoro help`
- `@kokoro goto 120 64 -30`
- `@kokoro follow me`
- `@kokoro sigueme`
- `@kokoro ve a 120 64 -30`
- `@kokoro para`
- `@kokoro di hola equipo`

Whispers also work as commands (`/msg kokoro status`).

## 6. Run in MCP Mode

Development mode:

```cmd
npm run dev:mcp
```

Production build mode:

```cmd
npm run start:mcp
```

## 7. Connect from Claude Desktop (MCP Client)

Edit Claude Desktop config file:

- Windows path: `%APPDATA%\Claude\claude_desktop_config.json`

Example config:

```json
{
  "mcpServers": {
    "minecraft-mcp": {
      "command": "node",
      "args": ["C:\\git\\minecraft-mcp\\dist\\index.js"],
      "env": {
        "MODE": "mcp",
        "MC_HOST": "localhost",
        "MC_PORT": "25565",
        "MC_USERNAME": "BotGirl",
        "MC_VERSION": "1.20.1",
        "MC_AUTH": "offline",
        "AUTO_REGISTER": "true",
        "BOT_PASSWORD": "YourSecurePassword123",
        "LOG_LEVEL": "info",
        "LOG_TO_CONSOLE": "true",
        "LOG_TO_FILE": "true"
      }
    }
  }
}
```

Then:

1. Run `npm run build`
2. Restart Claude Desktop
3. Open the MCP tools panel and check `minecraft-mcp`

## 8. Current MCP Status

`src/modes/mcp-mode.ts` currently starts the bot connection in MCP mode, but full MCP tool registration/handlers are not implemented yet in root.  
This means clients can launch the server process, but there may be no discoverable tools until full MCP handlers are added.

## 9. Optional Test Commands

```cmd
npm run test:connection
npm run test:auth
npm run test:movement
```

## 10. Troubleshooting

- `npm : ... running scripts is disabled` in PowerShell
  - Use `npm.cmd ...` instead.
- Bot does not connect
  - Verify `MC_HOST`, `MC_PORT`, and server availability.
- Auth not working on offline server
  - Verify `AUTO_REGISTER=true` and `BOT_PASSWORD` are set.
