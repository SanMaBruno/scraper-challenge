import * as fs from 'fs/promises';
import * as path from 'path';
import { JurisprudenceDocument } from '../../core/domain/JurisprudenceDocument';
import { IDocumentRepository } from '../../core/ports/IDocumentRepository';

/**
 * Repositorio que persiste los metadatos extraídos como un único archivo JSON.
 * Acumula en memoria y escribe en cada `flush()` (llamado periódicamente y al
 * final), de modo que un corte no pierda todo lo avanzado.
 */
export class JsonDocumentRepository implements IDocumentRepository {
  private readonly documents: JurisprudenceDocument[] = [];

  constructor(private readonly filePath: string) {}

  async saveAll(documents: JurisprudenceDocument[]): Promise<void> {
    this.documents.push(...documents);
  }

  async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = {
      extractedAt: new Date().toISOString(),
      total: this.documents.length,
      documents: this.documents,
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
