import * as fs from 'fs/promises';
import * as path from 'path';
import { FailedDownload, IFileStorage } from '../../core/ports/IFileStorage';

/**
 * Almacenamiento de PDFs en el sistema de archivos local y registro de
 * descargas fallidas en un JSON Lines (`failed-downloads.jsonl`), lo que
 * facilita reintentarlas después con otra ejecución.
 */
export class LocalFileStorage implements IFileStorage {
  private readonly failuresPath: string;

  constructor(private readonly pdfDir: string, failuresDir: string) {
    this.failuresPath = path.join(failuresDir, 'failed-downloads.jsonl');
  }

  async exists(fileName: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.pdfDir, fileName));
      return true;
    } catch {
      return false;
    }
  }

  async savePdf(fileName: string, content: Buffer): Promise<string> {
    await fs.mkdir(this.pdfDir, { recursive: true });
    const fullPath = path.join(this.pdfDir, fileName);
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  async recordFailure(failure: FailedDownload): Promise<void> {
    await fs.mkdir(path.dirname(this.failuresPath), { recursive: true });
    await fs.appendFile(this.failuresPath, `${JSON.stringify(failure)}\n`, 'utf-8');
  }

  async loadFailures(): Promise<FailedDownload[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.failuresPath, 'utf-8');
    } catch {
      return []; // sin archivo no hay fallos pendientes
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as FailedDownload);
  }

  async clearFailures(): Promise<void> {
    try {
      await fs.unlink(this.failuresPath);
    } catch {
      // ya no existía: nada que limpiar
    }
  }
}
