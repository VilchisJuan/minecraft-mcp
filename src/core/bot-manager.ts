import { Bot, createBot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { AuthHandler, AuthState } from '../auth/auth-handler';
import { PathfinderController, MovementStatus, MoveToOptions } from '../movement/pathfinder';
import { InGameControl } from '../personality/in-game-control';
import { config } from '../utils/config-loader';
import { activityLogger, logger } from '../utils/logger';

export interface BotState {
  connected: boolean;
  spawned: boolean;
  health: number;
  food: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
  dimension: string;
  gameMode: string;
  experience: {
    level: number;
    points: number;
    progress: number;
  };
}

export class BotManager {
  public bot: Bot | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private authHandler: AuthHandler | null = null;
  private movementController: PathfinderController | null = null;
  private inGameControl: InGameControl | null = null;

  async connect(): Promise<Bot> {
    if (this.bot) {
      logger.warn('Bot already connected, disconnecting first');
      await this.disconnect();
    }

    this.isShuttingDown = false;

    logger.info(`Connecting to ${config.minecraft.host}:${config.minecraft.port}`);
    logger.info(`Username: ${config.minecraft.username}`);
    logger.info(`Version: ${config.minecraft.version}`);
    logger.info(`Auth mode: ${config.minecraft.auth}`);

    this.bot = createBot({
      host: config.minecraft.host,
      port: config.minecraft.port,
      username: config.minecraft.username,
      version: config.minecraft.version,
      auth: config.minecraft.auth,
      hideErrors: false,
    });

    this.setupEventHandlers();
    this.setupAuthHandler();
    this.setupMovement();
    this.setupInGameControl();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timeout after 30 seconds'));
      }, 30000);

      const onSpawn = () => {
        cleanup();
        this.reconnectAttempts = 0;
        logger.info('Bot spawned successfully');
        activityLogger.info('Bot connected and spawned');
        resolve(this.bot as Bot);
      };

      const onError = (error: Error) => {
        cleanup();
        logger.error(`Connection error: ${this.describeError(error)}`);
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.bot?.off('spawn', onSpawn);
        this.bot?.off('error', onError);
      };

      this.bot?.once('spawn', onSpawn);
      this.bot?.once('error', onError);
    });
  }

  private setupEventHandlers(): void {
    if (!this.bot) {
      return;
    }

    this.bot.on('login', () => {
      logger.info('Bot logged in successfully');
    });

    this.bot.on('spawn', () => {
      logger.info(`Spawned at ${this.formatPosition(this.bot!.entity.position)}`);
      activityLogger.info(`Spawned in ${this.bot!.game.dimension}`);
    });

    this.bot.on('respawn', () => {
      logger.info('Bot respawned');
      activityLogger.info('Bot respawned');
    });

    this.bot.on('health', () => {
      const health = this.bot!.health;
      const food = this.bot!.food;

      if (health <= 5) {
        logger.warn(`Low health: ${health}/20`);
      }

      if (food <= 5) {
        logger.warn(`Low food: ${food}/20`);
      }
    });

    this.bot.on('death', () => {
      logger.warn('Bot died');
      activityLogger.info('Bot death event');
    });

    this.bot.on('message', (message) => {
      const text = message.toString();
      logger.debug(`Chat: ${text}`);
    });

    this.bot.on('whisper', (username, message) => {
      logger.info(`Whisper from ${username}: ${message}`);
      activityLogger.info(`Whisper from ${username}: ${message}`);
    });

    this.bot.on('error', (error) => {
      logger.error(`Bot runtime error: ${this.describeError(error)}`);
    });

    this.bot.on('kicked', (reason) => {
      const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
      logger.warn(`Kicked from server: ${reasonText}`);
      activityLogger.warn(`Kicked: ${reasonText}`);
      this.handleReconnect();
    });

    this.bot.on('end', (reason) => {
      logger.info(`Connection ended: ${reason ?? 'unknown reason'}`);
      activityLogger.info(`Disconnected: ${reason ?? 'unknown reason'}`);
      this.handleReconnect();
    });

    this.bot.on('experience', () => {
      const exp = this.bot!.experience;
      logger.debug(`XP level ${exp.level}, points ${exp.points}`);
    });
  }

  private setupAuthHandler(): void {
    if (!this.bot) {
      return;
    }

    this.authHandler = new AuthHandler(this.bot);

    this.authHandler.on('auth_success', () => {
      logger.info('Bot authenticated successfully');
    });

    this.authHandler.on('auth_required', (type: string) => {
      logger.warn(`Manual ${type} required`);
      logger.info(`Authentication password: ${this.authHandler?.getPassword()}`);
    });

    this.authHandler.on('auth_timeout', () => {
      logger.error('Authentication timeout');
      logger.info(`Use password if needed: ${this.authHandler?.getPassword()}`);
    });
  }

  private setupMovement(): void {
    if (!this.bot) {
      return;
    }

    this.movementController = new PathfinderController(this.bot);

    const initializeMovement = () => {
      if (!this.movementController) {
        return;
      }

      try {
        this.movementController.initialize();
        logger.info('Movement controller initialized');
      } catch (error) {
        logger.error(`Movement initialization failed: ${this.describeError(error)}`);
        return;
      }

      this.movementController.on('goal_started', (description: string) => {
        activityLogger.info(`Movement started: ${description}`);
      });

      this.movementController.on('goal_reached', (description: string) => {
        activityLogger.info(`Movement reached: ${description}`);
      });

      this.movementController.on('goal_failed', (event: { description: string; error: unknown }) => {
        logger.warn(`Movement failed: ${event.description}`);
        logger.debug(`Movement failure detail: ${this.describeError(event.error)}`);
        activityLogger.warn(`Movement failed: ${event.description}`);
      });
    };

    // Mineflayer injects external plugins after its internal inject phase.
    // Initializing pathfinder at spawn avoids false negatives.
    this.bot.once('spawn', initializeMovement);
  }

  private setupInGameControl(): void {
    if (!this.bot) {
      return;
    }

    this.inGameControl = new InGameControl(this.bot, this);
    this.inGameControl.start();
    logger.info(
      `In-game control enabled. Use "${config.personality.mentionPrefix}${config.minecraft.username} help" in chat.`,
    );
  }

  private handleReconnect(): void {
    if (this.isShuttingDown) {
      logger.info('Shutdown in progress, skipping reconnect');
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= config.advanced.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts reached (${config.advanced.maxReconnectAttempts})`);
      activityLogger.error('Reconnect budget exhausted');
      return;
    }

    this.reconnectAttempts += 1;

    const delayMs = Math.min(
      config.advanced.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      60000,
    );

    logger.info(
      `Reconnecting in ${Math.floor(delayMs / 1000)}s (attempt ${this.reconnectAttempts}/${config.advanced.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        logger.error(`Reconnection failed: ${this.describeError(error)}`);
      });
    }, delayMs);
  }

  getState(): BotState | null {
    if (!this.bot || !this.bot.entity) {
      return null;
    }

    return {
      connected: true,
      spawned: this.bot.entity !== undefined,
      health: this.bot.health,
      food: this.bot.food,
      position: {
        x: this.bot.entity.position.x,
        y: this.bot.entity.position.y,
        z: this.bot.entity.position.z,
      },
      dimension: String(this.bot.game.dimension ?? 'unknown'),
      gameMode: String(this.bot.game.gameMode ?? 'unknown'),
      experience: {
        level: this.bot.experience.level,
        points: this.bot.experience.points,
        progress: this.bot.experience.progress,
      },
    };
  }

  getAuthState(): AuthState | null {
    return this.authHandler?.getAuthState() ?? null;
  }

  getMovementStatus(): MovementStatus | null {
    return this.movementController?.getStatus() ?? null;
  }

  async moveTo(x: number, y: number, z: number, options?: MoveToOptions): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Bot is not ready');
    }

    if (!this.movementController) {
      throw new Error('Movement controller is unavailable');
    }

    if (!this.movementController.isInitialized()) {
      throw new Error('Movement controller is not initialized yet (wait for spawn)');
    }

    await this.movementController.goTo(x, y, z, options);
  }

  followPlayer(username: string, distance = 3): void {
    if (!this.isReady()) {
      throw new Error('Bot is not ready');
    }

    if (!this.movementController) {
      throw new Error('Movement controller is unavailable');
    }

    if (!this.movementController.isInitialized()) {
      throw new Error('Movement controller is not initialized yet (wait for spawn)');
    }

    this.movementController.followPlayer(username, distance);
  }

  stopMovement(): void {
    this.movementController?.stop();
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.movementController) {
      this.movementController.destroy();
      this.movementController = null;
    }

    if (this.inGameControl) {
      this.inGameControl.stop();
      this.inGameControl = null;
    }

    if (this.authHandler) {
      this.authHandler.destroy();
      this.authHandler = null;
    }

    if (this.bot) {
      logger.info('Disconnecting bot...');
      if (typeof this.bot.quit === 'function') {
        this.bot.quit('Shutting down');
      } else if (typeof (this.bot as unknown as { end?: (reason?: string) => void }).end === 'function') {
        (this.bot as unknown as { end: (reason?: string) => void }).end('Shutting down');
      }
      this.bot.removeAllListeners();
      this.bot = null;
      activityLogger.info('Bot disconnected');
    }

    this.isShuttingDown = false;
  }

  isReady(): boolean {
    return this.bot !== null && this.bot.entity !== undefined;
  }

  chat(message: string): void {
    if (!this.isReady()) {
      logger.warn('Cannot send chat: bot is not ready');
      return;
    }

    this.bot!.chat(message);
    activityLogger.info(`Bot chat: ${message}`);
  }

  whisper(username: string, message: string): void {
    if (!this.isReady()) {
      logger.warn('Cannot whisper: bot is not ready');
      return;
    }

    this.bot!.whisper(username, message);
    activityLogger.info(`Whisper to ${username}: ${message}`);
  }

  private formatPosition(position: Vec3): string {
    return `(${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }

    return String(error);
  }
}
