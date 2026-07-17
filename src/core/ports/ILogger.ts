/**
 * Puerto de logging. Permite que las capas de dominio/aplicación registren
 * información sin acoplarse a una implementación concreta (consola, archivo,
 * servicio externo, etc.). — Principio de Inversión de Dependencias (D de SOLID).
 */
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}
