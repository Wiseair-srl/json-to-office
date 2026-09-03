---
id: tr-api-gateway-migration
format: docx
archetype: technical-report
language: en
density: medium
title: Migration assessment: moving to a managed API gateway
---

Write the technical report our platform team will circulate before deciding. The current self-hosted gateway handles 4,200 requests per second at p99 latency of 180ms and takes roughly 1.5 engineer-days a month to operate. The managed alternative costs EUR 3,800 a month at current volume, adds 12ms of measured latency, and removes the operational load. Two of eleven custom plugins have no equivalent and would need rewriting as external services. Cover the current state, the options, the migration path, the rollback plan and the open questions, with numbered sections and a table of contents.
