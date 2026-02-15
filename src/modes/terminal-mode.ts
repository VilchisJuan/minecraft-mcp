import * as readline from 'node:readline';
import { BotManager } from '../core/bot-manager';
import { config } from '../utils/config-loader';
import { logger } from '../utils/logger';

export class TerminalMode {
  private readonly botManager: BotManager;
  private rl: readline.Interface | null = null;
  private started = false;

  constructor() {
    this.botManager = new BotManager();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Terminal mode already started');
      return;
    }

    logger.info('Starting terminal mode...');
    await this.botManager.connect();
    this.started = true;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      logger.warn('No interactive TTY detected. Local terminal input is disabled in this session.');
      logger.warn(
        `Use in-game chat commands instead, e.g. "${config.personality.mentionPrefix}${config.minecraft.username} help".`,
      );
      return;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      prompt: '> ',
    });

    this.rl.on('line', (line) => {
      void this.handleInput(line.trim()).finally(() => {
        if (this.started) {
          this.rl?.prompt();
        }
      });
    });

    this.rl.on('close', () => {
      if (this.started) {
        void this.stop();
      }
    });

    this.printHelp();
    logger.info('Terminal input ready. Type /help and press Enter.');
    this.rl.prompt();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;

    if (this.rl) {
      this.rl.removeAllListeners();
      this.rl.close();
      this.rl = null;
    }

    await this.botManager.disconnect();
  }

  private async handleInput(input: string): Promise<void> {
    if (!input) {
      return;
    }

    if (!input.startsWith('/')) {
      this.botManager.chat(input);
      return;
    }

    const parts = input.slice(1).split(' ').filter((part) => part.length > 0);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
        this.printHelp();
        return;
      case 'status':
        this.printStatus();
        return;
      case 'say':
        this.botManager.chat(args.join(' '));
        return;
      case 'goto':
        await this.handleGoto(args);
        return;
      case 'follow':
        await this.handleFollow(args);
        return;
      case 'stop':
        this.botManager.stopMovement();
        logger.info('Movement stopped');
        return;
      case 'quit':
      case 'exit':
        await this.stop();
        process.exit(0);
        return;
      default:
        logger.warn(`Unknown command: ${command}. Use /help.`);
    }
  }

  private async handleGoto(args: string[]): Promise<void> {
    if (args.length < 3) {
      logger.warn('Usage: /goto <x> <y> <z>');
      return;
    }

    const x = Number(args[0]);
    const y = Number(args[1]);
    const z = Number(args[2]);

    if ([x, y, z].some((value) => Number.isNaN(value))) {
      logger.warn('Coordinates must be valid numbers');
      return;
    }

    logger.info(`Moving to (${x}, ${y}, ${z})...`);
    await this.botManager.moveTo(x, y, z);
    logger.info('Reached target');
  }

  private async handleFollow(args: string[]): Promise<void> {
    if (args.length < 1) {
      logger.warn('Usage: /follow <player> [distance]');
      return;
    }

    const username = args[0];
    const distance = args.length > 1 ? Number(args[1]) : 3;

    if (Number.isNaN(distance) || distance < 1) {
      logger.warn('Distance must be a number >= 1');
      return;
    }

    this.botManager.followPlayer(username, distance);
    logger.info(`Following ${username} with distance ${distance}`);
  }

  private printStatus(): void {
    const state = this.botManager.getState();
    const authState = this.botManager.getAuthState();
    const movementState = this.botManager.getMovementStatus();

    logger.info('Bot status');
    logger.info(`Connected: ${state?.connected ?? false}`);
    logger.info(`Spawned: ${state?.spawned ?? false}`);

    if (state) {
      logger.info(
        `Position: (${Math.floor(state.position.x)}, ${Math.floor(state.position.y)}, ${Math.floor(state.position.z)})`,
      );
      logger.info(`Health: ${state.health}/20`);
      logger.info(`Food: ${state.food}/20`);
      logger.info(`Dimension: ${state.dimension}`);
    }

    if (authState) {
      logger.info(`Auth logged in: ${authState.loggedIn}`);
      logger.info(`Auth attempts: ${authState.attempts}`);
    }

    if (movementState) {
      logger.info(`Moving: ${movementState.moving}`);
      if (movementState.currentGoal) {
        logger.info(`Current goal: ${movementState.currentGoal}`);
      }
      if (movementState.lastError) {
        logger.info(`Last movement error: ${movementState.lastError}`);
      }
    }
  }

  private printHelp(): void {
    logger.info('Terminal commands');
    logger.info('/help                  Show commands');
    logger.info('/status                Show bot status');
    logger.info('/say <message>         Send chat message');
    logger.info('/goto <x> <y> <z>      Move to coordinates');
    logger.info('/follow <player> [d]   Follow a player');
    logger.info('/stop                  Stop current movement');
    logger.info('/quit                  Disconnect and exit');
    logger.info('Any input without "/" is sent as normal chat.');
    logger.info(
      `In-game control: type "${config.personality.mentionPrefix}${config.minecraft.username} help" in Minecraft chat.`,
    );
  }
}
