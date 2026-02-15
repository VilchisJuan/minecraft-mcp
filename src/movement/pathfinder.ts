import { EventEmitter } from 'events';
import { Bot } from 'mineflayer';
import { Movements, pathfinder } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { config } from '../utils/config-loader';
import { logger } from '../utils/logger';
import { GoalExecutor, PathfinderLike } from './goal-executor';
import { ObstacleHandler, StuckEvent } from './obstacle-handler';

export interface MoveToOptions {
  timeoutMs?: number;
  range?: number;
}

export interface MovementStatus {
  moving: boolean;
  currentGoal: string | null;
  lastError: string | null;
}

type BotWithPathfinder = Bot & {
  pathfinder?: PathfinderLike & {
    setMovements(movements: Movements): void;
    isMoving(): boolean;
  };
};

export class PathfinderController extends EventEmitter {
  private readonly bot: Bot;
  private movement: Movements | null = null;
  private pathfinder: (PathfinderLike & {
    setMovements(movements: Movements): void;
    isMoving(): boolean;
  }) | null = null;
  private goalExecutor: GoalExecutor | null = null;
  private obstacleHandler: ObstacleHandler | null = null;
  private initialized = false;
  private status: MovementStatus = {
    moving: false,
    currentGoal: null,
    lastError: null,
  };

  constructor(bot: Bot) {
    super();
    this.bot = bot;
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    const botWithPathfinder = this.bot as BotWithPathfinder;
    if (!botWithPathfinder.pathfinder) {
      this.bot.loadPlugin(pathfinder as unknown as (bot: Bot) => void);
    }

    if (!botWithPathfinder.pathfinder) {
      throw new Error('Failed to initialize pathfinder plugin');
    }

    this.pathfinder = botWithPathfinder.pathfinder;

    this.movement = new Movements(this.bot);
    this.movement.allowSprinting = true;
    this.movement.allow1by1towers = true;
    this.pathfinder.setMovements(this.movement);

    this.goalExecutor = new GoalExecutor(this.bot, this.pathfinder);
    this.goalExecutor.on('goal_started', (description: string) => {
      this.status.moving = true;
      this.status.currentGoal = description;
      this.status.lastError = null;
      this.emit('goal_started', description);
    });
    this.goalExecutor.on('goal_reached', (description: string) => {
      this.status.moving = false;
      this.status.currentGoal = null;
      this.emit('goal_reached', description);
    });
    this.goalExecutor.on('goal_failed', (event: { description: string; error: unknown }) => {
      this.status.moving = false;
      this.status.currentGoal = null;
      this.status.lastError = event.error instanceof Error ? event.error.message : String(event.error);
      this.emit('goal_failed', event);
    });
    this.goalExecutor.on('goal_stopped', () => {
      this.status.moving = false;
      this.status.currentGoal = null;
      this.emit('goal_stopped');
    });

    this.obstacleHandler = new ObstacleHandler(this.bot, () => this.isMoving());
    this.obstacleHandler.on('stuck', (event: StuckEvent) => {
      logger.warn(
        `Movement appears stuck near (${Math.floor(event.position.x)}, ${Math.floor(event.position.y)}, ${Math.floor(event.position.z)}), retrying goal`,
      );
      this.goalExecutor?.retryCurrentGoal();
      this.emit('stuck', event);
    });
    this.obstacleHandler.start();

    this.initialized = true;
  }

  async goTo(x: number, y: number, z: number, options: MoveToOptions = {}): Promise<void> {
    this.ensureInitialized();
    const goalExecutor = this.requireGoalExecutor();

    if (options.range && options.range > 0) {
      await goalExecutor.goNear(new Vec3(x, y, z), options.range, {
        timeoutMs: options.timeoutMs ?? config.advanced.movementTimeoutMs,
      });
      return;
    }

    await goalExecutor.goToBlock(new Vec3(x, y, z), {
      timeoutMs: options.timeoutMs ?? config.advanced.movementTimeoutMs,
    });
  }

  followPlayer(username: string, distance = 3): void {
    this.ensureInitialized();
    const goalExecutor = this.requireGoalExecutor();

    const player = this.bot.players[username];
    if (!player?.entity) {
      throw new Error(`Player "${username}" is not visible to the bot`);
    }

    goalExecutor.followEntity(player.entity, distance);
  }

  stop(): void {
    if (!this.initialized || !this.goalExecutor) {
      return;
    }

    this.goalExecutor.stopCurrentGoal('manual stop');
  }

  isMoving(): boolean {
    if (!this.pathfinder) {
      return false;
    }

    return this.pathfinder.isMoving();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getStatus(): MovementStatus {
    return { ...this.status };
  }

  destroy(): void {
    this.stop();
    this.obstacleHandler?.stop();
    this.obstacleHandler?.removeAllListeners();
    this.obstacleHandler = null;
    this.goalExecutor?.removeAllListeners();
    this.goalExecutor = null;
    this.pathfinder = null;
    this.movement = null;
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PathfinderController has not been initialized');
    }
  }

  private requireGoalExecutor(): GoalExecutor {
    if (!this.goalExecutor) {
      throw new Error('Goal executor is not available');
    }

    return this.goalExecutor;
  }
}
