import { Bot } from 'mineflayer';
import { Entity } from 'prismarine-entity';
import { Item } from 'prismarine-item';
import { logger, activityLogger } from '../utils/logger';

const TICK_INTERVAL_MS = 250;
const HUNGER_THRESHOLD = 14;
const ENEMY_RANGE = 5;
const LOOK_AT_PLAYER_RANGE = 16;
const ATTACK_REACH = 3.5;
const ATTACK_COOLDOWN_MS = 500;

const FOOD_ITEMS = new Set([
  'apple', 'baked_potato', 'beetroot', 'beetroot_soup', 'bread',
  'carrot', 'chorus_fruit', 'cooked_beef', 'cooked_chicken',
  'cooked_cod', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit',
  'cooked_salmon', 'cookie', 'dried_kelp', 'enchanted_golden_apple',
  'golden_apple', 'golden_carrot', 'honey_bottle', 'melon_slice',
  'mushroom_stew', 'pumpkin_pie', 'rabbit_stew', 'beef',
  'chicken', 'cod', 'mutton', 'porkchop', 'potato', 'rabbit',
  'salmon', 'rotten_flesh', 'spider_eye', 'suspicious_stew',
  'sweet_berries', 'tropical_fish', 'glow_berries',
]);

const HOSTILE_TYPES = new Set([
  'zombie', 'skeleton', 'spider', 'creeper', 'enderman',
  'witch', 'slime', 'phantom', 'drowned', 'husk',
  'stray', 'blaze', 'ghast', 'magma_cube', 'hoglin',
  'piglin_brute', 'warden', 'vindicator', 'pillager',
  'ravager', 'evoker', 'vex', 'wither_skeleton',
  'cave_spider', 'silverfish', 'guardian', 'elder_guardian',
  'shulker', 'zombified_piglin',
]);

const SWORD_TIERS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'];
const AXE_TIERS = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'];

export class SurvivalBehavior {
  private readonly bot: Bot;
  private readonly isBusy: () => boolean;
  private tickTimer: NodeJS.Timeout | null = null;
  private active = false;
  private isEating = false;
  private lastAttackTime = 0;

  constructor(bot: Bot, isBusy: () => boolean) {
    this.bot = bot;
    this.isBusy = isBusy;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    logger.info('Survival behavior started');
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.active || !this.bot.entity) {
      return;
    }

    try {
      // Priority 1: Self-defense (always, even when busy)
      const attacked = this.tryDefend();
      if (attacked) {
        return;
      }

      // Priority 2: Eat when hungry (always, even when busy)
      if (this.shouldEat()) {
        await this.tryEat();
        return;
      }

      // Priority 3: Look at nearby player when idle
      if (!this.isBusy()) {
        this.lookAtNearestPlayer();
      }
    } catch (error) {
      logger.debug(`Survival tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Auto-eat ---

  private shouldEat(): boolean {
    return !this.isEating && this.bot.food < HUNGER_THRESHOLD && this.bot.food > 0;
  }

  private async tryEat(): Promise<void> {
    const foodItem = this.findBestFood();
    if (!foodItem) {
      return;
    }

    this.isEating = true;

    try {
      await this.bot.equip(foodItem, 'hand');
      activityLogger.info(`Eating ${foodItem.name} (hunger: ${this.bot.food}/20)`);
      await this.bot.consume();
      activityLogger.info(`Finished eating. Hunger now: ${this.bot.food}/20`);
    } catch (error) {
      logger.debug(`Failed to eat: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isEating = false;
    }
  }

  private findBestFood(): Item | null {
    const items = this.bot.inventory.items().filter(item => FOOD_ITEMS.has(item.name));
    if (items.length === 0) {
      return null;
    }

    // Prefer cooked/high-saturation foods first (they appear earlier in FOOD_ITEMS set order isn't reliable, so sort)
    const priority = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
      'cooked_salmon', 'cooked_chicken', 'cooked_rabbit', 'cooked_cod',
      'bread', 'baked_potato', 'beetroot', 'carrot', 'apple', 'melon_slice'];

    for (const name of priority) {
      const found = items.find(item => item.name === name);
      if (found) {
        return found;
      }
    }

    return items[0];
  }

  // --- Self-defense ---

  private tryDefend(): boolean {
    const now = Date.now();
    if (now - this.lastAttackTime < ATTACK_COOLDOWN_MS) {
      return false;
    }

    const hostile = this.findNearestHostile();
    if (!hostile) {
      return false;
    }

    const distance = this.bot.entity.position.distanceTo(hostile.position);
    if (distance > ATTACK_REACH) {
      // Hostile is nearby but not in attack range yet — look at it
      this.bot.lookAt(hostile.position.offset(0, hostile.height * 0.8, 0));
      return false;
    }

    this.equipBestWeapon();
    this.bot.attack(hostile);
    this.lastAttackTime = now;

    return true;
  }

  private findNearestHostile(): Entity | null {
    return this.bot.nearestEntity(entity => {
      if (!entity || entity === this.bot.entity) {
        return false;
      }

      const name = entity.name?.toLowerCase() ?? '';
      if (!HOSTILE_TYPES.has(name)) {
        return false;
      }

      const distance = this.bot.entity.position.distanceTo(entity.position);
      return distance <= ENEMY_RANGE;
    }) ?? null;
  }

  private equipBestWeapon(): void {
    const items = this.bot.inventory.items();
    const itemNames = new Set(items.map(i => i.name));

    // Try swords first, then axes
    for (const weapon of [...SWORD_TIERS, ...AXE_TIERS]) {
      if (itemNames.has(weapon)) {
        const item = items.find(i => i.name === weapon)!;
        if (this.bot.heldItem?.slot !== item.slot) {
          void this.bot.equip(item, 'hand').catch(() => {});
        }
        return;
      }
    }
  }

  // --- Look at nearest player when idle ---

  private lookAtNearestPlayer(): void {
    let nearestPlayer: Entity | null = null;
    let nearestDistance = LOOK_AT_PLAYER_RANGE;

    for (const name in this.bot.players) {
      const player = this.bot.players[name];
      if (!player?.entity || player.entity === this.bot.entity) {
        continue;
      }

      const distance = this.bot.entity.position.distanceTo(player.entity.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPlayer = player.entity;
      }
    }

    if (nearestPlayer) {
      // Look at player's head height
      this.bot.lookAt(nearestPlayer.position.offset(0, 1.6, 0));
    }
  }
}
