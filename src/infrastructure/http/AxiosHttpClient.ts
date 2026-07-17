import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
} from '../../core/ports/IHttpClient';
import { RateLimitError } from '../../shared/errors';

/**
 * Implementación de `IHttpClient` basada en axios.
 *
 * Responsabilidades:
 *  - Mantener una sesión con cookies (jsessionid de JSF) mediante un
 *    almacén de cookies propio y sencillo.
 *  - Traducir el HTTP 429 en un `RateLimitError` tipado (extrayendo
 *    `Retry-After`), delegando la política de reintentos a la capa superior.
 *
 * No conoce nada del dominio OEFA: solo transporta bytes.
 */
export class AxiosHttpClient implements IHttpClient {
  private readonly client: AxiosInstance;
  private readonly cookies = new Map<string, string>();

  constructor(userAgent: string) {
    this.client = axios.create({
      timeout: 120_000,
      maxRedirects: 5,
      // No lanzar por códigos != 2xx: los gestionamos manualmente para poder
      // distinguir el 429 del resto.
      validateStatus: () => true,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml,*/*',
        'Accept-Language': 'es-PE,es;q=0.9',
      },
    });
  }

  async get<T = string>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    const response = await this.client.request({
      url,
      method: 'GET',
      headers: this.buildHeaders(options),
      responseType: options?.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    });
    return this.handle<T>(response);
  }

  async post<T = string>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    const response = await this.client.request({
      url,
      method: 'POST',
      data: options?.body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...this.buildHeaders(options),
      },
      responseType: options?.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    });
    return this.handle<T>(response);
  }

  /** Añade las cookies acumuladas a las cabeceras de la petición. */
  private buildHeaders(options?: HttpRequestOptions): Record<string, string> {
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };
    if (this.cookies.size > 0) {
      headers['Cookie'] = [...this.cookies.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
    return headers;
  }

  /** Procesa la respuesta: guarda cookies, detecta 429 y normaliza. */
  private handle<T>(response: AxiosResponse): HttpResponse<T> {
    this.storeCookies(response);

    if (response.status === 429) {
      const retryAfter = this.parseRetryAfter(response.headers['retry-after']);
      throw new RateLimitError(`HTTP 429 en ${response.config.url}`, retryAfter);
    }

    return {
      status: response.status,
      data: response.data as T,
      headers: this.normalizeHeaders(response.headers),
    };
  }

  /** Extrae y persiste las cookies de `Set-Cookie` (solo nombre=valor). */
  private storeCookies(response: AxiosResponse): void {
    const setCookie = response.headers['set-cookie'];
    if (!setCookie) return;
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  private parseRetryAfter(value: unknown): number | undefined {
    if (typeof value !== 'string') return undefined;
    const seconds = Number.parseInt(value, 10);
    return Number.isNaN(seconds) ? undefined : seconds;
  }

  private normalizeHeaders(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
        result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      }
    }
    return result;
  }
}
