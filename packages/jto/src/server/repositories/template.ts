import type { ReportComponent } from '@json-to-pptx/shared';
import { logger } from '../utils/logger';

export interface Template {
  id: string;
  name: string;
  description: string;
  config: ReportComponent;
  createdAt: Date;
  updatedAt: Date;
}

export class TemplateRepository {
  // In-memory storage for now
  private templates: Map<string, Template> = new Map();

  constructor() {
    // Initialize with some default templates
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    const defaultTemplate: Template = {
      id: 'default',
      name: 'Default Template',
      description: 'A basic document template',
      config: {
        name: 'report',
        props: {
          metadata: {
            title: 'Document Title',
          },
        },
        children: [
          {
            name: 'header',
            props: {
              text: 'Document Header',
              alignment: 'center',
            },
          },
          {
            name: 'section',
            props: {},
            children: [
              {
                name: 'heading',
                props: {
                  text: 'Introduction',
                  level: 1,
                },
              },
              {
                name: 'paragraph',
                props: {
                  text: 'Presentation content goes here.',
                },
              },
            ],
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.templates.set(defaultTemplate.id, defaultTemplate);
  }

  async getTemplate(id: string): Promise<Template | null> {
    return this.templates.get(id) || null;
  }

  async getAllTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values());
  }

  async saveTemplate(template: Template): Promise<void> {
    try {
      template.updatedAt = new Date();
      this.templates.set(template.id, template);
      logger.info('Template saved', { id: template.id });
    } catch (error) {
      logger.error('Failed to save template', { error });
      throw error;
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    this.templates.delete(id);
    logger.info('Template deleted', { id });
  }
}
