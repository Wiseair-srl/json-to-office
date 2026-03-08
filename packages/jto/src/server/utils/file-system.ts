import mime from 'mime-types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globSync } from 'glob';
import { config } from '../config';

export const TMP_DIR = config.TEMP_DIR || path.join(os.tmpdir(), 'pptx');

export interface TextFile {
  name: string;
  type: string;
  text: string;
  atime: Date;
  ctime: Date;
  mtime: Date;
}

export function loadTextFile(filePath: string): TextFile {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const stats = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    type: (mime.lookup(filePath) || 'text/plain').replace(
      'video/mp2t',
      'application/typescript'
    ),
    text: fileContent,
    atime: stats.atime,
    ctime: stats.ctime,
    mtime: stats.mtime,
  };
}

export function loadTextFiles(
  pattern: string,
  folderPath?: string,
  dropFileExt: boolean = false
): TextFile[] {
  folderPath = path.join(process.cwd(), folderPath || '');
  if (!fs.existsSync(folderPath)) {
    return []; // folder does not exist
  }
  const textFiles: TextFile[] = [];
  const matchedFiles = globSync(pattern, { cwd: folderPath });
  for (const relativeFilePath of matchedFiles) {
    const filePath = path.join(folderPath, relativeFilePath);
    const stats = fs.statSync(filePath);
    if (stats.isFile()) {
      const textFile = loadTextFile(filePath);
      if (dropFileExt) {
        textFile.name = textFile.name.replace(path.extname(textFile.name), '');
      }
      textFiles.push(textFile);
    }
  }
  return textFiles;
}
