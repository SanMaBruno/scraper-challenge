import { ILogger } from '../../core/ports/ILogger';

type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger simple a consola con marca de tiempo. Implementa `ILogger`.
 * El nivel `debug` solo se muestra si DEBUG=1 para no saturar la salida.
 */
export class ConsoleLogger implements ILogger {
  private readonly debugEnabled = process.env.DEBUG === '1';

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.debugEnabled) this.log('debug', message, meta);
  }

  private log(level: Level, message: string, meta?: Record<string, unknown>): void {
    const icon = { debug: '·', info: 'ℹ', warn: '⚠', error: '✖' }[level];
    const time = new Date().toISOString();
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    // eslint-disable-next-line no-console
    console.log(`${time} ${icon} ${message}${suffix}`);
  }
}
