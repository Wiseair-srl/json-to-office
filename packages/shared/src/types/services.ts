/**
 * Service configuration types for external integrations (e.g. Highcharts export server)
 */

export type HighchartsHeaders = Record<string, string>;

export type HighchartsHeadersResolver = (
  body: unknown
) => HighchartsHeaders | Promise<HighchartsHeaders>;

export interface HighchartsServiceConfig {
  serverUrl?: string;
  headers?: HighchartsHeaders | HighchartsHeadersResolver;
}

export interface ServicesConfig {
  highcharts?: HighchartsServiceConfig;
}
