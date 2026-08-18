# @json-to-office/json-to-pptx

## 0.26.0

### Patch Changes

- Updated dependencies [df039c1]
- Updated dependencies [6aa719e]
  - @json-to-office/core-pptx@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f3b3674]
- Updated dependencies [96c30b3]
  - @json-to-office/core-pptx@0.25.0
  - @json-to-office/shared-pptx@0.25.0
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-pptx@0.24.0
  - @json-to-office/core-pptx@0.24.0

## 0.22.0

### Patch Changes

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/core-pptx@0.22.0
  - @json-to-office/shared-pptx@0.22.0

## 0.21.0

### Minor Changes

- 3e05df7: Make generation strict and deterministic by default, harden HTTP rendering,
  ship real schema exports, and migrate CLI output to Ink.

  Behaviour changes to expect when upgrading:

  - **The root component now requires a `props` key.** This aligns the runtime
    validator with the exported JSON Schema, which already marked `props` as
    required. Every field inside it stays optional, so documents that omitted it
    only need `"props": {}`.
  - **Custom component subtrees are now validated.** Standard components authored
    inside a plugin container must satisfy the same prop and tree contract they
    do elsewhere; previously the whole subtree was skipped.
  - **CLI errors go to stderr, and non-TTY output is plain.** Piped or redirected
    output no longer carries terminal escape sequences and is no longer wrapped
    to the terminal width. Use `-f json` for machine-readable results.
  - **Render server:** `resources.files` is rejected in safe mode (Highcharts
    loads it as JavaScript), export dimensions declared under `infile.exporting`
    are now capped, and any `NODE_ENV` other than `development` / `test` gets
    production-grade auth, rate-limit, and outbound-source defaults.

### Patch Changes

- Updated dependencies [3e05df7]
  - @json-to-office/core-pptx@0.21.0
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/core-pptx@0.20.0
  - @json-to-office/shared-pptx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-pptx@0.19.0
  - @json-to-office/core-pptx@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/core-pptx@0.18.0
  - @json-to-office/shared-pptx@0.18.0

## 0.16.0

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0
  - @json-to-office/core-pptx@0.16.0
  - @json-to-office/shared-pptx@0.16.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.9.0

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-pptx@0.9.0
  - @json-to-office/core-pptx@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-pptx@0.8.0
  - @json-to-office/shared-pptx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-pptx@0.7.0
  - @json-to-office/shared-pptx@0.7.0

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-pptx@0.3.0
  - @json-to-office/core-pptx@0.3.0

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-pptx@0.2.0
  - @json-to-office/shared-pptx@0.2.0
