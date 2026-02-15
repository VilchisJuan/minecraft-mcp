import { BotManager } from '../../core/bot-manager';
import { logger } from '../../utils/logger';

async function testMovement(): Promise<void> {
  const manager = new BotManager();

  try {
    logger.info('Testing movement system...');
    await manager.connect();

    const state = manager.getState();
    if (!state) {
      throw new Error('Bot state is not available after connection');
    }

    const target = {
      x: Math.floor(state.position.x) + 2,
      y: Math.floor(state.position.y),
      z: Math.floor(state.position.z) + 2,
    };

    logger.info(`Moving to (${target.x}, ${target.y}, ${target.z})`);
    await manager.moveTo(target.x, target.y, target.z, { timeoutMs: 30000, range: 1 });

    logger.info(`Movement status: ${JSON.stringify(manager.getMovementStatus())}`);
    await manager.disconnect();
    logger.info('Movement test completed');
  } catch (error) {
    logger.error('Movement test failed', { error });
    await manager.disconnect();
    throw error;
  }
}

if (require.main === module) {
  void testMovement().catch((error) => {
    logger.error('Unhandled test error', { error });
    process.exit(1);
  });
}
