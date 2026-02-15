import { EventEmitter } from 'events';
import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

export interface GoalExecutionOptions {
  timeoutMs: number;
}

export interface PathfinderLike {
  setGoal(goal: unknown, dynamic?: boolean): void;
  goto(goal: unknown): Promise<void>;
}

export class GoalExecutor extends EventEmitter {
  private readonly bot: Bot;
  private readonly pathfinder: PathfinderLike;
  private currentGoal: unknown | null = null;
  private currentGoalDescription: string | null = null;
  private currentGoalDynamic = false;

  constructor(bot: Bot, pathfinder: PathfinderLike) {
    super();
    this.bot = bot;
    this.pathfinder = pathfinder;
  }

  async goToBlock(target: Vec3, options: GoalExecutionOptions): Promise<void> {
    const goal = new goals.GoalBlock(
      Math.floor(target.x),
      Math.floor(target.y),
      Math.floor(target.z),
    );
    const description = `goto (${Math.floor(target.x)}, ${Math.floor(target.y)}, ${Math.floor(target.z)})`;
    await this.executeGoto(goal, description, options.timeoutMs);
  }

  async goNear(target: Vec3, range: number, options: GoalExecutionOptions): Promise<void> {
    const goal = new goals.GoalNear(
      Math.floor(target.x),
      Math.floor(target.y),
      Math.floor(target.z),
      range,
    );
    const description = `goNear (${Math.floor(target.x)}, ${Math.floor(target.y)}, ${Math.floor(target.z)}) r=${range}`;
    await this.executeGoto(goal, description, options.timeoutMs);
  }

  followEntity(entity: unknown, distance: number): void {
    const goal = new goals.GoalFollow(entity as never, distance);
    const description = `follow entity at distance ${distance}`;

    this.currentGoal = goal;
    this.currentGoalDescription = description;
    this.currentGoalDynamic = true;

    this.pathfinder.setGoal(goal, true);
    this.emit('goal_started', description);
  }

  retryCurrentGoal(): void {
    if (!this.currentGoal) {
      return;
    }

    this.pathfinder.setGoal(this.currentGoal, this.currentGoalDynamic);
    this.emit('goal_retried', this.currentGoalDescription ?? 'unknown');
  }

  stopCurrentGoal(reason = 'stopped'): void {
    this.pathfinder.setGoal(null);
    this.currentGoal = null;
    this.currentGoalDescription = null;
    this.currentGoalDynamic = false;
    this.emit('goal_stopped', reason);
  }

  getCurrentGoal(): unknown | null {
    return this.currentGoal;
  }

  getCurrentGoalDescription(): string | null {
    return this.currentGoalDescription;
  }

  private async executeGoto(goal: unknown, description: string, timeoutMs: number): Promise<void> {
    this.currentGoal = goal;
    this.currentGoalDescription = description;
    this.currentGoalDynamic = false;

    this.emit('goal_started', description);

    try {
      await this.withTimeout(this.pathfinder.goto(goal), timeoutMs, `Movement timeout: ${description}`);
      this.emit('goal_reached', description);
    } catch (error) {
      this.pathfinder.setGoal(null);
      this.emit('goal_failed', {
        description,
        error,
      });
      throw error;
    } finally {
      this.currentGoal = null;
      this.currentGoalDescription = null;
      this.currentGoalDynamic = false;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timeout);
          resolve(value);
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
}
