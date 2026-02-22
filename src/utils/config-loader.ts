import dotenv from 'dotenv';

dotenv.config();

export type OperatingMode = 'mcp' | 'terminal';
export type MinecraftAuthMode = 'microsoft' | 'offline';

export interface Config {
  mode: OperatingMode;
  ai: {
    apiKey: string;
    model: string;
  };
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
    auth: MinecraftAuthMode;
  };
  auth: {
    autoRegister: boolean;
    password: string;
  };
  personality: {
    gender: 'female' | 'male' | 'neutral';
    type: string;
    mentionPrefix: string;
  };
  logging: {
    level: string;
    toFile: boolean;
    toConsole: boolean;
  };
  advanced: {
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
    movementTimeoutMs: number;
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

function parseNumber(value: string | undefined, defaultValue: number, variableName: string): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${variableName} must be a valid integer`);
  }

  return parsed;
}

class ConfigLoader {
  private readonly config: Config;

  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  private loadConfig(): Config {
    return {
      mode: (process.env.MODE as OperatingMode) ?? 'terminal',
      ai: {
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      },
      minecraft: {
        host: process.env.MC_HOST ?? 'localhost',
        port: parseNumber(process.env.MC_PORT, 25565, 'MC_PORT'),
        username: process.env.MC_USERNAME ?? 'BotGirl',
        version: process.env.MC_VERSION ?? '1.20.1',
        auth: (process.env.MC_AUTH as MinecraftAuthMode) ?? 'offline',
      },
      auth: {
        autoRegister: parseBoolean(process.env.AUTO_REGISTER, true),
        password: process.env.BOT_PASSWORD ?? 'defaultPassword123',
      },
      personality: {
        gender: (process.env.BOT_GENDER as 'female' | 'male' | 'neutral') ?? 'female',
        type: process.env.BOT_PERSONALITY ?? 'shy',
        mentionPrefix: process.env.BOT_MENTION_PREFIX ?? '@',
      },
      logging: {
        level: process.env.LOG_LEVEL ?? 'info',
        toFile: parseBoolean(process.env.LOG_TO_FILE, true),
        toConsole: parseBoolean(process.env.LOG_TO_CONSOLE, true),
      },
      advanced: {
        maxReconnectAttempts: parseNumber(process.env.MAX_RECONNECT_ATTEMPTS, 10, 'MAX_RECONNECT_ATTEMPTS'),
        reconnectDelayMs: parseNumber(process.env.RECONNECT_DELAY_MS, 5000, 'RECONNECT_DELAY_MS'),
        movementTimeoutMs: parseNumber(process.env.MOVEMENT_TIMEOUT_MS, 45000, 'MOVEMENT_TIMEOUT_MS'),
      },
    };
  }

  private validateConfig(): void {
    const validModes: OperatingMode[] = ['mcp', 'terminal'];
    if (!validModes.includes(this.config.mode)) {
      throw new Error(`MODE must be one of: ${validModes.join(', ')}`);
    }

    const validAuthModes: MinecraftAuthMode[] = ['microsoft', 'offline'];
    if (!validAuthModes.includes(this.config.minecraft.auth)) {
      throw new Error(`MC_AUTH must be one of: ${validAuthModes.join(', ')}`);
    }

    if (!this.config.ai.apiKey) {
      throw new Error('OPENAI_API_KEY is required in .env');
    }

    if (!this.config.minecraft.host.trim()) {
      throw new Error('MC_HOST is required');
    }

    if (this.config.minecraft.port < 1 || this.config.minecraft.port > 65535) {
      throw new Error('MC_PORT must be between 1 and 65535');
    }

    if (this.config.auth.autoRegister && !this.config.auth.password.trim()) {
      throw new Error('BOT_PASSWORD is required when AUTO_REGISTER=true');
    }

    if (this.config.advanced.maxReconnectAttempts < 0) {
      throw new Error('MAX_RECONNECT_ATTEMPTS must be >= 0');
    }

    if (this.config.advanced.reconnectDelayMs < 0) {
      throw new Error('RECONNECT_DELAY_MS must be >= 0');
    }

    if (this.config.advanced.movementTimeoutMs <= 0) {
      throw new Error('MOVEMENT_TIMEOUT_MS must be > 0');
    }
  }

  getConfig(): Config {
    return this.config;
  }
}

export const configLoader = new ConfigLoader();
export const config = configLoader.getConfig();
