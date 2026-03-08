import type { FormatAdapter } from '../../format-adapter.js';
import { GeneratorService } from '../services/generator.js';
import { CacheService } from '../services/cache.js';
import { LibreOfficeConverterService } from '../services/libreoffice-converter.js';

type ServiceMap = {
  generatorService: GeneratorService;
  cacheService: CacheService;
  libreOfficeConverterService: LibreOfficeConverterService;
};

export class Container {
  private static instance: Container;
  private services: Map<keyof ServiceMap, ServiceMap[keyof ServiceMap]> = new Map();
  private adapter: FormatAdapter;

  private constructor(adapter: FormatAdapter) {
    this.adapter = adapter;
    const cacheService = new CacheService();
    const generatorService = new GeneratorService(adapter, cacheService);
    const libreOfficeConverterService = new LibreOfficeConverterService(adapter.name as 'docx' | 'pptx');

    this.services.set('cacheService', cacheService);
    this.services.set('generatorService', generatorService);
    this.services.set('libreOfficeConverterService', libreOfficeConverterService);
  }

  public static initialize(adapter: FormatAdapter): Container {
    Container.instance = new Container(adapter);
    return Container.instance;
  }

  public static getInstance(): Container {
    if (!Container.instance) {
      throw new Error('Container not initialized. Call Container.initialize(adapter) first.');
    }
    return Container.instance;
  }

  public static getAdapter(): FormatAdapter {
    return Container.getInstance().adapter;
  }

  public get<K extends keyof ServiceMap>(serviceName: K): ServiceMap[K] {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }
    return service as ServiceMap[K];
  }
}

export const getContainer = () => Container.getInstance();
