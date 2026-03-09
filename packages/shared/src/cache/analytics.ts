/**
 * Component Cache Analytics
 * Advanced analytics and insights for component-level caching
 */

import { CacheStatistics } from './types';

/**
 * Time-series data point for tracking metrics over time
 */
export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

/**
 * Component performance metrics
 */
export interface ComponentPerformanceMetrics {
  /** Component name identifier */
  componentName: string;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Total requests (hits + misses) */
  totalRequests: number;
  /** Average response time for cache hits (ms) */
  avgHitTime: number;
  /** Average response time for cache misses (ms) */
  avgMissTime: number;
  /** Cache efficiency score (0-100) */
  efficiencyScore: number;
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Time saved by caching (ms) */
  timeSaved: number;
  /** Cost-benefit ratio */
  costBenefitRatio: number;
}

/**
 * Component cache trends over time
 */
export interface ComponentCacheTrends {
  /** Component name */
  componentName: string;
  /** Hit rate trend */
  hitRateTrend: TimeSeriesPoint[];
  /** Request volume trend */
  requestVolumeTrend: TimeSeriesPoint[];
  /** Response time trend */
  responseTimeTrend: TimeSeriesPoint[];
  /** Memory usage trend */
  memoryUsageTrend: TimeSeriesPoint[];
}

/**
 * Cache optimization recommendations
 */
export interface CacheOptimizationRecommendation {
  /** Component name to optimize */
  componentName: string;
  /** Recommendation type */
  type:
    | 'increase_ttl'
    | 'decrease_ttl'
    | 'increase_size'
    | 'disable_cache'
    | 'enable_cache';
  /** Recommendation description */
  description: string;
  /** Expected improvement percentage */
  expectedImprovement: number;
  /** Priority level (1-5, 5 being highest) */
  priority: number;
  /** Detailed reasoning */
  reasoning: string;
}

/**
 * Comprehensive cache analytics report
 */
export interface CacheAnalyticsReport {
  /** Report generation timestamp */
  timestamp: number;
  /** Overall cache health score (0-100) */
  healthScore: number;
  /** Total cache efficiency percentage */
  overallEfficiency: number;
  /** Per-component performance metrics */
  componentMetrics: ComponentPerformanceMetrics[];
  /** Component cache trends */
  trends: ComponentCacheTrends[];
  /** Optimization recommendations */
  recommendations: CacheOptimizationRecommendation[];
  /** Top performing components */
  topPerformers: string[];
  /** Components needing attention */
  needsAttention: string[];
  /** Estimated performance gain from caching */
  performanceGain: {
    timeReduction: number; // milliseconds
    cpuReduction: number; // percentage
    memoryOptimization: number; // percentage
  };
}

/**
 * Component Cache Analytics Engine
 */
export class ComponentCacheAnalytics {
  private historyWindow: number = 3600000; // 1 hour in milliseconds
  private metricsHistory: Map<string, TimeSeriesPoint[]> = new Map();
  private performanceBaseline: Map<string, number> = new Map();

  /**
   * Analyze cache statistics and generate comprehensive report
   */
  analyzeCache(stats: CacheStatistics): CacheAnalyticsReport {
    const componentMetrics = this.calculateComponentMetrics(stats);
    const trends = this.calculateTrends(stats);
    const recommendations = this.generateRecommendations(componentMetrics, trends);
    const healthScore = this.calculateHealthScore(componentMetrics);
    const overallEfficiency = this.calculateOverallEfficiency(componentMetrics);
    const performanceGain = this.calculatePerformanceGain(componentMetrics);

    // Identify top performers and components needing attention
    const sortedByEfficiency = [...componentMetrics].sort(
      (a, b) => b.efficiencyScore - a.efficiencyScore
    );
    const topPerformers = sortedByEfficiency
      .slice(0, 3)
      .map((m) => m.componentName);
    const needsAttention = sortedByEfficiency
      .filter((m) => m.efficiencyScore < 50)
      .map((m) => m.componentName);

    return {
      timestamp: Date.now(),
      healthScore,
      overallEfficiency,
      componentMetrics,
      trends,
      recommendations,
      topPerformers,
      needsAttention,
      performanceGain,
    };
  }

  /**
   * Calculate detailed metrics for each component
   */
  private calculateComponentMetrics(
    stats: CacheStatistics
  ): ComponentPerformanceMetrics[] {
    const metrics: ComponentPerformanceMetrics[] = [];

    stats.componentStats.forEach((componentStats, componentName) => {
      const totalRequests = componentStats.hits + componentStats.misses;
      const hitRate = totalRequests > 0 ? componentStats.hits / totalRequests : 0;

      // Calculate efficiency score based on multiple factors
      const efficiencyScore = this.calculateEfficiencyScore(
        hitRate,
        componentStats.avgProcessTime,
        componentStats.avgSize,
        componentStats.entries
      );

      // Estimate time saved by caching
      const timeSaved = componentStats.hits * componentStats.avgProcessTime;

      // Calculate cost-benefit ratio
      const memoryCost = componentStats.entries * componentStats.avgSize;
      const timeBenefit = timeSaved;
      const costBenefitRatio = memoryCost > 0 ? timeBenefit / memoryCost : 0;

      metrics.push({
        componentName,
        hitRate,
        totalRequests,
        avgHitTime: 1, // Cache hits are typically ~1ms
        avgMissTime: componentStats.avgProcessTime,
        efficiencyScore,
        memoryUsage: componentStats.entries * componentStats.avgSize,
        timeSaved,
        costBenefitRatio,
      });
    });

    return metrics;
  }

