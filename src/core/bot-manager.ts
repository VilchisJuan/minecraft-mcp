import { Bot, createBot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Block } from 'prismarine-block';
import { Item } from 'prismarine-item';
import { AuthHandler, AuthState } from '../auth/auth-handler';
import { PathfinderController, MovementStatus, MoveToOptions } from '../movement/pathfinder';
import { InGameControl } from '../personality/in-game-control';
import { SurvivalBehavior } from '../survival/survival-behavior';
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

export interface AreaCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface MineAreaResult {
  minedBlocks: number;
  skippedBlocks: number;
}

interface AreaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

type BotWithHarvestPathfinder = Bot & {
  pathfinder?: {
    bestHarvestTool?: (block: Block) => Item | null;
  };
};

export class BotManager {
  public bot: Bot | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private authHandler: AuthHandler | null = null;
  private movementController: PathfinderController | null = null;
  private inGameControl: InGameControl | null = null;
  private survivalBehavior: SurvivalBehavior | null = null;
  private miningInProgress = false;
  private abortMining = false;
  private stopSignal = 0;

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
    this.setupSurvivalBehavior();

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

  private setupSurvivalBehavior(): void {
    if (!this.bot) {
      return;
    }

    this.survivalBehavior = new SurvivalBehavior(this.bot, () => this.isBotBusy());

    this.bot.once('spawn', () => {
      this.survivalBehavior?.start();
    });
  }

  isBotBusy(): boolean {
    if (this.miningInProgress) {
      return true;
    }

    const movement = this.getMovementStatus();
    if (movement?.moving) {
      return true;
    }

    return false;
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
    this.stopSignal += 1;
    this.abortMining = true;
    this.bot?.stopDigging();
    this.movementController?.stop();
  }

  getStopSignal(): number {
    return this.stopSignal;
  }

  wasStoppedAfter(signal: number): boolean {
    return this.stopSignal !== signal;
  }

