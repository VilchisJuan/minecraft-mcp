import { EventEmitter } from 'events';
import { Bot } from 'mineflayer';

export interface GameEvent {
  type: string;
  data: unknown;
  timestamp: Date;
}

export class EventHandler extends EventEmitter {
  private readonly bot: Bot;
  private eventHistory: GameEvent[] = [];
  private readonly maxHistorySize: number;

  constructor(bot: Bot, maxHistorySize = 100) {
    super();
    this.bot = bot;
    this.maxHistorySize = maxHistorySize;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.bot.on('playerJoined', (player) => {
      const event = this.recordEvent('player_joined', { username: player.username });
      this.emit('player_joined', event);
    });

    this.bot.on('playerLeft', (player) => {
      const event = this.recordEvent('player_left', { username: player.username });
      this.emit('player_left', event);
    });

    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity) {
        const event = this.recordEvent('bot_hurt', { health: this.bot.health });
        this.emit('bot_hurt', event);
      }
    });

    this.bot.on('entityDead', (entity) => {
      const event = this.recordEvent('entity_died', {
        type: entity.type,
        position: entity.position,
      });
      this.emit('entity_died', event);
    });

    this.bot.on('windowOpen', (window) => {
      const event = this.recordEvent('window_opened', { type: window.type });
      this.emit('window_opened', event);
    });

    this.bot.on('chunkColumnLoad', (column) => {
      const event = this.recordEvent('chunk_loaded', { x: column.x, z: column.z });
      this.emit('chunk_loaded', event);
    });
  }

  private recordEvent(type: string, data: unknown): GameEvent {
    const event: GameEvent = {
      type,
      data,
      timestamp: new Date(),
    };

    this.eventHistory.push(event);

    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    return event;
  }

  getRecentEvents(type?: string, count = 10): GameEvent[] {
    const events = type
      ? this.eventHistory.filter((event) => event.type === type)
      : this.eventHistory;

    return events.slice(-count);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }
}
