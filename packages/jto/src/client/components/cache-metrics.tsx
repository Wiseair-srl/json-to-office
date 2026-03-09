import { useEffect, useState } from 'react';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { API_ENDPOINTS } from '../config/api';
import { FORMAT } from '../lib/env';

interface CacheStats {
  document: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    itemCount: number;
    enabled: boolean;
  };
  components?: ComponentCacheData;
}

interface ComponentStatistics {
  type: string;
  hits: number;
  misses: number;
  avgProcessTime: number;
  avgSize: number;
  entries: number;
  hitRate?: number;
  totalRequests?: number;
  memoryUsage?: number;
}

interface ComponentCacheData {
  entries: number;
  totalSize: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  avgResponseTime: number;
  evictions: number;
  componentStats: ComponentStatistics[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function CacheMetrics() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchData = async () => {
      try {
        const response = await fetch(API_ENDPOINTS.cacheStats, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to fetch cache stats');
        const data = await response.json();

        if (!controller.signal.aborted) {
          setStats(data.data);
          setError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          if (err instanceof Error && err.name !== 'AbortError') {
            setError(err.message);
          } else if (!(err instanceof Error) || err.name !== 'AbortError') {
            setError('Failed to load cache stats');
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);

    const handleCacheCleared = () => fetchData();
    window.addEventListener('cache:cleared', handleCacheCleared);

    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('cache:cleared', handleCacheCleared);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive p-4">
        Error loading cache metrics: {error}
      </div>
    );
  }

  if (!stats) return null;

  const { document: doc } = stats;
  const hitRatePct = doc.hitRate * 100;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center gap-6 text-sm">
        <div>
          <span className="text-muted-foreground">Hit Rate</span>{' '}
          <span className="font-semibold text-base">{hitRatePct.toFixed(1)}%</span>
          <span className="text-muted-foreground ml-1">
            ({doc.hits} hits / {doc.misses} misses)
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Size</span>{' '}
          <span className="font-semibold">{formatBytes(doc.size)}</span>
          <span className="text-muted-foreground ml-1">
            ({doc.itemCount} items)
          </span>
        </div>
        <Badge variant={doc.enabled ? 'default' : 'secondary'}>
          {doc.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <Progress value={hitRatePct} className="h-2" aria-label="Cache hit rate" />

      {/* Module-level breakdown (docx only) */}
      {FORMAT === 'docx' && stats.components && (
        <ComponentBreakdown data={stats.components} />
      )}
    </div>
  );
}

function ComponentBreakdown({ data }: { data: ComponentCacheData }) {
  if (data.componentStats.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Module Breakdown</h4>
      <div className="space-y-1">
        {data.componentStats.map((stat) => {
          const hitRate = (stat.hitRate || 0) * 100;
          const requests = stat.totalRequests || stat.hits + stat.misses;
          const memory = stat.memoryUsage || stat.entries * stat.avgSize || 0;

          return (
            <div key={stat.type} className="px-3 py-1.5 text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{stat.type}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{hitRate.toFixed(0)}% hit</span>
                  <span>{requests} req</span>
                  <span>{formatBytes(memory)}</span>
                </div>
              </div>
              <Progress value={hitRate} className="h-1.5" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
