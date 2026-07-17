import * as path from 'path';
import { RetryPolicy } from '../shared/retry';

/** Formatos de salida disponibles para los metadatos extraídos. */
export type OutputFormat = 'json' | 'csv' | 'both';

/**
 * Configuración central del scraper. Los valores por defecto apuntan al sitio
 * alternativo de OEFA (accesible sin VPN). Pueden sobreescribirse por variables
 * de entorno o argumentos de línea de comandos.
 */
export interface ScraperConfig {
  readonly baseUrl: string;
  readonly resultPath: string;
  readonly outputDir: string;
  readonly pdfDir: string;
  /** Milisegundos de espera entre requests para no sobrecargar el servidor. */
  readonly requestDelayMs: number;
  /** Nº máximo de páginas a recorrer (0 = todas). */
  readonly maxPages: number;
  /** Nº máximo de PDFs a descargar (0 = todos). Útil para pruebas. */
  readonly maxPdfs: number;
  /** Nº de registros por página que devuelve la grilla. */
  readonly pageSize: number;
  readonly retry: RetryPolicy;
  readonly userAgent: string;
  /** Formato(s) en que se persisten los metadatos. */
  readonly outputFormat: OutputFormat;
}

/** Lee un entero de las variables de entorno con valor por defecto. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Lee un flag `--clave=valor` de los argumentos de proceso. */
function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function intFrom(argName: string, envName: string, fallback: number): number {
  const fromArg = argValue(argName);
  if (fromArg !== undefined) {
    const parsed = Number.parseInt(fromArg, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return envInt(envName, fallback);
}

/** Normaliza el formato de salida elegido (flag `--format=` o env). */
function resolveOutputFormat(): OutputFormat {
  const raw = (argValue('format') ?? process.env.OUTPUT_FORMAT ?? 'json').toLowerCase();
  return raw === 'csv' || raw === 'both' ? raw : 'json';
}

export function loadConfig(): ScraperConfig {
  const outputDir = process.env.OUTPUT_DIR ?? path.resolve(process.cwd(), 'data');

  return {
    baseUrl: process.env.BASE_URL ?? 'https://publico.oefa.gob.pe',
    resultPath: process.env.RESULT_PATH ?? '/repdig/consulta/consultaTfa.xhtml',
    outputDir,
    pdfDir: path.join(outputDir, 'pdfs'),
    requestDelayMs: intFrom('delay', 'REQUEST_DELAY_MS', 1500),
    maxPages: intFrom('max-pages', 'MAX_PAGES', 0),
    maxPdfs: intFrom('max-pdfs', 'MAX_PDFS', 0),
    pageSize: envInt('PAGE_SIZE', 10),
    outputFormat: resolveOutputFormat(),
    userAgent:
      process.env.USER_AGENT ??
      'Mozilla/5.0 (compatible; OefaScraperChallenge/1.0; +https://github.com/)',
    retry: {
      maxAttempts: envInt('RETRY_MAX_ATTEMPTS', 5),
      baseDelayMs: envInt('RETRY_BASE_DELAY_MS', 2000),
      maxDelayMs: envInt('RETRY_MAX_DELAY_MS', 60000),
    },
  };
}
