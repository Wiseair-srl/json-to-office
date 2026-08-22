import { useEffect, useState } from 'react';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { API_ENDPOINTS } from '../config/api';

interface CacheStats {
  document: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    itemCount: number;
    enabled: boolean;
  };
  rasterizer?: RasterizerCacheData;
}

interface RasterizerCacheData {
  diskHits: number;
  diskMisses: number;
  hitRate: number;
  dedupedRequests: number;
  rendered: number;
  failed: number;
  entries: number;
  bytes: number;
  prepass?: {
    documents: number;
    collected: number;
    unique: number;
  };
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
          <span className="font-semibold text-base">
            {hitRatePct.toFixed(1)}%
          </span>
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

      <Progress
        value={hitRatePct}
        className="h-2"
        aria-label="Cache hit rate"
      />

      {/* Visual rasterizer caches (disk PNG cache + batch dedupe) */}
      {stats.rasterizer && <RasterizerBreakdown data={stats.rasterizer} />}
    </div>
  );
}

function RasterizerBreakdown({ data }: { data: RasterizerCacheData }) {
  const lookups = data.diskHits + data.diskMisses;
  const activity =
    lookups + data.dedupedRequests + data.rendered + data.entries;
  if (activity === 0) return null;

  const hitRatePct = data.hitRate * 100;
  const dedupeSaved = data.prepass
    ? data.prepass.collected - data.prepass.unique
    : data.dedupedRequests;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Visual Rasterizer</h4>
      <div className="px-3 py-1.5 text-sm space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Disk cache</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {lookups > 0 ? `${hitRatePct.toFixed(0)}% hit` : 'no lookups'}
            </span>
            <span>
              ({data.diskHits} hits / {data.diskMisses} misses)
            </span>
            <span>
              {data.entries} PNGs, {formatBytes(data.bytes)}
            </span>
          </div>
        </div>
        <Progress
          value={hitRatePct}
          className="h-1.5"
          aria-label="Rasterizer disk cache hit rate"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data.rendered} rendered
            {data.failed > 0 ? `, ${data.failed} failed` : ''}
          </span>
          <span>
            {dedupeSaved} duplicate visual{dedupeSaved === 1 ? '' : 's'} deduped
            {data.prepass
              ? ` (${data.prepass.collected} collected → ${data.prepass.unique} unique)`
              : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
