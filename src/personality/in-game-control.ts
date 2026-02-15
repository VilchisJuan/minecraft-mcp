import { Bot } from 'mineflayer';
import type { BotManager } from '../core/bot-manager';
import { config } from '../utils/config-loader';
import { activityLogger, logger } from '../utils/logger';

type Language = 'es' | 'en';
type IntentKind = 'help' | 'status' | 'goto' | 'follow' | 'stop' | 'say' | 'unknown';

interface CommandContext {
  username: string;
  isWhisper: boolean;
}

interface ParsedIntent {
  kind: IntentKind;
  coordinates?: { x: number; y: number; z: number };
  targetPlayer?: string;
  distance?: number;
  sayMessage?: string;
}

interface TemplateVars {
  username?: string;
  x?: number;
  y?: number;
  z?: number;
  distance?: number;
  reason?: string;
}

interface ReplyTemplates {
  help: string[];
  unknown: string[];
  gotoUsage: string[];
  gotoStart: string[];
  gotoArrived: string[];
  followUsage: string[];
  followStart: string[];
  stopDone: string[];
  sayUsage: string[];
  sayDone: string[];
  commandFailed: string[];
}

export class InGameControl {
  private readonly bot: Bot;
  private readonly botManager: BotManager;
  private readonly botName: string;
  private readonly mentionPrefix: string;
  private active = false;

  constructor(bot: Bot, botManager: BotManager) {
    this.bot = bot;
    this.botManager = botManager;
    this.botName = config.minecraft.username.toLowerCase();
    this.mentionPrefix = config.personality.mentionPrefix || '@';
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
    const language = this.detectLanguage(rawContent);
    const intent = this.parseIntent(rawContent, context.username);

    activityLogger.info(
      `In-game intent from ${context.username} (${context.isWhisper ? 'whisper' : 'chat'}): ${intent.kind} | ${rawContent}`,
    );

    try {
      switch (intent.kind) {
        case 'help':
          await this.reply(context, this.composeReply(language, 'help'));
          return;

        case 'status':
          await this.reply(context, this.buildStatusLine(language));
          return;

        case 'goto':
          await this.handleGoto(context, language, intent);
          return;

        case 'follow':
          await this.handleFollow(context, language, intent);
          return;

        case 'stop':
          this.botManager.stopMovement();
          await this.reply(context, this.composeReply(language, 'stopDone'));
          return;

        case 'say':
          await this.handleSay(context, language, intent);
          return;

        default:
          await this.reply(context, this.composeReply(language, 'unknown'));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`In-game command failed (${intent.kind}): ${reason}`);
      await this.reply(
        context,
        this.composeReply(language, 'commandFailed', { reason }),
      );
    }
  }

  private async handleGoto(context: CommandContext, language: Language, intent: ParsedIntent): Promise<void> {
    if (!intent.coordinates) {
      await this.reply(context, this.composeReply(language, 'gotoUsage'));
      return;
    }

    const { x, y, z } = intent.coordinates;
    await this.reply(context, this.composeReply(language, 'gotoStart', { x, y, z }));
    await this.botManager.moveTo(x, y, z);
    await this.reply(context, this.composeReply(language, 'gotoArrived', { x, y, z }));
  }

  private async handleFollow(context: CommandContext, language: Language, intent: ParsedIntent): Promise<void> {
    if (!intent.targetPlayer) {
      await this.reply(context, this.composeReply(language, 'followUsage'));
      return;
    }

    const distance = intent.distance ?? 3;
    this.botManager.followPlayer(intent.targetPlayer, distance);
    await this.reply(
      context,
      this.composeReply(language, 'followStart', {
        username: intent.targetPlayer,
        distance,
      }),
    );
  }

  private async handleSay(context: CommandContext, language: Language, intent: ParsedIntent): Promise<void> {
    if (!intent.sayMessage || !intent.sayMessage.trim()) {
      await this.reply(context, this.composeReply(language, 'sayUsage'));
      return;
    }

    this.botManager.chat(intent.sayMessage);
    await this.reply(context, this.composeReply(language, 'sayDone'));
  }

