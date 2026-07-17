import { JurisprudenceDocument } from '../src/core/domain/JurisprudenceDocument';
import { FailedDownload, IFileStorage } from '../src/core/ports/IFileStorage';
import { ILogger } from '../src/core/ports/ILogger';
import { RateLimitError } from '../src/shared/errors';
import { RetryPolicy } from '../src/shared/retry';
import { OefaClient } from '../src/scraper/OefaClient';
import { PdfDownloader } from '../src/scraper/PdfDownloader';

/**
 * Estos tests demuestran la Inversión de Dependencias en acción: sustituimos el
 * cliente HTTP real y el sistema de archivos por dobles de prueba, y verificamos
 * la política de descarga (reanudación, reintentos ante 429, registro de fallos)
 * sin tocar la red ni el disco.
 */

const doc: JurisprudenceDocument = {
  rowNumber: 1,
  fileNumber: '891-08',
  administered: 'Empresa X',
  inspectableUnit: 'Planta X',
  sector: 'Pesquería',
  resolutionNumber: '264-2012-OEFA/TFA',
  pdfUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
  downloadComponentId: 'form:dt:0:j_idt63',
};

const noRetries: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 };

const silentLogger: ILogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Doble de IFileStorage en memoria que registra lo que ocurre. */
class InMemoryStorage implements IFileStorage {
  saved = new Map<string, Buffer>();
  failures: FailedDownload[] = [];
  existing = new Set<string>();

  async exists(fileName: string): Promise<boolean> {
    return this.existing.has(fileName);
  }
  async savePdf(fileName: string, content: Buffer): Promise<string> {
    this.saved.set(fileName, content);
    return `/tmp/${fileName}`;
  }
  async recordFailure(failure: FailedDownload): Promise<void> {
    this.failures.push(failure);
  }
  async loadFailures(): Promise<FailedDownload[]> {
    return [...this.failures];
  }
  async clearFailures(): Promise<void> {
    this.failures = [];
  }
}

/** Crea un OefaClient con solo `downloadPdf` mockeado. */
function clientWithDownload(impl: jest.Mock): OefaClient {
  return { downloadPdf: impl } as unknown as OefaClient;
}

describe('PdfDownloader', () => {
  it('descarga y guarda el PDF en el caso feliz', async () => {
    const storage = new InMemoryStorage();
    const download = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 contenido'));
    const downloader = new PdfDownloader(
      clientWithDownload(download),
      storage,
      noRetries,
      silentLogger,
    );

    const result = await downloader.download(doc);

    expect(result).toBe('downloaded');
    expect(storage.saved.size).toBe(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('omite la descarga si el PDF ya existe (reanudable)', async () => {
    const storage = new InMemoryStorage();
    storage.existing.add(
      '264-2012-OEFA-TFA__891-08__153a6d2a-cbed-40ef-b8ef-cd2272b19867.pdf',
    );
    const download = jest.fn();
    const downloader = new PdfDownloader(
      clientWithDownload(download),
      storage,
      noRetries,
      silentLogger,
    );

    const result = await downloader.download(doc);

    expect(result).toBe('skipped');
    expect(download).not.toHaveBeenCalled();
  });

  it('reintenta ante un 429 y termina descargando', async () => {
    const storage = new InMemoryStorage();
    const download = jest
      .fn()
      .mockRejectedValueOnce(new RateLimitError('429', 0))
      .mockResolvedValue(Buffer.from('%PDF-1.4'));
    const downloader = new PdfDownloader(
      clientWithDownload(download),
      storage,
      noRetries,
      silentLogger,
    );

    const result = await downloader.download(doc);

    expect(result).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('registra el fallo y NO lanza cuando se agotan los reintentos', async () => {
    const storage = new InMemoryStorage();
    const download = jest.fn().mockRejectedValue(new RateLimitError('429', 0));
    const downloader = new PdfDownloader(
      clientWithDownload(download),
      storage,
      noRetries,
      silentLogger,
    );

    const result = await downloader.download(doc);

    expect(result).toBe('failed'); // no relanza: el scraper puede continuar
    expect(storage.saved.size).toBe(0);
    expect(storage.failures).toHaveLength(1);
    expect(storage.failures[0]).toMatchObject({
      pdfUuid: doc.pdfUuid,
      attempts: noRetries.maxAttempts,
    });
  });
});