  /**
   * Calculate efficiency score for a component
   */
  private calculateEfficiencyScore(
    hitRate: number,
    avgProcessTime: number,
    avgSize: number,
    entries: number
  ): number {
    // Weighted scoring system
    const hitRateWeight = 0.4;
    const processingTimeWeight = 0.3;
    const memorySizeWeight = 0.2;
    const utilizationWeight = 0.1;

    // Normalize metrics to 0-100 scale
    const hitRateScore = hitRate * 100;
    const processingTimeScore = Math.min(100, (avgProcessTime / 10) * 100); // Assumes 10ms is slow
    const memorySizeScore = Math.max(0, 100 - (avgSize / 10000) * 100); // Assumes 10KB is large
    const utilizationScore = Math.min(100, (entries / 100) * 100); // Assumes 100 entries is good utilization

    const score =
      hitRateScore * hitRateWeight +
      processingTimeScore * processingTimeWeight +
      memorySizeScore * memorySizeWeight +
      utilizationScore * utilizationWeight;

    return Math.round(score);
  }

  /**
   * Calculate trends over time
   */
  private calculateTrends(stats: CacheStatistics): ComponentCacheTrends[] {
    const trends: ComponentCacheTrends[] = [];
    const now = Date.now();

    stats.componentStats.forEach((componentStats, componentName) => {
      // Get or create history for this component
      const historyKey = `${componentName}_hitRate`;
      if (!this.metricsHistory.has(historyKey)) {
        this.metricsHistory.set(historyKey, []);
      }

      const history = this.metricsHistory.get(historyKey)!;
      const totalRequests = componentStats.hits + componentStats.misses;
      const hitRate = totalRequests > 0 ? componentStats.hits / totalRequests : 0;

      // Add current data point
      history.push({ timestamp: now, value: hitRate });

      // Clean old data points
      const cutoff = now - this.historyWindow;
      const cleanedHistory = history.filter(
        (point) => point.timestamp > cutoff
      );
      this.metricsHistory.set(historyKey, cleanedHistory);

      // Create trend data
      trends.push({
        componentName,
        hitRateTrend: [...cleanedHistory],
        requestVolumeTrend: this.getOrCreateHistory(
          `${componentName}_volume`,
          totalRequests
        ),
        responseTimeTrend: this.getOrCreateHistory(
          `${componentName}_response`,
          componentStats.avgProcessTime
        ),
        memoryUsageTrend: this.getOrCreateHistory(
          `${componentName}_memory`,
          componentStats.entries * componentStats.avgSize
        ),
      });
    });

    return trends;
  }