  private parseIntent(content: string, sender: string): ParsedIntent {
    const raw = content.trim();
    const normalized = this.normalize(raw);
    const numbers = this.extractNumbers(raw);

    const sayMatch = raw.match(/^(?:say|di|decir|dime)\s+(.+)$/i);
    if (sayMatch) {
      return {
        kind: 'say',
        sayMessage: sayMatch[1].trim(),
      };
    }

    if (/\b(help|ayuda|comando|comandos)\b/i.test(normalized)) {
      return { kind: 'help' };
    }

    if (/\b(status|estado|situacion|situacion actual|posicion|posicion actual|where are you)\b/i.test(normalized)) {
      return { kind: 'status' };
    }

    if (/\b(stop|para|parate|detente|quieta|quieto|frena|alto)\b/i.test(normalized)) {
      return { kind: 'stop' };
    }

    const followMeRegex = /\b(follow me|sigueme|seguime|sigame|ven conmigo|acompaname|me sigues)\b/i;
    if (followMeRegex.test(normalized)) {
      return {
        kind: 'follow',
        targetPlayer: sender,
        distance: this.extractDistance(normalized) ?? 3,
      };
    }

    const followOther = normalized.match(/\b(?:follow|sigue a)\s+([a-z0-9_]{3,16})(?:\s+(\d+))?/i);
    if (followOther) {
      return {
        kind: 'follow',
        targetPlayer: followOther[1],
        distance: this.sanitizeDistance(followOther[2] ? Number(followOther[2]) : 3),
      };
    }

    if (/^\s*(?:follow|sigue)\b/i.test(normalized)) {
      return { kind: 'follow' };
    }

    const hasGotoVerb = /\b(goto|go to|move to|go|ve a|ir a|anda a|camina a|ve)\b/i.test(normalized);
    const numericShortcut = /^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?$/.test(raw);
    if ((hasGotoVerb || numericShortcut) && numbers.length >= 3) {
      return {
        kind: 'goto',
        coordinates: {
          x: numbers[0],
          y: numbers[1],
          z: numbers[2],
        },
      };
    }

    if (hasGotoVerb) {
      return { kind: 'goto' };
    }

    if (/^\s*(?:say|di|decir)\b/i.test(normalized)) {
      return { kind: 'say' };
    }

    return { kind: 'unknown' };
  }

  private detectLanguage(text: string): Language {
    if (/[¿¡ñáéíóú]/i.test(text)) {
      return 'es';
    }

    const normalized = this.normalize(text);
    const spanishWords = [
      'sigueme',
      'seguime',
      'ayuda',
      'estado',
      'para',
      'detente',
      've a',
      'hola',
      'gracias',
      'acompaname',
      'ven conmigo',
      'di',
    ];
    const englishWords = [
      'follow',
      'help',
      'status',
      'stop',
      'go to',
      'move to',
      'say',
      'hello',
      'thanks',
      'where are you',
    ];

    let esScore = 0;
    let enScore = 0;

    for (const word of spanishWords) {
      if (normalized.includes(word)) {
        esScore += 1;
      }
    }

    for (const word of englishWords) {
      if (normalized.includes(word)) {
        enScore += 1;
      }
    }

    return esScore >= enScore ? 'es' : 'en';
  }

  private composeReply(language: Language, key: keyof ReplyTemplates, vars: TemplateVars = {}): string {
    const templates = this.getTemplates(language);
    const options = templates[key];
    const template = options[Math.floor(Math.random() * options.length)];

    const filled = template
      .replace(/\{username\}/g, vars.username ?? '')
      .replace(/\{x\}/g, vars.x !== undefined ? String(vars.x) : '')
      .replace(/\{y\}/g, vars.y !== undefined ? String(vars.y) : '')
      .replace(/\{z\}/g, vars.z !== undefined ? String(vars.z) : '')
      .replace(/\{distance\}/g, vars.distance !== undefined ? String(vars.distance) : '')
      .replace(/\{reason\}/g, vars.reason ?? '');

    return filled.trim();
  }

