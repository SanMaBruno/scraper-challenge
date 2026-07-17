import { ScraperConfig } from '../config/config';
import { JurisprudenceDocument } from '../core/domain/JurisprudenceDocument';
import { IDocumentRepository } from '../core/ports/IDocumentRepository';
import { ILogger } from '../core/ports/ILogger';
import { withRetry } from '../shared/retry';
import { sleep } from '../shared/sleep';
import { OefaClient, PageData } from './OefaClient';
import { PdfDownloader } from './PdfDownloader';

interface RunSummary {
  pagesVisited: number;
  documentsExtracted: number;
  pdfsDownloaded: number;
  pdfsSkipped: number;
  pdfsFailed: number;
}

/**
 * Caso de uso principal (orquestador). Coordina la navegación por todas las
 * páginas, la extracción de metadatos, su persistencia y la descarga de PDFs.
 *
 * Depende solo de abstracciones (cliente, repositorio, descargador, logger),
 * por lo que es agnóstico a HTTP, cheerio y al sistema de archivos concreto.
 */
export class OefaScraper {
  constructor(
    private readonly client: OefaClient,
    private readonly downloader: PdfDownloader,
    private readonly repository: IDocumentRepository,
    private readonly config: ScraperConfig,
    private readonly logger: ILogger,
  ) {}

  async run(): Promise<RunSummary> {
    const summary: RunSummary = {
      pagesVisited: 0,
      documentsExtracted: 0,
      pdfsDownloaded: 0,
      pdfsSkipped: 0,
      pdfsFailed: 0,
    };

    this.logger.info('Iniciando sesión con el sitio de OEFA…');
    await this.withNetworkRetry('sesión inicial', () => this.client.initSession());

    this.logger.info('Ejecutando búsqueda de resoluciones…');
    let page = await this.withNetworkRetry('búsqueda', () => this.client.search());

    const totalRecords = page.totalRecords ?? 0;
    const totalPages = this.computeTotalPages(totalRecords);
    const pagesToVisit = this.config.maxPages > 0
      ? Math.min(this.config.maxPages, totalPages)
      : totalPages;

    this.logger.info(
      `Se encontraron ${totalRecords} registros (${totalPages} páginas). ` +
        `Se recorrerán ${pagesToVisit}.`,
    );

    for (let pageIndex = 0; pageIndex < pagesToVisit; pageIndex++) {
      if (pageIndex > 0) {
        await sleep(this.config.requestDelayMs);
        const firstRecord = pageIndex * this.config.pageSize;
        page = await this.withNetworkRetry(`página ${pageIndex + 1}`, () =>
          this.client.fetchPage(firstRecord),
        );
      }

      summary.pagesVisited++;
      await this.processPage(page, pageIndex + 1, pagesToVisit, summary);

      // Persistimos incrementalmente para no perder el avance ante un corte.
      await this.repository.flush();
    }

    await this.repository.flush();
    this.logSummary(summary);
    return summary;
  }

  /** Procesa una página: guarda metadatos y descarga sus PDFs. */
  private async processPage(
    page: PageData,
    pageNumber: number,
    totalPages: number,
    summary: RunSummary,
  ): Promise<void> {
    const docs = page.documents;
    this.logger.info(`Página ${pageNumber}/${totalPages}: ${docs.length} documentos.`);

    await this.repository.saveAll(docs);
    summary.documentsExtracted += docs.length;

    for (const doc of docs) {
      if (this.reachedPdfLimit(summary)) {
        this.logger.info(`Alcanzado el límite de ${this.config.maxPdfs} PDFs. Deteniendo descargas.`);
        return;
      }
      await sleep(this.config.requestDelayMs);
      const result = await this.downloader.download(doc);
      this.tally(summary, result);
    }
  }

  private tally(summary: RunSummary, result: 'downloaded' | 'skipped' | 'failed'): void {
    if (result === 'downloaded') summary.pdfsDownloaded++;
    else if (result === 'skipped') summary.pdfsSkipped++;
    else summary.pdfsFailed++;
  }

  private reachedPdfLimit(summary: RunSummary): boolean {
    const done = summary.pdfsDownloaded + summary.pdfsSkipped;
    return this.config.maxPdfs > 0 && done >= this.config.maxPdfs;
  }

  private computeTotalPages(totalRecords: number): number {
    return Math.max(1, Math.ceil(totalRecords / this.config.pageSize));
  }

  /**
   * Reintenta operaciones de navegación (no descarga) ante fallos transitorios
   * y 429, reutilizando la política global de backoff.
   */
  private withNetworkRetry<T>(name: string, op: () => Promise<T>): Promise<T> {
    return withRetry(() => op(), this.config.retry, this.logger, name);
  }

  private logSummary(s: RunSummary): void {
    this.logger.info('──────── Resumen de la ejecución ────────');
    this.logger.info(`Páginas visitadas:     ${s.pagesVisited}`);
    this.logger.info(`Documentos extraídos:  ${s.documentsExtracted}`);
    this.logger.info(`PDFs descargados:      ${s.pdfsDownloaded}`);
    this.logger.info(`PDFs ya existentes:    ${s.pdfsSkipped}`);
    this.logger.info(`PDFs fallidos:         ${s.pdfsFailed}`);
    this.logger.info('─────────────────────────────────────────');
  }
}
