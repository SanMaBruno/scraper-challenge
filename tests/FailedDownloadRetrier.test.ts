import { ScraperConfig } from '../src/config/config';
import { JurisprudenceDocument } from '../src/core/domain/JurisprudenceDocument';
import { FailedDownload, IFileStorage } from '../src/core/ports/IFileStorage';
import { ILogger } from '../src/core/ports/ILogger';
import { FailedDownloadRetrier } from '../src/scraper/FailedDownloadRetrier';
import { OefaClient } from '../src/scraper/OefaClient';
import { PdfDownloader } from '../src/scraper/PdfDownloader';

/**
 * Verifica la lógica del modo --retry-failed sin red: que agrupe por página,
 * que re-localice los documentos por uuid con datos frescos (no con el
 * componentId viejo) y que limpie la cola antes de reintentar.
 */

const silentLogger: ILogger = { info() {}, warn() {}, error() {}, debug() {} };

const config = {
  pageSize: 10,
  requestDelayMs: 0,
} as ScraperConfig;

function makeDoc(uuid: string, rowIndex: number): JurisprudenceDocument {
  return {
    rowNumber: rowIndex + 1,
    fileNumber: `exp-${rowIndex}`,
    administered: 'Empresa',
    inspectableUnit: 'Planta',
    sector: 'Minería',
    resolutionNumber: `res-${rowIndex}`,
    pdfUuid: uuid,
    downloadComponentId: `form:dt:${rowIndex}:j_idt63`,
  };
}

function makeFailure(uuid: string, rowIndex: number): FailedDownload {
  return {
    pdfUuid: uuid,
    fileNumber: `exp-${rowIndex}`,
    resolutionNumber: `res-${rowIndex}`,
    downloadComponentId: `form:dt:${rowIndex}:j_idt63`,
    reason: 'HTTP 429',
    attempts: 5,
    failedAt: new Date().toISOString(),
  };
}

class StorageStub implements IFileStorage {
  constructor(public pending: FailedDownload[]) {}
  cleared = false;
  reRecorded: FailedDownload[] = [];

  async exists(): Promise<boolean> {
    return false;
  }
  async savePdf(): Promise<string> {
    return '/tmp/x.pdf';
  }
  async recordFailure(failure: FailedDownload): Promise<void> {
    this.reRecorded.push(failure);
  }
  async loadFailures(): Promise<FailedDownload[]> {
    return this.pending;
  }
  async clearFailures(): Promise<void> {
    this.cleared = true;
  }
}

describe('FailedDownloadRetrier', () => {
  it('no hace nada si la cola está vacía', async () => {
    const storage = new StorageStub([]);
    const client = { initSession: jest.fn(), search: jest.fn(), fetchPage: jest.fn() };
    const downloader = { download: jest.fn() };

    const retrier = new FailedDownloadRetrier(
      client as unknown as OefaClient,
      downloader as unknown as PdfDownloader,
      storage,
      config,
      silentLogger,
    );
    await retrier.run();

    expect(client.initSession).not.toHaveBeenCalled();
    expect(storage.cleared).toBe(false);
  });

  it('agrupa por página, re-localiza por uuid y descarga con datos frescos', async () => {
    // Dos fallos en la página 2 (filas 10 y 12) y uno en la página 6 (fila 57).
    const storage = new StorageStub([
      makeFailure('uuid-10', 10),
      makeFailure('uuid-12', 12),
      makeFailure('uuid-57', 57),
    ]);

    const fetchPage = jest.fn(async (first: number) => ({
      documents: [makeDoc('uuid-10', 10), makeDoc('uuid-12', 12), makeDoc('uuid-57', 57)].filter(
        (d) => d.rowNumber - 1 >= first && d.rowNumber - 1 < first + config.pageSize,
      ),
      totalRecords: 1753,
    }));
    const client = { initSession: jest.fn(), search: jest.fn(), fetchPage };
    const download = jest.fn().mockResolvedValue('downloaded');

    const retrier = new FailedDownloadRetrier(
      client as unknown as OefaClient,
      { download } as unknown as PdfDownloader,
      storage,
      config,
      silentLogger,
    );
    await retrier.run();

    expect(storage.cleared).toBe(true); // la cola se vació antes de reintentar
    // Solo 2 páginas navegadas (10 y 12 comparten la página que empieza en 10).
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([10, 50]);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('re-registra el fallo si el uuid ya no aparece en su página', async () => {
    const storage = new StorageStub([makeFailure('uuid-desaparecido', 10)]);
    const client = {
      initSession: jest.fn(),
      search: jest.fn(),
      fetchPage: jest.fn().mockResolvedValue({ documents: [], totalRecords: 0 }),
    };
    const download = jest.fn();

    const retrier = new FailedDownloadRetrier(
      client as unknown as OefaClient,
      { download } as unknown as PdfDownloader,
      storage,
      config,
      silentLogger,
    );
    await retrier.run();

    expect(download).not.toHaveBeenCalled();
    expect(storage.reRecorded).toHaveLength(1);
    expect(storage.reRecorded[0].reason).toBe('No hallado al reintentar');
  });
});
