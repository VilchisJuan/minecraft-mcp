import crypto from 'crypto';
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

  static generatePassword(length = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);

    let output = '';
    for (let i = 0; i < length; i += 1) {
      output += chars[bytes[i] % chars.length];
    }

    return output;
  }

  static hashPasswordForLogging(password: string): string {
    return crypto
      .createHash('sha256')
      .update(password)
      .digest('hex')
      .slice(0, 8);
  }
}
