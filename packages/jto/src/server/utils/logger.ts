import { config } from '../config/index.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    return levels.indexOf(level) <= levels.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context
      ? ` ${JSON.stringify(context, this.errorReplacer)}`
      : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  private errorReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    return value;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;
    const formatted = this.formatMessage(level, message, context);
    switch (level) {
    case 'error': console.error(formatted); break;
    case 'warn': console.warn(formatted); break;
    case 'info': console.info(formatted); break;
    case 'debug': console.debug(formatted); break;
    }
  }

  error(message: string, context?: LogContext): void { this.log('error', message, context); }
  warn(message: string, context?: LogContext): void { this.log('warn', message, context); }
  info(message: string, context?: LogContext): void { this.log('info', message, context); }
  debug(message: string, context?: LogContext): void { this.log('debug', message, context); }
}

export const logger = new Logger(config.LOG_LEVEL);
