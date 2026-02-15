import { BotManager } from '../../core/bot-manager';
import { logger } from '../../utils/logger';

async function testAuth(): Promise<void> {
  const manager = new BotManager();

  try {
    logger.info('Testing authentication flow...');
    await manager.connect();

    logger.info('Waiting for auth events (30s)...');
    await new Promise((resolve) => {
      setTimeout(resolve, 30000);
    });

    const authState = manager.getAuthState();
    logger.info(`Auth state: ${JSON.stringify(authState)}`);

    if (authState?.loggedIn) {
      logger.info('Authentication successful');
    } else {
      logger.warn('Authentication may require manual intervention');
    }

    await manager.disconnect();
    logger.info('Authentication test completed');
  } catch (error) {
    logger.error('Authentication test failed', { error });
    await manager.disconnect();
    throw error;
  }
}

if (require.main === module) {
  void testAuth().catch((error) => {
    logger.error('Unhandled test error', { error });
    process.exit(1);
  });
}
