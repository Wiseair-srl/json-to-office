import { useState, useEffect, useCallback } from 'react';

// Types matching the discovery service output
export interface PluginMetadata {
  name: string;
  description?: string;
  version?: string;
  filePath: string;
  relativePath: string;
  location: 'upstream' | 'downstream' | 'current';
  schema: {
    raw?: any;
    jsonSchema?: any;
    properties?: Record<string, any>;
  };
  examples?: Array<{
    title?: string;
    props: any;
    description?: string;
  }>;
}

export interface DocumentMetadata {
  name: string;
  path: string;
  location: 'current' | 'downstream';
  type?: string;
  title?: string;
  description?: string;
  theme?: string;
}

export interface ThemeMetadata {
  name: string;
  path: string;
  location: 'current' | 'downstream';
  description?: string;
}

export interface DiscoveryResult {
  plugins: PluginMetadata[];
  documents: DocumentMetadata[];
  themes: ThemeMetadata[];
}

export interface UseDiscoveryResult {
  data: DiscoveryResult | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and cache discovered items from the API
 */
export function useDiscovery(): UseDiscoveryResult {
  const [data, setData] = useState<DiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiscovery = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/discovery/all');

      if (!response.ok) {
        throw new Error(`Discovery failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Discovery failed');
      }

      setData(result.data);
    } catch (err) {
      console.error('Discovery error:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to fetch discovered items'
      );

      // Set empty data on error to prevent UI from breaking
      setData({
        plugins: [],
        documents: [],
        themes: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiscovery();
  }, [fetchDiscovery]);

  return {
    data,
    loading,
    error,
    refetch: fetchDiscovery,
  };
}

/**
 * Hook to fetch discovered plugins with optional schema and examples
 */
export function useDiscoveredPlugins(
  includeSchemas = true,
  includeExamples = true
): {
  plugins: PluginMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new globalThis.URLSearchParams();
      if (includeSchemas) params.append('schemas', 'true');
      if (includeExamples) params.append('examples', 'true');

      const response = await fetch(`/api/discovery/plugins?${params}`);

      if (!response.ok) {
        throw new Error(`Plugin discovery failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Plugin discovery failed');
      }

      setPlugins(result.data);
    } catch (err) {
      console.error('Plugin discovery error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch plugins');
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, [includeSchemas, includeExamples]);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  return {
    plugins,
    loading,
    error,
    refetch: fetchPlugins,
  };
}

/**
 * Hook to fetch discovered documents
 */
export function useDiscoveredDocuments(): {
  documents: DocumentMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  } {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/discovery/documents');

      if (!response.ok) {
        throw new Error(`Document discovery failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Document discovery failed');
      }

      setDocuments(result.data);
    } catch (err) {
      console.error('Document discovery error:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to fetch documents'
      );
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  return {
    documents,
    loading,
    error,
    refetch: fetchDocuments,
  };
}

/**
 * Hook to fetch discovered themes
 */
export function useDiscoveredThemes(): {
  themes: ThemeMetadata[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  } {
  const [themes, setThemes] = useState<ThemeMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchThemes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/discovery/themes');

      if (!response.ok) {
        throw new Error(`Theme discovery failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Theme discovery failed');
      }

      setThemes(result.data);
    } catch (err) {
      console.error('Theme discovery error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch themes');
      setThemes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  return {
    themes,
    loading,
    error,
    refetch: fetchThemes,
  };
}

/**
 * Hook to load plugins into the registry for presentation generation
 */
export function useLoadPlugins(): {
  loadPlugins: () => Promise<boolean>;
  loading: boolean;
  error: string | null;
  loadedCount: number;
  } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);

  const loadPlugins = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/discovery/load-plugins', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to load plugins: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load plugins');
      }

      setLoadedCount(result.data.loaded);
      return true;
    } catch (err) {
      console.error('Plugin loading error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loadPlugins,
    loading,
    error,
    loadedCount,
  };
}
