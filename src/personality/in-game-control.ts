import { Bot } from 'mineflayer';
import type { BotManager } from '../core/bot-manager';
import { config } from '../utils/config-loader';
import { activityLogger, logger } from '../utils/logger';
import { LLMAgent } from '../ai/llm-agent';

interface CommandContext {
  username: string;
  isWhisper: boolean;
}

export class InGameControl {
  private readonly bot: Bot;
  private readonly botManager: BotManager;
  private readonly botName: string;
  private readonly mentionPrefix: string;
  private readonly llmAgent: LLMAgent;
  private active = false;

  constructor(bot: Bot, botManager: BotManager) {
    this.bot = bot;
    this.botManager = botManager;
    this.botName = config.minecraft.username.toLowerCase();
    this.mentionPrefix = config.personality.mentionPrefix || '@';
    this.llmAgent = new LLMAgent(botManager);
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.bot.on('chat', this.onChat);
    this.bot.on('whisper', this.onWhisper);
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.bot.off('chat', this.onChat);
    this.bot.off('whisper', this.onWhisper);
  }

  private readonly onChat = (username: string, message: string): void => {
    if (!this.active || username === this.bot.username) {
      return;
    }

    const cleaned = this.extractMentionContent(message);
    if (cleaned === null) {
      return;
    }

    void this.handleMessage({ username, isWhisper: false }, cleaned);
  };

  private readonly onWhisper = (username: string, message: string): void => {
    if (!this.active || username === this.bot.username) {
      return;
    }

    const cleaned = this.cleanWhisperContent(message);
    if (!cleaned) {
      return;
    }

    void this.handleMessage({ username, isWhisper: true }, cleaned);
  };

  private async handleMessage(context: CommandContext, rawContent: string): Promise<void> {
    activityLogger.info(
      `In-game message from ${context.username} (${context.isWhisper ? 'whisper' : 'chat'}): ${rawContent}`,
    );

    try {
      const response = await this.llmAgent.processMessage(rawContent, context.username);
      if (response) {
        await this.reply(context, response);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`LLM agent error for ${context.username}: ${reason}`);
      await this.reply(context, 'Sorry, something went wrong. Please try again.');
    }
  }

  private async reply(context: CommandContext, message: string): Promise<void> {
    if (!this.botManager.isReady()) {
      return;
    }

    const safeMessage = message.length > 250 ? `${message.slice(0, 247)}...` : message;

    if (context.isWhisper) {
      this.botManager.whisper(context.username, safeMessage);
      return;
    }

    this.botManager.chat(safeMessage);
  }

  private extractMentionContent(message: string): string | null {
    const trimmed = message.trim();
    if (!trimmed) {
      return null;
    }

    const escapedPrefix = this.escapeRegex(this.mentionPrefix);
    const escapedName = this.escapeRegex(this.botName);

    const patterns = [
      new RegExp(`^\\s*${escapedPrefix}${escapedName}[\\s,:-]*(.*)$`, 'i'),
      new RegExp(`^\\s*${escapedName}[\\s,:-]*(.*)$`, 'i'),
      new RegExp(`^\\s*(?:hey|hi|hello|hola)\\s+${escapedPrefix}?${escapedName}[\\s,:-]*(.*)$`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return (match[1] || '').trim();
      }
    }

    const inlineMention = new RegExp(`${escapedPrefix}${escapedName}`, 'i');
    if (inlineMention.test(trimmed)) {
      return trimmed.replace(inlineMention, '').trim();
    }

    return null;
  }

  private cleanWhisperContent(message: string): string {
    const extracted = this.extractMentionContent(message);
    if (extracted !== null) {
      return extracted;
    }

    return message.trim();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
