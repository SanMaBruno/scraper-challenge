import { JurisprudenceDocument } from '../../core/domain/JurisprudenceDocument';
import { IDocumentRepository } from '../../core/ports/IDocumentRepository';

/**
 * Combina varios repositorios y les reenvía cada operación. Permite persistir
 * los metadatos en JSON y CSV a la vez sin que el scraper sepa nada de ello
 * (patrón Composite + principio Abierto/Cerrado).
 */
export class CompositeDocumentRepository implements IDocumentRepository {
  constructor(private readonly repositories: IDocumentRepository[]) {}

  async saveAll(documents: JurisprudenceDocument[]): Promise<void> {
    await Promise.all(this.repositories.map((repo) => repo.saveAll(documents)));
  }

  async flush(): Promise<void> {
    await Promise.all(this.repositories.map((repo) => repo.flush()));
  }
}
