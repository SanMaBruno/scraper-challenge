import * as cheerio from 'cheerio';
import { JurisprudenceDocument } from '../core/domain/JurisprudenceDocument';

/**
 * Responsable ÚNICO de convertir HTML/XML en objetos de dominio usando cheerio.
 * No hace peticiones de red ni conoce la sesión: recibe texto y devuelve datos.
 * Esto lo hace fácilmente testeable con fixtures estáticas.
 */
export class OefaParser {
  /**
   * Extrae el ViewState de una página HTML completa o de una respuesta parcial
   * (`partial-response`) de PrimeFaces.
   */
  extractViewState(body: string): string | null {
    // Respuesta AJAX: <update id="...ViewState:0"><![CDATA[valor]]></update>
    const ajax = body.match(
      /<update id="[^"]*ViewState:0"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/,
    );
    if (ajax) return ajax[1];

    // Página HTML normal: <input ... name="javax.faces.ViewState" value="..." />
    const $ = cheerio.load(body);
    const value = $('input[name="javax.faces.ViewState"]').attr('value');
    return value ?? null;
  }

  /** Extrae el jsessionid del `action` del formulario, si está presente. */
  extractJsessionId(body: string): string | null {
    const match = body.match(/jsessionid=([A-Za-z0-9.]+)/);
    return match ? match[1] : null;
  }

  /** Devuelve el total de registros anunciado por el paginador de la grilla. */
  extractTotalRecords(body: string): number | null {
    const paginator = body.match(/rowCount:(\d+)/);
    if (paginator) return Number.parseInt(paginator[1], 10);
    const legible = body.match(/\((\d+)\s+registros\)/);
    return legible ? Number.parseInt(legible[1], 10) : null;
  }

  /**
   * Extrae las filas de la grilla de resultados a partir del cuerpo (HTML o
   * el CDATA de una respuesta parcial). Devuelve documentos de dominio.
   */
  parseRows(body: string): JurisprudenceDocument[] {
    const html = this.unwrapPartialResponse(body);
    // La búsqueda inicial devuelve la grilla completa; la paginación devuelve
    // solo filas `<tr data-ri>` sueltas. Envolvemos en una tabla para que
    // cheerio conserve las filas en ambos casos.
    const $ = cheerio.load(`<table><tbody>${html}</tbody></table>`);
    const documents: JurisprudenceDocument[] = [];

    $('tr[data-ri]').each((_, tr) => {
      const cells = $(tr).find('> td');
      if (cells.length < 6) return;

      const text = (i: number): string => $(cells[i]).text().replace(/\s+/g, ' ').trim();

      const link = $(tr).find('a[onclick]');
      const onclick = link.attr('onclick') ?? '';
      const pdfUuid = this.extractOnclickParam(onclick, 'param_uuid');
      const downloadComponentId = this.extractDownloadComponentId(onclick);

      // Sin uuid no hay PDF descargable: se omite la fila.
      if (!pdfUuid || !downloadComponentId) return;

      documents.push({
        rowNumber: Number.parseInt(text(0), 10) || 0,
        fileNumber: text(1),
        administered: text(2),
        inspectableUnit: text(3),
        sector: text(4),
        resolutionNumber: text(5),
        pdfUuid,
        downloadComponentId,
      });
    });

    return documents;
  }

  /** Si `body` es una respuesta parcial JSF, devuelve el HTML dentro del CDATA. */
  private unwrapPartialResponse(body: string): string {
    if (!body.includes('partial-response')) return body;
    const updates = [...body.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)];
    // Concatenamos todos los CDATA (la grilla puede venir troceada).
    return updates.map((m) => m[1]).join('\n');
  }

  /**
   * Extrae el valor de un parámetro dentro del `onclick` de mojarra.jsfcljs,
   * p. ej. de `{...,'param_uuid':'153a6d2a-...'}` obtiene el uuid.
   */
  private extractOnclickParam(onclick: string, param: string): string | null {
    const regex = new RegExp(`'${param}'\\s*:\\s*'([^']+)'`);
    const match = onclick.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Extrae el id del componente de descarga (la clave que se repite como
   * nombre=valor), p. ej. `listarDetalleInfraccionRAAForm:dt:0:j_idt63`.
   */
  private extractDownloadComponentId(onclick: string): string | null {
    const match = onclick.match(/'([^']*:dt:\d+:[^']+)'\s*:\s*'\1'/);
    return match ? match[1] : null;
  }
}
