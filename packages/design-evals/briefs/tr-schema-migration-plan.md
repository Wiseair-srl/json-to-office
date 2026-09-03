---
id: tr-schema-migration-plan
format: docx
archetype: technical-report
language: en
density: medium
title: Plan for a zero-downtime schema migration
---

Write the plan for migrating a 1.4-billion-row order table to a new schema without downtime. The change splits one column into three and adds a foreign key. The table takes 6,000 writes per second at peak. The plan uses expand-migrate-contract over four deploys with a dual-write window; backfill takes an estimated 31 hours and can be paused. Cover the current and target schema, the four phases with their exit criteria, the rollback available at each phase, monitoring during the backfill, and the failure modes.
