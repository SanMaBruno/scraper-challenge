import { JsfState } from '../src/scraper/JsfState';

describe('JsfState', () => {
  it('arranca sin inicializar', () => {
    const state = new JsfState();
    expect(state.isInitialized()).toBe(false);
    expect(state.viewState).toBe('');
  });

  it('guarda ViewState y jsessionid', () => {
    const state = new JsfState();
    state.update('vs-1', 'SESSION123');
    expect(state.isInitialized()).toBe(true);
    expect(state.viewState).toBe('vs-1');
    expect(state.jsessionid).toBe('SESSION123');
  });

  it('actualiza el ViewState conservando el jsessionid si no se pasa uno nuevo', () => {
    const state = new JsfState();
    state.update('vs-1', 'SESSION123');
    state.update('vs-2');
    expect(state.viewState).toBe('vs-2');
    expect(state.jsessionid).toBe('SESSION123'); // se mantiene
  });

  it('ignora valores vacíos para no perder el estado vigente', () => {
    const state = new JsfState();
    state.update('vs-1', 'SESSION123');
    state.update('');
    expect(state.viewState).toBe('vs-1');
  });
});
