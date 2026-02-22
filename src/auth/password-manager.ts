import { config } from '../utils/config-loader';
import { logger } from '../utils/logger';

export class PasswordManager {
  private readonly password: string;

  constructor() {
    this.password = this.loadPassword();
  }

  private loadPassword(): string {
    const password = config.auth.password;

    if (!password || password === 'defaultPassword123') {
      logger.warn('Using default password. Set BOT_PASSWORD in .env for security.');
    }

    if (password.length < 8) {
      logger.warn('BOT_PASSWORD is shorter than 8 characters.');
    }

    return password;
  }

  getPassword(): string {
    return this.password;
  }
}
