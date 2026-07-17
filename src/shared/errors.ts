/**
 * Errores de dominio del scraper. Tipar los errores permite reaccionar de forma
 * específica (p. ej. aplicar backoff solo ante rate limiting).
 */

/** Se lanza cuando el servidor responde 429 (Too Many Requests). */
export class RateLimitError extends Error {
  constructor(
    message: string,
    /** Valor de la cabecera Retry-After en segundos, si el servidor la envía. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** Se lanza cuando no se pudo extraer el ViewState/sesión JSF. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/** Se lanza cuando la respuesta no es un PDF válido. */
export class InvalidPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPdfError';
  }
}
