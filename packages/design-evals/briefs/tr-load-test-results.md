---
id: tr-load-test-results
format: docx
archetype: technical-report
language: en
density: high
title: Load test results ahead of a seasonal peak
---

Write the report on load testing for a peak expected at 3.2x normal traffic. The system held to 2.4x, at which point checkout p99 rose from 340ms to 4.1 seconds; the bottleneck is connection pool exhaustion on the payments service, which saturates at 200 concurrent connections. Raising the pool to 500 moved the ceiling to 3.1x and shifted the bottleneck to the inventory database's write lock. Present the method, the runs with their numbers, the two bottlenecks, the fixes with expected headroom, and a clear statement of whether we are ready.
