import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CONVERSION_TIMEOUT_MS = 30000;
const BINARY_PROBE_TIMEOUT_MS = 5000;
const MAX_EXEC_BUFFER_BYTES = 20 * 1024 * 1024;

type ExecError = NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer };

function executeFile(binary: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: MAX_EXEC_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error) {
        const execError = error as ExecError;
        execError.stdout = stdout;
        execError.stderr = stderr;
        reject(execError);
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function toErrorText(value: unknown): string {
  if (!value) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  return String(value);
}

function sanitizeBaseName(originalName?: string): string {
  const parsed = path.parse(originalName || 'document');
  return (parsed.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
}

export class LibreOfficeError extends Error {
  readonly code: 'BINARY_NOT_FOUND' | 'CONVERSION_TIMEOUT' | 'CONVERSION_FAILED' | 'OUTPUT_NOT_FOUND';
  constructor(code: LibreOfficeError['code'], message: string) {
    super(message);
    this.name = 'LibreOfficeError';
    this.code = code;
  }
}

export class LibreOfficeBinaryNotFoundError extends LibreOfficeError {
  readonly candidates: string[];
  constructor(candidates: string[]) {
    super('BINARY_NOT_FOUND', 'LibreOffice binary not found. Install LibreOffice locally or set LIBREOFFICE_PATH.');
    this.name = 'LibreOfficeBinaryNotFoundError';
    this.candidates = candidates;
  }
}

export class LibreOfficeTimeoutError extends LibreOfficeError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super('CONVERSION_TIMEOUT', `LibreOffice conversion timed out after ${timeoutMs}ms`);
    this.name = 'LibreOfficeTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class LibreOfficeConversionError extends LibreOfficeError {
  readonly details?: string;
  constructor(message: string, details?: string) {
    super('CONVERSION_FAILED', message);
    this.name = 'LibreOfficeConversionError';
    this.details = details;
  }
}

export class LibreOfficeOutputNotFoundError extends LibreOfficeError {
  readonly outputPath: string;
  constructor(outputPath: string) {
    super('OUTPUT_NOT_FOUND', 'LibreOffice conversion completed but PDF output was not produced');
    this.name = 'LibreOfficeOutputNotFoundError';
    this.outputPath = outputPath;
  }
}

export class LibreOfficeConverterService {
  private readonly timeoutMs: number;
  private readonly format: 'docx' | 'pptx';

  constructor(format: 'docx' | 'pptx', timeoutMs?: number) {
    this.format = format;
    this.timeoutMs = timeoutMs || config.LIBREOFFICE_TIMEOUT_MS || DEFAULT_CONVERSION_TIMEOUT_MS;
  }

  async convertToPdf(input: Buffer, originalName: string = 'document'): Promise<Buffer> {
    if (!input || input.length === 0) {
      throw new LibreOfficeConversionError('Input file is empty');
    }

    const binaryPath = await this.resolveBinaryPath();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-libreoffice-'));
    const outputBaseName = sanitizeBaseName(originalName);
    const ext = this.format === 'pptx' ? '.pptx' : '.docx';
    const inputPath = path.join(tempDir, `${outputBaseName}${ext}`);
    const pdfPath = path.join(tempDir, `${outputBaseName}.pdf`);

    try {
      await fs.writeFile(inputPath, input);

      const filterName = this.format === 'pptx' ? 'impress_pdf_Export' : 'writer_pdf_Export';
      await this.runConversion(binaryPath, inputPath, tempDir, filterName);

      try {
        return await fs.readFile(pdfPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new LibreOfficeOutputNotFoundError(pdfPath);
        }
        throw error;
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private getBinaryCandidates(): string[] {
    const candidates: string[] = [];
    const configured = config.LIBREOFFICE_PATH?.trim();
    if (configured) candidates.push(configured);
    if (process.platform === 'darwin') {
      candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    }
    candidates.push('soffice', 'libreoffice');
    return [...new Set(candidates)];
  }

  private async resolveBinaryPath(): Promise<string> {
    const candidates = this.getBinaryCandidates();
    for (const candidate of candidates) {
      if (await this.isBinaryAvailable(candidate)) return candidate;
    }
    throw new LibreOfficeBinaryNotFoundError(candidates);
  }

  private async isBinaryAvailable(binaryPath: string): Promise<boolean> {
    if (binaryPath.includes(path.sep)) {
      try { await fs.access(binaryPath); } catch { return false; }
    }
    try {
      await executeFile(binaryPath, ['--version'], BINARY_PROBE_TIMEOUT_MS);
      return true;
    } catch (error) {
      const code = (error as ExecError).code;
      return code !== 'ENOENT' && code !== 'EACCES';
    }
  }

  private async runConversion(binaryPath: string, inputPath: string, outputDir: string, filterName: string): Promise<void> {
    const userInstallation = `file://${path.join(outputDir, 'user-profile')}`;
    const args = [
      '--headless', '--norestore', '--nolockcheck', '--nodefault',
      `-env:UserInstallation=${userInstallation}`,
      '--convert-to', `pdf:${filterName}`,
      '--outdir', outputDir, inputPath,
    ];

    try {
      await executeFile(binaryPath, args, this.timeoutMs);
    } catch (error) {
      const execError = error as ExecError;
      if (execError.code === 'ETIMEDOUT') throw new LibreOfficeTimeoutError(this.timeoutMs);
      if (execError.code === 'ENOENT') throw new LibreOfficeBinaryNotFoundError(this.getBinaryCandidates());
      const details = [toErrorText(execError.stderr), toErrorText(execError.stdout)].filter(Boolean).join('\n').trim();
      throw new LibreOfficeConversionError('LibreOffice failed to convert to PDF', details || execError.message);
    }
  }
}
