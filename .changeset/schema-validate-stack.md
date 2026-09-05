---
'@json-to-office/jto-cli': patch
---

Validate against an exported JSON Schema on a worker thread with an explicit stack size, and stop asking Ajv for `verbose` errors. The generated DOCX schema compiles to one very large validator function per recursive definition, and its stack frame no longer fit the main thread's stack: validation threw `RangeError: Maximum call stack size exceeded` instead of reporting schema errors. Error paths, messages and values are unchanged.