  /**
   * Get or create history for a metric
   */
  private getOrCreateHistory(
    key: string,
    currentValue: number
  ): TimeSeriesPoint[] {
    const now = Date.now();

    if (!this.metricsHistory.has(key)) {
      this.metricsHistory.set(key, []);
    }

    const history = this.metricsHistory.get(key)!;
    history.push({ timestamp: now, value: currentValue });

    // Clean old data points
    const cutoff = now - this.historyWindow;
    const cleanedHistory = history.filter((point) => point.timestamp > cutoff);
    this.metricsHistory.set(key, cleanedHistory);

    return [...cleanedHistory];
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    metrics: ComponentPerformanceMetrics[],
    trends: ComponentCacheTrends[]
  ): CacheOptimizationRecommendation[] {
    const recommendations: CacheOptimizationRecommendation[] = [];

    metrics.forEach((metric) => {
      const trend = trends.find((t) => t.componentName === metric.componentName);

      // Low hit rate recommendation
      if (metric.hitRate < 0.3 && metric.totalRequests > 10) {
        recommendations.push({
          componentName: metric.componentName,
          type: 'increase_ttl',
          description: `Increase TTL for ${metric.componentName} components to improve hit rate`,
          expectedImprovement: 20,
          priority: 4,
          reasoning: `Current hit rate of ${(metric.hitRate * 100).toFixed(1)}% is below optimal threshold. Increasing TTL could improve cache effectiveness.`,
        });
      }

      // High memory usage with low hit rate
      if (metric.memoryUsage > 1000000 && metric.hitRate < 0.5) {
        recommendations.push({
          componentName: metric.componentName,
          type: 'decrease_ttl',
          description: `Reduce cache size for ${metric.componentName} components`,
          expectedImprovement: 15,
          priority: 3,
          reasoning: `High memory usage (${(metric.memoryUsage / 1024 / 1024).toFixed(2)}MB) with moderate hit rate suggests over-caching.`,
        });
      }

      // Very low efficiency score
      if (metric.efficiencyScore < 30) {
        recommendations.push({
          componentName: metric.componentName,
          type: 'disable_cache',
          description: `Consider disabling cache for ${metric.componentName} components`,
          expectedImprovement: 10,
          priority: 2,
          reasoning: `Efficiency score of ${metric.efficiencyScore} indicates caching may not be beneficial for this component.`,
        });
      }

      // Check trends for declining performance
      if (trend && this.isDecliningSlopbankTrend(trend.hitRateTrend)) {
        recommendations.push({
          componentName: metric.componentName,
          type: 'increase_size',
          description: `Increase cache capacity for ${metric.componentName} components`,
          expectedImprovement: 25,
          priority: 5,
          reasoning: 'Hit rate is declining over time, suggesting cache capacity may be insufficient.',
        });
      }
    });

    // Sort by priority
    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a trend is declining
   */
  private isDecliningSlopbankTrend(trend: TimeSeriesPoint[]): boolean {
    if (trend.length < 3) return false;

    // Simple linear regression to detect trend
    const n = trend.length;
    const recent = trend.slice(-Math.min(10, n)); // Look at last 10 points

    if (recent.length < 3) return false;

    const firstValue = recent[0].value;
    const lastValue = recent[recent.length - 1].value;

    // Declining if dropped by more than 10%
    return (firstValue - lastValue) / firstValue > 0.1;
  }

  /**
   * Calculate overall cache health score
   */
  private calculateHealthScore(metrics: ComponentPerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;

    const avgEfficiency =
      metrics.reduce((sum, m) => sum + m.efficiencyScore, 0) / metrics.length;
    const avgHitRate =
      metrics.reduce((sum, m) => sum + m.hitRate, 0) / metrics.length;

    // Weight efficiency and hit rate
    const healthScore = avgEfficiency * 0.6 + avgHitRate * 100 * 0.4;

    return Math.round(healthScore);
  }

  /**
   * Calculate overall cache efficiency
   */
  private calculateOverallEfficiency(
    metrics: ComponentPerformanceMetrics[]
  ): number {
    if (metrics.length === 0) return 0;

    const totalTimeSaved = metrics.reduce((sum, m) => sum + m.timeSaved, 0);
    const totalMemoryUsed = metrics.reduce((sum, m) => sum + m.memoryUsage, 0);
    const totalRequests = metrics.reduce((sum, m) => sum + m.totalRequests, 0);
    const totalHits = metrics.reduce(
      (sum, m) => sum + m.hitRate * m.totalRequests,
      0
    );

    if (totalRequests === 0) return 0;

    // Calculate efficiency as a combination of hit rate and resource utilization
    const hitRateEfficiency = (totalHits / totalRequests) * 100;
    const resourceEfficiency =
      totalMemoryUsed > 0
        ? Math.min(100, (totalTimeSaved / totalMemoryUsed) * 1000)
        : 0;

    return Math.round(hitRateEfficiency * 0.7 + resourceEfficiency * 0.3);
  }

  /**
   * Calculate performance gain from caching
   */
  private calculatePerformanceGain(metrics: ComponentPerformanceMetrics[]): {
    timeReduction: number;
    cpuReduction: number;
    memoryOptimization: number;
  } {
    const totalTimeSaved = metrics.reduce((sum, m) => sum + m.timeSaved, 0);
    const totalProcessingTime = metrics.reduce(
      (sum, m) => sum + m.totalRequests * m.avgMissTime,
      0
    );
    // Estimate CPU reduction based on cache hits avoiding processing
    const cpuReduction =
      totalProcessingTime > 0
        ? Math.round((totalTimeSaved / totalProcessingTime) * 100)
        : 0;

    // Memory optimization is based on deduplication
    const uniqueEntries = metrics.reduce(
      (sum, m) => sum + m.memoryUsage / m.avgHitTime,
      0
    );
    const totalDataProcessed = metrics.reduce(
      (sum, m) => sum + m.totalRequests * m.memoryUsage,
      0
    );
    const memoryOptimization =
      totalDataProcessed > 0
        ? Math.round(
          ((totalDataProcessed - uniqueEntries) / totalDataProcessed) * 100
        )
        : 0;

    return {
      timeReduction: Math.round(totalTimeSaved),
      cpuReduction: Math.min(100, cpuReduction),
      memoryOptimization: Math.min(100, memoryOptimization),
    };
  }

  /**
   * Reset analytics history
   */
  reset(): void {
    this.metricsHistory.clear();
    this.performanceBaseline.clear();
  }
}
