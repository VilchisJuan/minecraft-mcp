import { EventEmitter } from 'events';
import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export interface StuckEvent {
  position: Vec3;
}

export class ObstacleHandler extends EventEmitter {
  private readonly bot: Bot;
  private readonly isMoving: () => boolean;
  private monitorTimer: NodeJS.Timeout | null = null;
  private lastPosition: Vec3 | null = null;
  private unchangedTicks = 0;
  private readonly unchangedTickLimit = 6;
  private readonly tickMs = 1500;

  constructor(bot: Bot, isMoving: () => boolean) {
    super();
    this.bot = bot;
    this.isMoving = isMoving;
  }

  start(): void {
    if (this.monitorTimer) {
      return;
    }

    this.monitorTimer = setInterval(() => {
      this.checkMovement();
    }, this.tickMs);
  }

  stop(): void {
    if (!this.monitorTimer) {
      return;
    }

    clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.lastPosition = null;
    this.unchangedTicks = 0;
  }

  private checkMovement(): void {
    if (!this.isMoving() || !this.bot.entity) {
      this.lastPosition = null;
      this.unchangedTicks = 0;
      return;
    }

    const currentPosition = this.bot.entity.position.clone();

    if (!this.lastPosition) {
      this.lastPosition = currentPosition;
      return;
    }

    const dx = currentPosition.x - this.lastPosition.x;
    const dy = currentPosition.y - this.lastPosition.y;
    const dz = currentPosition.z - this.lastPosition.z;
    const distanceSquared = (dx * dx) + (dy * dy) + (dz * dz);

    if (distanceSquared < 0.05) {
      this.unchangedTicks += 1;
    } else {
      this.unchangedTicks = 0;
    }

    this.lastPosition = currentPosition;

    if (this.unchangedTicks >= this.unchangedTickLimit) {
      this.unchangedTicks = 0;
      this.emit('stuck', { position: currentPosition } as StuckEvent);
    }
  }
}
