import { ILogger } from '../src/core/ports/ILogger';
import { RateLimitError } from '../src/shared/errors';
import { RetryPolicy, withRetry } from '../src/shared/retry';

const silentLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const fastPolicy: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1, // milisegundos mínimos: los tests no deben tardar
  maxDelayMs: 5,
};

describe('withRetry (backoff exponencial)', () => {
  it('devuelve el resultado al primer intento exitoso', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(op, fastPolicy, silentLogger)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('reintenta y termina teniendo éxito tras fallos transitorios', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error('red caída'))
      .mockRejectedValueOnce(new Error('red caída'))
      .mockResolvedValue('ok');

    await expect(withRetry(op, fastPolicy, silentLogger)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('reintenta ante un 429 (RateLimitError)', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new RateLimitError('429', 0))
      .mockResolvedValue('ok');

    await expect(withRetry(op, fastPolicy, silentLogger)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('relanza el último error tras agotar los intentos', async () => {
    const op = jest.fn().mockRejectedValue(new Error('siempre falla'));

    await expect(withRetry(op, fastPolicy, silentLogger)).rejects.toThrow('siempre falla');
    expect(op).toHaveBeenCalledTimes(fastPolicy.maxAttempts);
  });

  it('pasa el número de intento a la operación', async () => {
    const seen: number[] = [];
    const op = jest.fn(async (attempt: number) => {
      seen.push(attempt);
      if (attempt < 3) throw new Error('aún no');
      return 'ok';
    });

    await withRetry(op, fastPolicy, silentLogger);
    expect(seen).toEqual([1, 2, 3]);
  });
});
