import { JurisprudenceDocument } from '../domain/JurisprudenceDocument';

/**
 * Puerto de persistencia de los metadatos extraídos. La implementación decide
 * el formato (JSON, CSV, base de datos…). El scraper solo conoce este contrato.
 */
export interface IDocumentRepository {
  /** Añade documentos al almacén de resultados. */
  saveAll(documents: JurisprudenceDocument[]): Promise<void>;
  /** Persiste definitivamente lo acumulado (flush). */
  flush(): Promise<void>;
}
