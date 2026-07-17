import {
  buildPdfFileName,
  JurisprudenceDocument,
} from '../core/domain/JurisprudenceDocument';
import { IFileStorage } from '../core/ports/IFileStorage';
import { ILogger } from '../core/ports/ILogger';
import { RetryPolicy, withRetry } from '../shared/retry';
import { OefaClient } from './OefaClient';

/**
 * Orquesta la descarga de un PDF aplicando:
 *  - Reanudación: omite el archivo si ya existe en disco.
 *  - Reintentos con backoff exponencial (delegado en `withRetry`), pensado
 *    para el error 429 pero válido para fallos transitorios de red.
 *  - Registro del fallo (si se agotan los intentos) para reintentar después,
 *    continuando con el siguiente documento sin abortar el proceso.
 *
 * Responsabilidad única: la política de descarga de UN documento.
 */
export class PdfDownloader {
  constructor(
    private readonly client: OefaClient,
    private readonly storage: IFileStorage,
    private readonly retryPolicy: RetryPolicy,
    private readonly logger: ILogger,
  ) {}

  /**
   * Descarga el PDF del documento. Devuelve `'downloaded'`, `'skipped'` (ya
   * existía) o `'failed'` (se registró el fallo). Nunca lanza: el proceso
   * global debe poder continuar con el siguiente documento.
   */
  async download(doc: JurisprudenceDocument): Promise<'downloaded' | 'skipped' | 'failed'> {
    const fileName = buildPdfFileName(doc);

    if (await this.storage.exists(fileName)) {
      this.logger.debug(`PDF ya existente, se omite: ${fileName}`);
      return 'skipped';
    }

    let attempts = 0;
    try {
      const buffer = await withRetry(
        async (attempt) => {
          attempts = attempt;
          return this.client.downloadPdf(doc);
        },
        this.retryPolicy,
        this.logger,
        `descarga PDF ${doc.resolutionNumber || doc.pdfUuid}`,
      );

      const savedPath = await this.storage.savePdf(fileName, buffer);
      this.logger.info(`PDF descargado (${formatBytes(buffer.length)}): ${fileName}`, {
        path: savedPath,
      });
      return 'downloaded';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Descarga fallida definitivamente: ${doc.pdfUuid}`, { reason });
      await this.storage.recordFailure({
        pdfUuid: doc.pdfUuid,
        fileNumber: doc.fileNumber,
        resolutionNumber: doc.resolutionNumber,
        downloadComponentId: doc.downloadComponentId,
        reason,
        attempts,
        failedAt: new Date().toISOString(),
      });
      return 'failed';
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
