/**
 * Type declarations for highcharts-export-server
 */

declare module 'highcharts-export-server' {
  export interface PoolOptions {
    acquireTimeout?: number;
    [key: string]: unknown;
  }

  export interface LoggingOptions {
    level?: number;
    [key: string]: unknown;
  }

  export interface ExportOptions {
    type?: 'png' | 'jpeg' | 'svg' | 'pdf';
    width?: number;
    height?: number;
    scale?: number;
    constr?: 'chart' | 'stockChart' | 'mapChart' | 'ganttChart';
    options?: Record<string, unknown>; // Highcharts options
    themeOptions?: string; // JSON string of theme options
    timeout?: number;
    rasterizationTimeout?: number;
    [key: string]: unknown;
  }

  export interface DebugOptions {
    enable?: boolean;
    slowMo?: number;
    [key: string]: unknown;
  }

  export interface GlobalOptions {
    pool?: PoolOptions;
    logging?: LoggingOptions;
    export?: ExportOptions;
    debug?: DebugOptions;
    [key: string]: unknown;
  }

  export interface ExportResult {
    result: string; // Base64 encoded image
    type: string;
    width: number;
    height: number;
  }

  export interface ExportSettings {
    export?: ExportOptions;
    [key: string]: unknown;
  }

  export function setOptions(_options: GlobalOptions): GlobalOptions;
  export function initExport(_settings: GlobalOptions): Promise<void>;
  export function startExport(
    _settings: ExportSettings,
    _callback: (_error: Error | null, _info: ExportResult) => void
  ): void;
  export function killPool(): Promise<void>;
  export function singleExport(_options: ExportOptions): Promise<ExportResult>;
  export function batchExport(_options: Record<string, unknown>): Promise<void>;
}
