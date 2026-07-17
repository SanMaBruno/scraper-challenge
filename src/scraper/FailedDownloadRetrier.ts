import { ScraperConfig } from '../config/config';
import { FailedDownload, IFileStorage } from '../core/ports/IFileStorage';
import { ILogger } from '../core/ports/ILogger';
import { sleep } from '../shared/sleep';
import { OefaClient } from './OefaClient';
import { PdfDownloader } from './PdfDownloader';

/**
 * Caso de uso del modo `--retry-failed`: consume la cola de descargas fallidas
 * (`failed-downloads.jsonl`) y las reintenta en una sesión nueva.
 *
 * Detalle importante: el `downloadComponentId` registrado pertenece a la sesión
 * en la que falló y NO es reutilizable (JSF resuelve el componente contra la
 * vista actual). Por eso el retrier navega hasta la página donde vive la fila
 * (el índice global está codificado en el id, p. ej. `dt:57:` → registro 57 →
 * página 6) y re-localiza el documento por su `pdfUuid` en los datos frescos.
 *
 * El ciclo se auto-limpia: la cola se vacía antes de reintentar y los que
 * vuelvan a fallar se re-registran solos (lo hace `PdfDownloader`).
 */
export class FailedDownloadRetrier {
  constructor(
    private readonly client: OefaClient,
    private readonly downloader: PdfDownloader,
    private readonly storage: IFileStorage,
    private readonly config: ScraperConfig,
    private readonly logger: ILogger,
  ) {}

  async run(): Promise<void> {
    const failures = this.dedupeByUuid(await this.storage.loadFailures());
    if (failures.length === 0) {
      this.logger.info('No hay descargas fallidas pendientes. Nada que reintentar.');
      return;
    }

    this.logger.info(`Reintentando ${failures.length} descarga(s) fallida(s)…`);
    await this.storage.clearFailures();

    await this.client.initSession();
    await this.client.search();

    // Agrupar por página minimiza la navegación: una petición por página, no por documento.
    const byPage = this.groupByPage(failures);
    let recovered = 0;

    for (const [firstRecord, pageFailures] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      await sleep(this.config.requestDelayMs);
      const page = await this.client.fetchPage(firstRecord);

      for (const failure of pageFailures) {
        const doc = page.documents.find((d) => d.pdfUuid === failure.pdfUuid);
        if (!doc) {
          this.logger.warn(`No se encontró el uuid ${failure.pdfUuid} en su página; se re-registra.`);
          await this.storage.recordFailure({ ...failure, reason: 'No hallado al reintentar' });
          continue;
        }
        await sleep(this.config.requestDelayMs);
        if ((await this.downloader.download(doc)) === 'downloaded') recovered++;
      }
    }

    this.logger.info(`Reintento finalizado: ${recovered}/${failures.length} recuperada(s).`);
  }

  /** Índice global de la fila codificado en el componentId (`…:dt:57:j_idt63` → 57). */
  private rowIndexOf(failure: FailedDownload): number {
    const match = failure.downloadComponentId.match(/:dt:(\d+):/);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  private groupByPage(failures: FailedDownload[]): Map<number, FailedDownload[]> {
    const byPage = new Map<number, FailedDownload[]>();
    for (const failure of failures) {
      const first =
        Math.floor(this.rowIndexOf(failure) / this.config.pageSize) * this.config.pageSize;
      byPage.set(first, [...(byPage.get(first) ?? []), failure]);
    }
    return byPage;
  }

  private dedupeByUuid(failures: FailedDownload[]): FailedDownload[] {
    const seen = new Map<string, FailedDownload>();
    for (const failure of failures) seen.set(failure.pdfUuid, failure);
    return [...seen.values()];
  }
}
