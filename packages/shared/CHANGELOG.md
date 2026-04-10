# @json-to-office/shared

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
