/**
 * File upload types for Hono compatibility
 */

export interface FileUpload {
  buffer: Buffer;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface HonoFileAdapter {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Adapts Hono file upload to Express Multer format
 */
export function adaptHonoFile(
  buffer: Buffer,
  filename: string,
  mimetype: string
): HonoFileAdapter {
  return {
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype: mimetype,
    buffer: buffer,
    size: buffer.length,
  };
}
