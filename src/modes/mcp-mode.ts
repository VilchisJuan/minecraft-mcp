import { BotManager } from '../core/bot-manager';
import { logger } from '../utils/logger';

export class MCPMode {
  private readonly botManager: BotManager;
  private started = false;

  constructor() {
    this.botManager = new BotManager();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('MCP mode already started');
      return;
    }

    logger.info('Starting MCP mode...');
    await this.botManager.connect();
    this.started = true;

    logger.info('MCP mode started. Bot is listening for in-game commands via LLM.');
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.botManager.disconnect();
    this.started = false;
  }
}
