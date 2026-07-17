/**
 * Estado de una sesión JSF (JavaServer Faces / PrimeFaces).
 *
 * El sitio de OEFA es una aplicación JSF con estado en servidor: cada respuesta
 * trae un `ViewState` que debe reenviarse en la siguiente petición. Además la
 * sesión se identifica por `jsessionid` (embebido en la URL del <form action>).
 *
 * Esta clase encapsula ese estado mutable en un único lugar (evita esparcir
 * `viewState` por todo el código) — cumpliendo Responsabilidad Única.
 */
export class JsfState {
  private _viewState = '';
  private _jsessionid = '';

  get viewState(): string {
    return this._viewState;
  }

  get jsessionid(): string {
    return this._jsessionid;
  }

  update(viewState: string, jsessionid?: string): void {
    if (viewState) this._viewState = viewState;
    if (jsessionid) this._jsessionid = jsessionid;
  }

  isInitialized(): boolean {
    return this._viewState.length > 0;
  }
}
