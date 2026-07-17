import * as path from 'path';
import { loadConfig, ScraperConfig } from './config/config';
import { IDocumentRepository } from './core/ports/IDocumentRepository';
import { AxiosHttpClient } from './infrastructure/http/AxiosHttpClient';
import { ConsoleLogger } from './infrastructure/logging/ConsoleLogger';
import { CompositeDocumentRepository } from './infrastructure/storage/CompositeDocumentRepository';
import { CsvDocumentRepository } from './infrastructure/storage/CsvDocumentRepository';
import { JsonDocumentRepository } from './infrastructure/storage/JsonDocumentRepository';
import { LocalFileStorage } from './infrastructure/storage/LocalFileStorage';
import { FailedDownloadRetrier } from './scraper/FailedDownloadRetrier';
import { JsfState } from './scraper/JsfState';
import { OefaClient } from './scraper/OefaClient';
import { OefaParser } from './scraper/OefaParser';
import { OefaScraper } from './scraper/OefaScraper';
import { PdfDownloader } from './scraper/PdfDownloader';

/**
 * Composition Root: único lugar donde se instancian las clases concretas y se
 * inyectan las dependencias. El resto del código depende de interfaces, lo que
 * mantiene el sistema desacoplado y testeable (Inversión de Dependencias).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger();

  // Infraestructura (adaptadores concretos de los puertos).
  const http = new AxiosHttpClient(config.userAgent);
  const parser = new OefaParser();
  const state = new JsfState();
  const repository = buildRepository(config);
  const storage = new LocalFileStorage(config.pdfDir, config.outputDir);

  // Cliente y casos de uso.
  const client = new OefaClient(http, parser, state, config, logger);
  const downloader = new PdfDownloader(client, storage, config.retry, logger);

  logger.info('Scraper OEFA — Desafío de Scraping');
  logger.info(`Sitio objetivo: ${config.baseUrl}${config.resultPath}`);
  logger.info(`Salida en: ${config.outputDir}`);

  // Modo --retry-failed: solo consume la cola de descargas fallidas y termina.
  if (process.argv.includes('--retry-failed')) {
    const retrier = new FailedDownloadRetrier(client, downloader, storage, config, logger);
    await retrier.run();
    return;
  }

  const scraper = new OefaScraper(client, downloader, repository, config, logger);
  await scraper.run();
}

/**
 * Selecciona la implementación de `IDocumentRepository` según la configuración.
 * Añadir un formato nuevo se resuelve aquí, sin tocar el scraper (Abierto/Cerrado).
 */
function buildRepository(config: ScraperConfig): IDocumentRepository {
  const json = new JsonDocumentRepository(path.join(config.outputDir, 'documents.json'));
  const csv = new CsvDocumentRepository(path.join(config.outputDir, 'documents.csv'));

  switch (config.outputFormat) {
    case 'csv':
      return csv;
    case 'both':
      return new CompositeDocumentRepository([json, csv]);
    case 'json':
    default:
      return json;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Error fatal no controlado:', error);
  process.exit(1);
});
