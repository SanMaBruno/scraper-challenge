/**
 * Puerto de cliente HTTP. Abstrae la librería concreta (axios) del resto de la
 * aplicación, de modo que el scraper dependa de esta interfaz y no de axios
 * directamente (Inversión de Dependencias).
 */

export interface HttpResponse<T = string> {
  readonly status: number;
  readonly data: T;
  readonly headers: Record<string, string>;
}

export interface HttpRequestOptions {
  /** Cabeceras adicionales. */
  headers?: Record<string, string>;
  /** Cuerpo del POST ya codificado (application/x-www-form-urlencoded). */
  body?: string;
  /** Tipo de respuesta esperada. */
  responseType?: 'text' | 'arraybuffer';
}

export interface IHttpClient {
  get<T = string>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
  post<T = string>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}
