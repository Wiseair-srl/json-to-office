/**
 * Service configuration types for external integrations (e.g. Highcharts export server)
 */

export interface HighchartsServiceConfig {
  serverUrl?: string;
  headers?: Record<string, string>;
}

export interface ServicesConfig {
  highcharts?: HighchartsServiceConfig;
}
