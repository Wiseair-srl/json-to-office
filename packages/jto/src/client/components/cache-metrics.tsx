import { useEffect, useState } from 'react';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
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
  efficiencyScore?: number;
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

interface CacheAnalyticsReport {
  healthScore: number;
  overallEfficiency: number;
  componentMetrics: Array<{
    componentType: string;
    hitRate: number;
    totalRequests: number;
    efficiencyScore: number;
  }>;
  recommendations: Array<{
    description: string;
    expectedImprovement: number;
    priority: number;
    reasoning: string;
  }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function CacheMetrics() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [analytics, setAnalytics] = useState<CacheAnalyticsReport | null>(null);
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

        // Fetch analytics report (may not be available)
        try {
          const analyticsResponse = await fetch(
            API_ENDPOINTS.cacheStats.replace('/cache-stats', '/cache-analytics'),
            { signal: controller.signal },
          );
          if (analyticsResponse.ok) {
            const analyticsData = await analyticsResponse.json();
            if (!controller.signal.aborted) setAnalytics(analyticsData.data);
          }
        } catch {
          // Analytics endpoint may not exist
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

      {/* Module-level analytics (docx only) */}
      {FORMAT === 'docx' && stats.components && (
        <ComponentBreakdown data={stats.components} analytics={analytics} />
      )}

      {/* Recommendations */}
      {analytics && analytics.recommendations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Recommendations</h4>
          {analytics.recommendations.map((rec, i) => (
            <Alert key={i} className="py-2">
              <div className="flex items-start gap-2">
                {rec.priority >= 4 ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <AlertTitle className="text-sm flex items-center justify-between gap-2">
                    <span>{rec.description}</span>
                    <Badge
                      variant={rec.priority >= 4 ? 'destructive' : 'secondary'}
                      className="shrink-0"
                    >
                      P{rec.priority}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    {rec.reasoning} — Expected improvement: {rec.expectedImprovement}%
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          ))}
        </div>
      )}

      {analytics && analytics.recommendations.length === 0 && (
        <Alert className="py-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-sm">Cache optimized</AlertTitle>
          <AlertDescription className="text-xs">
            No recommendations — cache is performing well.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ComponentBreakdown({
  data,
  analytics,
}: {
  data: ComponentCacheData;
  analytics: CacheAnalyticsReport | null;
}) {
  if (data.componentStats.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium flex items-center justify-between">
        Module Breakdown
        {analytics && (
          <span className="text-xs text-muted-foreground font-normal">
            Health {analytics.healthScore}/100 · Efficiency {analytics.overallEfficiency}%
          </span>
        )}
      </h4>
      <div className="space-y-1.5">
        {data.componentStats.map((stat) => {
          const hitRate = (stat.hitRate || 0) * 100;
          const requests = stat.totalRequests || stat.hits + stat.misses;
          const memory = stat.memoryUsage || stat.entries * stat.avgSize || 0;

          return (
            <div key={stat.type} className="border rounded px-3 py-2 text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{stat.type}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{hitRate.toFixed(0)}% hit</span>
                  <span>{requests} req</span>
                  <span>{formatTime(stat.avgProcessTime)}</span>
                  <span>{formatBytes(memory)}</span>
                  {stat.efficiencyScore != null && (
                    <Badge
                      variant={stat.efficiencyScore > 70 ? 'default' : 'secondary'}
                      className="text-[10px] px-1 py-0"
                    >
                      {stat.efficiencyScore}%
                    </Badge>
                  )}
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
