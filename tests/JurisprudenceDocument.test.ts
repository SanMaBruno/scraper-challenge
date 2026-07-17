import {
  buildPdfFileName,
  JurisprudenceDocument,
} from '../src/core/domain/JurisprudenceDocument';

const baseDoc: JurisprudenceDocument = {
  rowNumber: 1,
  fileNumber: '891-08-PRODUCE/DIGSECOVI-Dsvs',
  administered: 'Corporación del Mar S.A.',
  inspectableUnit: 'Planta Playa Lado Norte',
  sector: 'Pesquería',
  resolutionNumber: '264-2012-OEFA/TFA',
  pdfUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
  downloadComponentId: 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
};

describe('buildPdfFileName', () => {
  it('genera un nombre descriptivo con resolución, expediente y uuid', () => {
    const name = buildPdfFileName(baseDoc);
    expect(name).toBe(
      '264-2012-OEFA-TFA__891-08-PRODUCE-DIGSECOVI-Dsvs__153a6d2a-cbed-40ef-b8ef-cd2272b19867.pdf',
    );
  });

  it('elimina acentos y caracteres inválidos para el sistema de archivos', () => {
    const name = buildPdfFileName({ ...baseDoc, resolutionNumber: 'Resolución Ñandú/2020' });
    expect(name).not.toMatch(/[óÑ/]/);
    expect(name).toContain('Resolucion-Nandu-2020');
  });

  it('usa marcadores cuando faltan datos, sin romperse', () => {
    const name = buildPdfFileName({ ...baseDoc, resolutionNumber: '', fileNumber: '' });
    expect(name).toBe('sin-resolucion__sin-expediente__153a6d2a-cbed-40ef-b8ef-cd2272b19867.pdf');
  });

  it('siempre produce un nombre .pdf único por uuid', () => {
    const a = buildPdfFileName(baseDoc);
    const b = buildPdfFileName({ ...baseDoc, pdfUuid: 'otro-uuid' });
    expect(a).not.toBe(b);
    expect(a.endsWith('.pdf')).toBe(true);
  });
});
