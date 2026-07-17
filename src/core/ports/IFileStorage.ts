/**
 * Puerto de almacenamiento de archivos binarios (PDFs) y de registro de
 * descargas fallidas. Aísla al scraper del sistema de archivos concreto.
 */
export interface IFileStorage {
  /** Devuelve true si ya existe un archivo con ese nombre (para reanudar). */
  exists(fileName: string): Promise<boolean>;
  /** Guarda el contenido binario del PDF. Devuelve la ruta absoluta. */
  savePdf(fileName: string, content: Buffer): Promise<string>;
  /** Registra una descarga fallida para poder reintentarla luego. */
  recordFailure(failure: FailedDownload): Promise<void>;
  /** Lee las descargas fallidas registradas (para el modo --retry-failed). */
  loadFailures(): Promise<FailedDownload[]>;
  /**
   * Vacía el registro de fallos. Se llama antes de reintentarlos: los que
   * vuelvan a fallar se re-registran, y los que tengan éxito salen del ciclo.
   */
  clearFailures(): Promise<void>;
}

export interface FailedDownload {
  readonly pdfUuid: string;
  readonly fileNumber: string;
  readonly resolutionNumber: string;
  readonly downloadComponentId: string;
  readonly reason: string;
  readonly attempts: number;
  readonly failedAt: string;
}
