import { EventEmitter } from 'events';
import { Bot } from 'mineflayer';
import { config } from '../utils/config-loader';
import { activityLogger, logger } from '../utils/logger';
import { PasswordManager } from './password-manager';

export interface AuthState {
  registered: boolean;
  loggedIn: boolean;
  attempts: number;
  lastAttempt: Date | null;
}

export class AuthHandler extends EventEmitter {
  private readonly bot: Bot;
  private readonly passwordManager: PasswordManager;
  private authState: AuthState = {
    registered: false,
    loggedIn: false,
    attempts: 0,
    lastAttempt: null,
  };
  private readonly registrationPatterns: RegExp[] = [
    /register/i,
    /\/register/i,
    /you (?:need to|must) register/i,
    /please register/i,
    /type \/register/i,
    /\/reg/i,
  ];
  private readonly loginPatterns: RegExp[] = [
    /login/i,
    /\/login/i,
    /you (?:need to|must) (?:log ?in|login)/i,
    /please (?:log ?in|login)/i,
    /type \/login/i,
    /authenticate/i,
  ];
  private readonly successPatterns: RegExp[] = [
    /successfully (registered|logged in)/i,
    /you (?:are now|have been) (registered|logged in)/i,
    /authentication successful/i,
    /login successful/i,
  ];
  private authCheckTimer: NodeJS.Timeout | null = null;
  private readonly maxAuthWaitMs = 60000;
  private readonly minAttemptIntervalMs = 3000;

  constructor(bot: Bot) {
    super();
    this.bot = bot;
    this.passwordManager = new PasswordManager();
    this.setupListeners();
  }

  private setupListeners(): void {
    this.bot.on('message', (message) => {
      const rawText = message.toString();
      const text = this.stripFormatting(rawText);
      this.handleChatMessage(text);
    });

    this.bot.once('spawn', () => {
      this.startAuthCheck();
    });
  }

  private handleChatMessage(text: string): void {
    logger.debug(`Auth check message: ${text}`);

    if (this.matchesPattern(text, this.successPatterns)) {
      this.authState.loggedIn = true;
      if (/register/i.test(text)) {
        this.authState.registered = true;
      }

      logger.info('Authentication successful');
      activityLogger.info('Successfully authenticated on server');
      this.emit('auth_success');
      this.stopAuthCheck();
      return;
    }

    if (this.authState.loggedIn) {
      return;
    }

    if (this.matchesPattern(text, this.registrationPatterns) && !this.authState.registered) {
      if (!this.canAttemptNow()) {
        return;
      }
      logger.info('Registration prompt detected');
      void this.attemptRegistration();
      return;
    }

    if (this.matchesPattern(text, this.loginPatterns)) {
      if (!this.canAttemptNow()) {
        return;
      }
      logger.info('Login prompt detected');
      void this.attemptLogin();
    }
  }

  private matchesPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }

  private canAttemptNow(): boolean {
    if (!this.authState.lastAttempt) {
      return true;
    }

    const elapsed = Date.now() - this.authState.lastAttempt.getTime();
    return elapsed >= this.minAttemptIntervalMs;
  }

  private async attemptRegistration(): Promise<void> {
    if (!config.auth.autoRegister) {
      logger.warn('Auto-registration is disabled. Manual registration required.');
      this.emit('auth_required', 'registration');
      return;
    }

    const password = this.passwordManager.getPassword();
    logger.info('Attempting auto-registration...');
    activityLogger.info('Attempting auto-registration command sequence');

    await this.delay(1000);

    const commands = [
      `/register ${password} ${password}`,
      `/register ${password}`,
      `/reg ${password} ${password}`,
      `/reg ${password}`,
    ];

    for (const command of commands) {
      this.bot.chat(command);
      this.authState.attempts += 1;
      this.authState.lastAttempt = new Date();

      await this.delay(2000);

      if (this.authState.loggedIn) {
        this.authState.registered = true;
        return;
      }
    }

    logger.warn('Auto-registration may have failed, manual registration may be required.');
    this.emit('auth_required', 'registration');
  }

  private async attemptLogin(): Promise<void> {
    const password = this.passwordManager.getPassword();
    logger.info('Attempting auto-login...');
    activityLogger.info('Attempting auto-login command sequence');

    await this.delay(1000);

    const commands = [
      `/login ${password}`,
      `/l ${password}`,
    ];

    for (const command of commands) {
      this.bot.chat(command);
      this.authState.attempts += 1;
      this.authState.lastAttempt = new Date();

      await this.delay(2000);

      if (this.authState.loggedIn) {
        return;
      }
    }

    logger.warn('Auto-login may have failed, manual login may be required.');
    this.emit('auth_required', 'login');
  }

  private startAuthCheck(): void {
    this.stopAuthCheck();

    this.authCheckTimer = setInterval(() => {
      if (!this.authState.loggedIn) {
        logger.debug('Waiting for server authentication...');
      } else {
        this.stopAuthCheck();
      }
    }, 5000);

    setTimeout(() => {
      if (!this.authState.loggedIn) {
        logger.warn('Authentication timeout reached');
        this.emit('auth_timeout');
      }
      this.stopAuthCheck();
    }, this.maxAuthWaitMs);
  }

  private stopAuthCheck(): void {
    if (!this.authCheckTimer) {
      return;
    }

    clearInterval(this.authCheckTimer);
    this.authCheckTimer = null;
  }

  getAuthState(): AuthState {
    return { ...this.authState };
  }

  getPassword(): string {
    return this.passwordManager.getPassword();
  }

  destroy(): void {
    this.stopAuthCheck();
    this.removeAllListeners();
  }

  private stripFormatting(text: string): string {
    return text.replace(/§[0-9A-FK-OR]/gi, '').trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
