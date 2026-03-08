import { useEffect, useRef, useCallback } from 'react';

interface PerformanceMetrics {
  renderTime: number;
  componentName: string;
  timestamp: number;
  props?: Record<string, unknown>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private maxMetrics = 100;

  logRender(
    componentName: string,
    renderTime: number,
    props?: Record<string, unknown>
  ) {
    const metric: PerformanceMetrics = {
      componentName,
      renderTime,
      timestamp: Date.now(),
      props,
    };

    this.metrics.push(metric);

    // Keep only the latest metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log slow renders
    if (renderTime > 16) {
      // 16ms = 60fps threshold
      console.warn(
        `Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`,
        props
      );
    }
  }

  getMetrics() {
    return [...this.metrics];
  }

  getAverageRenderTime(componentName?: string) {
    const relevantMetrics = componentName
      ? this.metrics.filter((m) => m.componentName === componentName)
      : this.metrics;

    if (relevantMetrics.length === 0) return 0;

    const sum = relevantMetrics.reduce((acc, m) => acc + m.renderTime, 0);
    return sum / relevantMetrics.length;
  }

  clearMetrics() {
    this.metrics = [];
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

export function usePerformanceMonitor(
  componentName: string,
  props?: Record<string, unknown>
) {
  const renderStartTime = useRef<number>(performance.now());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const renderEndTime = performance.now();
    const renderTime = renderEndTime - renderStartTime.current;

    performanceMonitor.logRender(componentName, renderTime, props);
  });

  const logCustomMetric = useCallback(
    (metricName: string, value: number) => {
      if (!import.meta.env.DEV) return;
      console.log(
        `[Performance] ${componentName} - ${metricName}: ${value.toFixed(2)}ms`
      );
    },
    [componentName]
  );

  return {
    logCustomMetric,
    getMetrics: () => performanceMonitor.getMetrics(),
    getAverageRenderTime: () =>
      performanceMonitor.getAverageRenderTime(componentName),
  };
}

// Web Vitals integration
export function reportWebVitals(metric: any) {
  const { name, value, id } = metric;

  if (import.meta.env.DEV) {
    console.log(`[Web Vitals] ${name}:`, value.toFixed(2), 'ms', `(${id})`);
  }
}

// React Profiler integration
export function onRenderCallback(
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
  baseDuration: number,
  _startTime: number,
  _commitTime: number,
  _interactions: Set<any>
) {
  if (import.meta.env.DEV) {
    console.log(`[Profiler] ${id} (${phase})`, {
      actualDuration: actualDuration.toFixed(2),
      baseDuration: baseDuration.toFixed(2),
      speedup: `${(((baseDuration - actualDuration) / baseDuration) * 100).toFixed(1)}%`,
    });
  }
}
