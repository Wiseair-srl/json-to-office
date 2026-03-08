import { logger } from '../utils/logger';
import type { ReportComponent } from '@json-to-pptx/shared';

export interface DocumentMetadata {
  id: string;
  title: string;
  createdAt: Date;
  config: ReportComponent;
  cached?: boolean;
}

export class DocumentRepository {
  // In-memory storage for now
  private documents: Map<string, DocumentMetadata> = new Map();

  async saveMetadata(metadata: DocumentMetadata): Promise<void> {
    try {
      this.documents.set(metadata.id, metadata);
      logger.info('Document metadata saved', { id: metadata.id });
    } catch (error) {
      logger.error('Failed to save document metadata', { error });
      throw error;
    }
  }

  async getMetadata(id: string): Promise<DocumentMetadata | null> {
    return this.documents.get(id) || null;
  }

  async getAllMetadata(): Promise<DocumentMetadata[]> {
    return Array.from(this.documents.values());
  }

  async deleteMetadata(id: string): Promise<void> {
    this.documents.delete(id);
    logger.info('Document metadata deleted', { id });
  }
}