  private getTemplates(language: Language): ReplyTemplates {
    const shy = config.personality.type.toLowerCase() === 'shy';

    if (language === 'es') {
      if (shy) {
        return {
          help: [
            `Um... puedes pedirme: "${this.mentionPrefix}${this.botName} status", "${this.mentionPrefix}${this.botName} sigueme", "${this.mentionPrefix}${this.botName} ve a 100 64 -20", "${this.mentionPrefix}${this.botName} para".`,
            `Si quieres, te ayudo con: status, sigueme, ve a <x> <y> <z>, stop, say.`,
          ],
          unknown: [
            `Eh... no entendí del todo. Prueba con "${this.mentionPrefix}${this.botName} help".`,
            `Creo que me perdí un poco. Escribe "${this.mentionPrefix}${this.botName} help".`,
          ],
          gotoUsage: [
            'Creo que faltan coordenadas. Ejemplo: ve a 120 64 -35.',
            'Necesito x y z. Por ejemplo: goto 120 64 -35.',
          ],
          gotoStart: [
            'Ok, voy para ({x}, {y}, {z}).',
            'Vale, ya voy a ({x}, {y}, {z}).',
          ],
          gotoArrived: [
            'Ya llegué cerca de ({x}, {y}, {z}).',
            'Listo, estoy por ({x}, {y}, {z}).',
          ],
          followUsage: [
            'Puedes decir: sigueme, o follow <jugador>.',
            'Prueba: sigueme, o follow Steve 3.',
          ],
          followStart: [
            'Ok, te sigo {username}.',
            'Vale {username}, voy contigo.',
            'Dale, te sigo a distancia {distance}.',
          ],
          stopDone: [
            'Vale, me detengo.',
            'Listo, paro aquí.',
          ],
          sayUsage: [
            'Dime qué quieres que diga. Ejemplo: di hola equipo.',
            'Falta el mensaje. Ejemplo: say hola.',
          ],
          sayDone: [
            'Hecho, ya lo dije.',
            'Listo, mensaje enviado.',
          ],
          commandFailed: [
            'Ups... no pude hacerlo: {reason}',
            'Perdón, fallé con eso: {reason}',
          ],
        };
      }

      return {
        help: [
          `Comandos: ${this.mentionPrefix}${this.botName} status | sigueme | ve a <x> <y> <z> | para | say <mensaje>.`,
        ],
        unknown: [
          `No entendí. Usa "${this.mentionPrefix}${this.botName} help".`,
        ],
        gotoUsage: [
          'Uso: goto <x> <y> <z>.',
        ],
        gotoStart: [
          'Voy a ({x}, {y}, {z}).',
        ],
        gotoArrived: [
          'Llegué a ({x}, {y}, {z}).',
        ],
        followUsage: [
          'Uso: sigueme o follow <jugador> [distancia].',
        ],
        followStart: [
          'Te sigo {username}.',
        ],
        stopDone: [
          'Detenido.',
        ],
        sayUsage: [
          'Uso: say <mensaje>.',
        ],
        sayDone: [
          'Mensaje enviado.',
        ],
        commandFailed: [
          'No pude ejecutar eso: {reason}',
        ],
      };
    }

    if (shy) {
      return {
        help: [
          `Um... try: "${this.mentionPrefix}${this.botName} status", "${this.mentionPrefix}${this.botName} follow me", "${this.mentionPrefix}${this.botName} goto 100 64 -20", "${this.mentionPrefix}${this.botName} stop".`,
          `I can do: status, follow me, goto <x> <y> <z>, stop, and say <message>.`,
        ],
        unknown: [
          `Sorry... I did not fully get that. Try "${this.mentionPrefix}${this.botName} help".`,
          `I might have missed that. Use "${this.mentionPrefix}${this.botName} help".`,
        ],
        gotoUsage: [
          'I need coordinates. Example: goto 120 64 -35.',
          'Please give x y z, like: go to 120 64 -35.',
        ],
        gotoStart: [
          'Okay, moving to ({x}, {y}, {z}).',
          'Alright, I am heading to ({x}, {y}, {z}).',
        ],
        gotoArrived: [
          'I am near ({x}, {y}, {z}) now.',
          'Done, I reached around ({x}, {y}, {z}).',
        ],
        followUsage: [
          'Try: follow me, or follow <player> [distance].',
          'You can say: follow me, or follow Steve 3.',
        ],
        followStart: [
          'Okay, I will follow you, {username}.',
          'Sure {username}, I am following you.',
          'Got it, following {username} at distance {distance}.',
        ],
        stopDone: [
          'Okay, I will stop here.',
          'Got it, stopping now.',
        ],
        sayUsage: [
          'Tell me what to say. Example: say hello team.',
          'I need the message text. Example: say hello.',
        ],
        sayDone: [
          'Done, I said it.',
          'Message sent.',
        ],
        commandFailed: [
          'Sorry, I could not do that: {reason}',
          'I failed that command: {reason}',
        ],
      };
    }

    return {
      help: [
        `Commands: ${this.mentionPrefix}${this.botName} status | follow me | goto <x> <y> <z> | stop | say <message>.`,
      ],
      unknown: [
        `Unknown request. Use "${this.mentionPrefix}${this.botName} help".`,
      ],
      gotoUsage: [
        'Usage: goto <x> <y> <z>.',
      ],
      gotoStart: [
        'Moving to ({x}, {y}, {z}).',
      ],
      gotoArrived: [
        'Arrived near ({x}, {y}, {z}).',
      ],
      followUsage: [
        'Usage: follow me or follow <player> [distance].',
      ],
      followStart: [
        'Following {username}.',
      ],
      stopDone: [
        'Stopped.',
      ],
      sayUsage: [
        'Usage: say <message>.',
      ],
      sayDone: [
        'Sent.',
      ],
      commandFailed: [
        'Command failed: {reason}',
      ],
    };
  }

  private buildStatusLine(language: Language): string {
    const state = this.botManager.getState();

    if (!state) {
      return language === 'es'
        ? 'Ahora mismo no estoy conectada.'
        : 'I am not connected right now.';
    }

    if (language === 'es') {
      return `Estoy en (${Math.floor(state.position.x)}, ${Math.floor(state.position.y)}, ${Math.floor(state.position.z)}), vida ${state.health}/20, comida ${state.food}/20, dimensión ${state.dimension}.`;
    }

    return `I am at (${Math.floor(state.position.x)}, ${Math.floor(state.position.y)}, ${Math.floor(state.position.z)}), health ${state.health}/20, food ${state.food}/20, dimension ${state.dimension}.`;
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

  private extractNumbers(text: string): number[] {
    const matches = text.match(/-?\d+(?:\.\d+)?/g);
    if (!matches) {
      return [];
    }

    return matches
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  private extractDistance(normalizedText: string): number | null {
    const match = normalizedText.match(/\b(?:distance|distancia|dist)?\s*(\d{1,2})\b/i);
    if (!match) {
      return null;
    }

    return this.sanitizeDistance(Number(match[1]));
  }

  private sanitizeDistance(distance: number): number {
    if (Number.isNaN(distance) || distance < 1) {
      return 3;
    }

    return Math.min(Math.max(Math.floor(distance), 1), 16);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
