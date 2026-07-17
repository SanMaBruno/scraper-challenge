import { ILogger } from '../core/ports/ILogger';
import { RateLimitError } from './errors';
import { sleep } from './sleep';

export interface RetryPolicy {
  /** Número máximo de intentos (incluye el primero). */
  readonly maxAttempts: number;
  /** Retardo base en ms para el backoff exponencial. */
  readonly baseDelayMs: number;
  /** Retardo máximo en ms (tope del backoff). */
  readonly maxDelayMs: number;
}

/**
 * Ejecuta `operation` aplicando reintentos con **backoff exponencial** y
 * *jitter* (aleatoriedad) para evitar sincronización de reintentos.
 *
 * - Ante un `RateLimitError` (HTTP 429) respeta `Retry-After` si está presente;
 *   de lo contrario usa `baseDelayMs * 2^(intento-1)` acotado por `maxDelayMs`.
 * - Si se agotan los intentos, relanza el último error para que el llamador
 *   decida (p. ej. registrar el fallo y continuar con el siguiente documento).
 *
 * Responsabilidad única: solo orquesta la política de reintento; no sabe qué
 * hace la operación.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  logger: ILogger,
  operationName = 'operación',
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const isRateLimit = error instanceof RateLimitError;

      if (attempt >= policy.maxAttempts) {
        logger.error(`«${operationName}» falló tras ${attempt} intento(s)`, {
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      const delayMs = computeDelay(attempt, policy, error);
      logger.warn(
        `«${operationName}» falló (intento ${attempt}/${policy.maxAttempts}). ` +
          `Reintentando en ${delayMs} ms${isRateLimit ? ' [rate limit 429]' : ''}.`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/** Calcula el retardo del próximo intento (backoff exponencial + jitter). */
function computeDelay(attempt: number, policy: RetryPolicy, error: unknown): number {
  if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
    return Math.min(error.retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = Math.random() * policy.baseDelayMs;
  return Math.round(capped + jitter);
}
