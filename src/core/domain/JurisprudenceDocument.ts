/**
 * Entidad de dominio que representa una resolución del Tribunal de
 * Fiscalización Ambiental (TFA) publicada por OEFA.
 *
 * Es un objeto de dominio puro: no conoce HTTP, HTML ni el sistema de
 * archivos. Solo describe QUÉ es un documento, no CÓMO se obtiene.
 */
export interface JurisprudenceDocument {
  /** Número correlativo mostrado en la grilla (informativo). */
  readonly rowNumber: number;
  /** Número de expediente administrativo. */
  readonly fileNumber: string;
  /** Administrado(s) involucrado(s). */
  readonly administered: string;
  /** Unidad fiscalizable. */
  readonly inspectableUnit: string;
  /** Sector económico (Minería, Hidrocarburos, etc.). */
  readonly sector: string;
  /** Número de la resolución de apelación (Nro. Resolución de Apelación). */
  readonly resolutionNumber: string;
  /**
   * Identificador único del PDF asociado en el backend JSF.
   * Es el `param_uuid` requerido para descargar el documento.
   */
  readonly pdfUuid: string;
  /**
   * Identificador del componente/botón JSF que dispara la descarga
   * (p. ej. `listarDetalleInfraccionRAAForm:dt:0:j_idt63`). Se necesita
   * como parámetro del POST de descarga.
   */
  readonly downloadComponentId: string;
}

/**
 * Genera un nombre de archivo descriptivo y seguro para el PDF a partir de
 * los datos del documento, evitando caracteres inválidos en el sistema de
 * archivos.
 */
export function buildPdfFileName(doc: JurisprudenceDocument): string {
  const slug = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 80);

  const resolution = slug(doc.resolutionNumber) || 'sin-resolucion';
  const file = slug(doc.fileNumber) || 'sin-expediente';
  return `${resolution}__${file}__${doc.pdfUuid}.pdf`;
}
