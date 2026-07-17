import { ScraperConfig } from '../config/config';
import { JurisprudenceDocument } from '../core/domain/JurisprudenceDocument';
import { IHttpClient } from '../core/ports/IHttpClient';
import { ILogger } from '../core/ports/ILogger';
import { InvalidPdfError, SessionError } from '../shared/errors';
import { JsfState } from './JsfState';
import { OefaParser } from './OefaParser';

/**
 * Identificadores de los componentes JSF del formulario de consulta.
 * Se centralizan aquí para que, si el sitio cambia sus `j_idt`, haya un único
 * punto de mantenimiento (evita "números mágicos" dispersos).
 */
const FORM = {
  id: 'listarDetalleInfraccionRAAForm',
  fileNumber: 'listarDetalleInfraccionRAAForm:txtNroexp',
  administered: 'listarDetalleInfraccionRAAForm:j_idt21',
  inspectableUnit: 'listarDetalleInfraccionRAAForm:j_idt25',
  sector: 'listarDetalleInfraccionRAAForm:idsector',
  resolution: 'listarDetalleInfraccionRAAForm:j_idt34',
  searchButton: 'listarDetalleInfraccionRAAForm:btnBuscar',
  resultsPanel: 'listarDetalleInfraccionRAAForm:pgLista',
  dataTable: 'listarDetalleInfraccionRAAForm:dt',
} as const;

/** Resultado de solicitar una página de la grilla. */
export interface PageData {
  readonly documents: JurisprudenceDocument[];
  readonly totalRecords: number | null;
}

/**
 * Cliente de la aplicación JSF de OEFA. Traduce las acciones de alto nivel
 * (abrir, buscar, paginar, descargar PDF) a los POST/GET concretos que espera
 * PrimeFaces, gestionando el ViewState a través de `JsfState`.
 *
 * Depende de abstracciones (`IHttpClient`, `ILogger`), no de axios.
 */
export class OefaClient {
  private readonly resultUrl: string;

  constructor(
    private readonly http: IHttpClient,
    private readonly parser: OefaParser,
    private readonly state: JsfState,
    private readonly config: ScraperConfig,
    private readonly logger: ILogger,
  ) {
    this.resultUrl = `${config.baseUrl}${config.resultPath}`;
  }

  /** URL de acción con el jsessionid vigente (como usa el <form action>). */
  private actionUrl(): string {
    return this.state.jsessionid
      ? `${this.resultUrl};jsessionid=${this.state.jsessionid}`
      : this.resultUrl;
  }

  /**
   * GET inicial: establece la sesión (cookies + jsessionid) y captura el
   * primer ViewState. Debe llamarse una vez antes de buscar.
   */
  async initSession(): Promise<void> {
    const res = await this.http.get(this.resultUrl);
    const viewState = this.parser.extractViewState(res.data);
    const jsessionid = this.parser.extractJsessionId(res.data);
    if (!viewState) {
      throw new SessionError('No se pudo obtener el ViewState inicial de la página.');
    }
    this.state.update(viewState, jsessionid ?? undefined);
    this.logger.debug('Sesión JSF inicializada', { jsessionid });
  }

  /**
   * Ejecuta la búsqueda (botón "Buscar") vía AJAX parcial y devuelve la
   * primera página de resultados junto al total de registros.
   */
  async search(): Promise<PageData> {
    const params = this.baseFormParams();
    params.set('javax.faces.partial.ajax', 'true');
    params.set('javax.faces.source', FORM.searchButton);
    params.set('javax.faces.partial.execute', '@all');
    params.set('javax.faces.partial.render', `${FORM.resultsPanel} ${FORM.fileNumber}`);
    params.set(FORM.searchButton, FORM.searchButton);

    const body = await this.postPartial(params);
    return this.toPageData(body);
  }

  /**
   * Solicita la página cuyo primer registro es `firstRecord` (0, 10, 20, …)
   * mediante el evento de paginación del datatable de PrimeFaces.
   */
  async fetchPage(firstRecord: number): Promise<PageData> {
    const params = this.baseFormParams();
    params.set('javax.faces.partial.ajax', 'true');
    params.set('javax.faces.source', FORM.dataTable);
    params.set('javax.faces.partial.execute', FORM.dataTable);
    params.set('javax.faces.partial.render', FORM.dataTable);
    params.set(FORM.dataTable, FORM.dataTable);
    params.set(`${FORM.dataTable}_pagination`, 'true');
    params.set(`${FORM.dataTable}_first`, String(firstRecord));
    params.set(`${FORM.dataTable}_rows`, String(this.config.pageSize));
    params.set(`${FORM.dataTable}_encodeFeature`, 'true');

    const body = await this.postPartial(params);
    return this.toPageData(body);
  }

  /**
   * Descarga el PDF de un documento. Es un POST de formulario completo (no
   * AJAX) que devuelve el binario. Lanza `InvalidPdfError` si la respuesta no
   * parece un PDF (p. ej. una página de error).
   */
  async downloadPdf(doc: JurisprudenceDocument): Promise<Buffer> {
    const params = this.baseFormParams();
    params.set(doc.downloadComponentId, doc.downloadComponentId);
    params.set('param_uuid', doc.pdfUuid);

    const res = await this.http.post<ArrayBuffer>(this.actionUrl(), {
      body: params.toString(),
      responseType: 'arraybuffer',
      headers: { Accept: 'application/pdf,application/octet-stream,*/*' },
    });

    const buffer = Buffer.from(res.data);
    if (!this.looksLikePdf(buffer)) {
      throw new InvalidPdfError(
        `La respuesta para uuid=${doc.pdfUuid} no es un PDF (status ${res.status}, ${buffer.length} bytes).`,
      );
    }
    return buffer;
  }

  /** Campos del formulario que deben viajar en cada request. */
  private baseFormParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set(FORM.id, FORM.id);
    params.set(FORM.fileNumber, '');
    params.set(FORM.administered, '');
    params.set(FORM.inspectableUnit, '');
    params.set(FORM.sector, '');
    params.set(FORM.resolution, '');
    params.set('javax.faces.ViewState', this.state.viewState);
    return params;
  }

  /** Envía un POST parcial (AJAX) y actualiza el ViewState con la respuesta. */
  private async postPartial(params: URLSearchParams): Promise<string> {
    const res = await this.http.post(this.actionUrl(), {
      body: params.toString(),
      headers: {
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/xml,text/xml,*/*',
      },
    });

    // Un 5xx aquí no debe pasar en silencio como "0 documentos": lo convertimos
    // en error para que la política de reintentos de la capa superior actúe.
    if (res.status >= 400) {
      throw new Error(`El servidor respondió HTTP ${res.status} en la petición AJAX.`);
    }
    // JSF responde 200 con un <error> si el ViewState expiró: mejor decirlo claro.
    if (res.data.includes('ViewExpiredException')) {
      throw new SessionError('La vista JSF expiró (ViewExpiredException): reiniciar sesión.');
    }

    const newViewState = this.parser.extractViewState(res.data);
    if (newViewState) this.state.update(newViewState);
    return res.data;
  }

  private toPageData(body: string): PageData {
    return {
      documents: this.parser.parseRows(body),
      totalRecords: this.parser.extractTotalRecords(body),
    };
  }

  /** Comprueba la firma mágica `%PDF` al inicio del buffer. */
  private looksLikePdf(buffer: Buffer): boolean {
    return buffer.length > 4 && buffer.toString('ascii', 0, 5) === '%PDF-';
  }
}
