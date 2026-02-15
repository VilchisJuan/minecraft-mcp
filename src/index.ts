import { config } from './utils/config-loader';
import { logger } from './utils/logger';
import { MCPMode } from './modes/mcp-mode';
import { TerminalMode } from './modes/terminal-mode';

interface RunningMode {
  start(): Promise<void>;
  stop(): Promise<void>;
}

let activeMode: RunningMode | null = null;

async function main(): Promise<void> {
  logger.info('='.repeat(60));
  logger.info('Minecraft MCP Server Starting');
  logger.info('='.repeat(60));
  logger.info(`Mode: ${config.mode.toUpperCase()}`);
  logger.info(`Minecraft Server: ${config.minecraft.host}:${config.minecraft.port}`);
  logger.info(`Bot Username: ${config.minecraft.username}`);

  if (config.mode === 'terminal') {
    logger.info(`AI Provider: ${config.ai.provider.toUpperCase()}`);
    const model = config.ai.provider === 'openai'
      ? config.ai.openai.model
      : config.ai.claude.model;
    logger.info(`AI Model: ${model}`);
  }

  logger.info('='.repeat(60));

  activeMode = config.mode === 'mcp' ? new MCPMode() : new TerminalMode();
  await activeMode.start();
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    if (activeMode) {
      await activeMode.stop();
    }
  } catch (error) {
    logger.error(`Error during shutdown: ${formatError(error)}`);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

void main().catch((error: unknown) => {
  logger.error(`Fatal startup error: ${formatError(error)}`);
  process.exit(1);
});
