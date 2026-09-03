---
id: tr-build-pipeline-audit
format: docx
archetype: technical-report
language: en
density: low
title: Audit of the build and release pipeline
---

Write the audit report for a CI pipeline that has grown to 47 minutes per run against a 10-minute target. Measurement shows 19 minutes of test execution, 14 minutes of dependency installation with a 31% cache hit rate, and 9 minutes of sequential steps that could run in parallel. Flaky tests fail 6% of runs and are retried automatically, hiding the rate. Present the measurements, the causes, the recommended changes with expected savings, and what the pipeline should be measured against afterwards.