  async mineArea(from: AreaCoordinates, to: AreaCoordinates): Promise<MineAreaResult> {
    if (!this.isReady()) {
      throw new Error('Bot is not ready');
    }

    if (!this.movementController) {
      throw new Error('Movement controller is unavailable');
    }

    if (!this.movementController.isInitialized()) {
      throw new Error('Movement controller is not initialized yet (wait for spawn)');
    }

    if (this.miningInProgress) {
      throw new Error('A mining task is already running');
    }

    this.miningInProgress = true;
    this.abortMining = false;
    this.movementController.stop();

    const bounds = this.buildAreaBounds(from, to);
    const center = this.buildAreaCenter(bounds);
    const ignoredBlocks = new Set<string>();
    let minedBlocks = 0;
    let skippedBlocks = 0;
    let shouldRescanAfterReposition = true;

    activityLogger.info(
      `Mining area started: (${bounds.minX}, ${bounds.minY}, ${bounds.minZ}) -> (${bounds.maxX}, ${bounds.maxY}, ${bounds.maxZ})`,
    );

    try {
      while (true) {
        if (this.abortMining) {
          break;
        }

        const targetBlock = this.findNextBlockInArea(bounds, ignoredBlocks);
        if (!targetBlock) {
          if (!shouldRescanAfterReposition) {
            break;
          }

          shouldRescanAfterReposition = false;
          await this.moveTo(center.x, center.y, center.z, {
            range: 3,
            timeoutMs: config.advanced.movementTimeoutMs,
          });
          continue;
        }

        shouldRescanAfterReposition = true;

        try {
          const mined = await this.mineBlock(targetBlock.position);
          if (mined) {
            minedBlocks += 1;
          } else {
            skippedBlocks += 1;
            ignoredBlocks.add(this.blockKey(targetBlock.position));
          }
        } catch (error) {
          // If mining was aborted via stopMovement, exit cleanly
          if (this.abortMining) {
            break;
          }
          skippedBlocks += 1;
          ignoredBlocks.add(this.blockKey(targetBlock.position));
          logger.warn(`Skipping block at ${this.formatPosition(targetBlock.position)}: ${this.describeError(error)}`);
        }
      }

      const wasStopped = this.abortMining;

      activityLogger.info(
        wasStopped
          ? `Mining stopped by user: mined=${minedBlocks}, skipped=${skippedBlocks}`
          : `Mining area completed: mined=${minedBlocks}, skipped=${skippedBlocks}, area=(${bounds.minX}, ${bounds.minY}, ${bounds.minZ}) -> (${bounds.maxX}, ${bounds.maxY}, ${bounds.maxZ})`,
      );

      return {
        minedBlocks,
        skippedBlocks,
      };
    } finally {
      this.miningInProgress = false;
      this.abortMining = false;
    }
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

    if (this.survivalBehavior) {
      this.survivalBehavior.stop();
      this.survivalBehavior = null;
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

  private buildAreaBounds(from: AreaCoordinates, to: AreaCoordinates): AreaBounds {
    const fromX = Math.floor(from.x);
    const fromY = Math.floor(from.y);
    const fromZ = Math.floor(from.z);
    const toX = Math.floor(to.x);
    const toY = Math.floor(to.y);
    const toZ = Math.floor(to.z);

    return {
      minX: Math.min(fromX, toX),
      maxX: Math.max(fromX, toX),
      minY: Math.min(fromY, toY),
      maxY: Math.max(fromY, toY),
      minZ: Math.min(fromZ, toZ),
      maxZ: Math.max(fromZ, toZ),
    };
  }

  private buildAreaCenter(bounds: AreaBounds): AreaCoordinates {
    return {
      x: Math.floor((bounds.minX + bounds.maxX) / 2),
      y: bounds.maxY + 1,
      z: Math.floor((bounds.minZ + bounds.maxZ) / 2),
    };
  }

  private findNextBlockInArea(bounds: AreaBounds, ignoredBlocks: Set<string>): Block | null {
    if (!this.bot?.entity) {
      return null;
    }

    const dx = bounds.maxX - bounds.minX + 1;
    const dy = bounds.maxY - bounds.minY + 1;
    const dz = bounds.maxZ - bounds.minZ + 1;
    const searchDistance = Math.max(32, Math.ceil(Math.sqrt((dx * dx) + (dy * dy) + (dz * dz))) + 8);

    const matches = this.bot.findBlocks({
      point: this.bot.entity.position,
      maxDistance: searchDistance,
      count: 128,
      matching: (block: Block | null) => {
        if (!this.isDiggableBlock(block)) {
          return false;
        }

        // Mineflayer can call this matcher with palette blocks that do not have
        // a world position. Returning true keeps eligible sections in the scan.
        if (!block.position) {
          return true;
        }

        return (
          this.isWithinArea(block.position, bounds)
          && !ignoredBlocks.has(this.blockKey(block.position))
        );
      },
    });

    for (const position of matches) {
      const block = this.bot.blockAt(position);
      if (!this.isDiggableBlock(block) || !block?.position) {
        continue;
      }

      if (
        !this.isWithinArea(block.position, bounds)
        || ignoredBlocks.has(this.blockKey(block.position))
      ) {
        continue;
      }

      return block;
    }

    return null;
  }

  private async mineBlock(position: Vec3): Promise<boolean> {
    if (!this.bot) {
      throw new Error('Bot is not ready');
    }

    await this.moveTo(position.x, position.y, position.z, {
      range: 2,
      timeoutMs: config.advanced.movementTimeoutMs,
    });

    const block = this.bot.blockAt(position);
    if (!this.isDiggableBlock(block)) {
      return false;
    }

    await this.equipBestToolForBlock(block);

    if (!this.bot.canDigBlock(block)) {
      return false;
    }

    await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await this.bot.dig(block, true);
    return true;
  }

  private async equipBestToolForBlock(block: Block): Promise<void> {
    if (!this.bot) {
      return;
    }

    const botWithPathfinder = this.bot as BotWithHarvestPathfinder;
    const bestTool = botWithPathfinder.pathfinder?.bestHarvestTool?.(block) ?? null;
    if (!bestTool) {
      return;
    }

    if (this.bot.heldItem?.slot === bestTool.slot) {
      return;
    }

    try {
      await this.bot.equip(bestTool, 'hand');
    } catch (error) {
      logger.warn(`Failed to equip best tool ${bestTool.name} for ${block.name}: ${this.describeError(error)}`);
    }
  }

  private isDiggableBlock(block: Block | null | undefined): block is Block {
    if (!block) {
      return false;
    }

    return block.name !== 'air' && block.boundingBox !== 'empty' && block.diggable;
  }

  private isWithinArea(position: Vec3 | null | undefined, bounds: AreaBounds): boolean {
    if (!position) {
      return false;
    }

    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);

    return (
      x >= bounds.minX && x <= bounds.maxX
      && y >= bounds.minY && y <= bounds.maxY
      && z >= bounds.minZ && z <= bounds.maxZ
    );
  }

  private blockKey(position: Vec3): string {
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }

    return String(error);
  }
}

