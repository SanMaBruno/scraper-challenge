import * as fs from 'fs/promises';
import * as path from 'path';
import { JurisprudenceDocument } from '../../core/domain/JurisprudenceDocument';
import { IDocumentRepository } from '../../core/ports/IDocumentRepository';

/**
 * Segunda implementación de `IDocumentRepository`, esta vez a CSV.
 *
 * Su mera existencia ilustra el principio Abierto/Cerrado: añadir un formato de
 * salida nuevo NO obligó a modificar el scraper ni ninguna otra clase; basta con
 * inyectar este adaptador en su lugar (o junto al JSON) desde `main.ts`.
 */
export class CsvDocumentRepository implements IDocumentRepository {
  private static readonly COLUMNS: Array<keyof JurisprudenceDocument> = [
    'rowNumber',
    'fileNumber',
    'administered',
    'inspectableUnit',
    'sector',
    'resolutionNumber',
    'pdfUuid',
    'downloadComponentId',
  ];

  private readonly documents: JurisprudenceDocument[] = [];

  constructor(private readonly filePath: string) {}

  async saveAll(documents: JurisprudenceDocument[]): Promise<void> {
    this.documents.push(...documents);
  }

  async flush(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const header = CsvDocumentRepository.COLUMNS.join(',');
    const rows = this.documents.map((doc) =>
      CsvDocumentRepository.COLUMNS.map((col) => this.escape(doc[col])).join(','),
    );
    await fs.writeFile(this.filePath, [header, ...rows].join('\n'), 'utf-8');
  }

  /** Escapa un valor según RFC 4180 (comillas si contiene , " o salto de línea). */
  private escape(value: unknown): string {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
}
