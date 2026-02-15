import { BotManager } from '../bot-manager';
import { logger } from '../../utils/logger';

async function testConnection(): Promise<void> {
  const manager = new BotManager();

  try {
    logger.info('Testing Minecraft connection...');
    await manager.connect();

    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });

    const state = manager.getState();
    logger.info(`State snapshot: ${JSON.stringify(state)}`);

    manager.chat('Hello from test-connection.ts');

    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    await manager.disconnect();
    logger.info('Connection test completed');
  } catch (error) {
    logger.error('Connection test failed', { error });
    await manager.disconnect();
    throw error;
  }
}

if (require.main === module) {
  void testConnection().catch((error) => {
    logger.error('Unhandled test error', { error });
    process.exit(1);
  });
}
