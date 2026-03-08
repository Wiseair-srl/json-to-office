export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  statusCode?: number;
}

export interface ResponseMeta {
  timestamp: string;
  version: string;
  requestId?: string;
}

export interface DocumentGenerationResponse {
  fileId?: string;
  url?: string;
  filename: string;
  size: number;
  createdAt: string;
}

export interface ServiceStatus {
  status: 'ok' | 'error';
  message?: string;
}

export class AppError extends Error {
  constructor(
    public message: string,
    public _statusCode: number,
    public _details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
