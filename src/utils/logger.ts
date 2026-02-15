import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { config } from './config-loader';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const text = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    return stack ? `${text}\n${stack}` : text;
  }),
);

if (config.logging.toFile) {
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
}

const transports: winston.transport[] = [];

if (config.logging.toConsole) {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat,
    ),
  }));
}

if (config.logging.toFile) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      format: logFormat,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      format: logFormat,
    }),
  );
}

if (transports.length === 0) {
  transports.push(new winston.transports.Console({
    level: 'error',
    format: logFormat,
  }));
}

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
});

const activityTransports: winston.transport[] = [];

if (config.logging.toFile) {
  activityTransports.push(new winston.transports.File({
    filename: path.join('logs', 'bot-activity.log'),
    format: logFormat,
  }));
}

if (config.logging.toConsole) {
  activityTransports.push(new winston.transports.Console({
    level: 'info',
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat,
    ),
  }));
}

if (activityTransports.length === 0) {
  activityTransports.push(new winston.transports.Console({
    level: 'error',
    format: logFormat,
  }));
}

export const activityLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: activityTransports,
});
