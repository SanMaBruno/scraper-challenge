import * as fs from 'fs';
import * as path from 'path';
import { OefaParser } from '../src/scraper/OefaParser';

/**
 * Los tests del parser usan respuestas REALES capturadas del sitio de OEFA
 * (carpeta `fixtures/`), de modo que si el sitio cambia su HTML lo detectemos
 * aquí y no en producción. El parser no toca la red, así que es 100% testeable.
 */
const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');

describe('OefaParser', () => {
  const parser = new OefaParser();

  describe('extractViewState', () => {
    it('lo extrae de la página HTML inicial (input hidden)', () => {
      const viewState = parser.extractViewState(fixture('initial-page.html'));
      expect(viewState).toBeTruthy();
      expect(viewState!.length).toBeGreaterThan(20);
    });

    it('lo extrae de una respuesta parcial AJAX (CDATA)', () => {
      const viewState = parser.extractViewState(fixture('search-response.xml'));
      expect(viewState).toBeTruthy();
    });

    it('devuelve null si no hay ViewState', () => {
      expect(parser.extractViewState('<html><body>nada</body></html>')).toBeNull();
    });
  });

  describe('extractJessionId', () => {
    it('lo obtiene del action del formulario', () => {
      const jsessionid = parser.extractJsessionId(fixture('initial-page.html'));
      expect(jsessionid).toMatch(/^[A-F0-9]+$/i);
    });
  });

  describe('extractTotalRecords', () => {
    it('lee el rowCount del paginador en la búsqueda', () => {
      expect(parser.extractTotalRecords(fixture('search-response.xml'))).toBe(1753);
    });
  });

  describe('parseRows', () => {
    it('extrae las 10 filas de la primera página (grilla completa)', () => {
      const docs = parser.parseRows(fixture('search-response.xml'));
      expect(docs).toHaveLength(10);
    });

    it('extrae las filas de la paginación (que vienen sin <tbody>)', () => {
      // Regresión: la primera versión sacaba 0 aquí porque la paginación
      // devuelve <tr> sueltos, no una grilla completa.
      const docs = parser.parseRows(fixture('pagination-response.xml'));
      expect(docs).toHaveLength(10);
      expect(docs[0].rowNumber).toBe(11); // la página 2 arranca en el registro 11
    });

    it('mapea correctamente todos los campos de un documento', () => {
      const [first] = parser.parseRows(fixture('search-response.xml'));
      expect(first).toMatchObject({
        rowNumber: 1,
        fileNumber: expect.stringContaining('PRODUCE'),
        sector: expect.any(String),
        pdfUuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
        downloadComponentId: expect.stringContaining(':dt:0:'),
      });
      expect(first.administered.length).toBeGreaterThan(0);
    });

    it('devuelve [] cuando no hay filas', () => {
      expect(parser.parseRows('<partial-response></partial-response>')).toEqual([]);
    });
  });
});
