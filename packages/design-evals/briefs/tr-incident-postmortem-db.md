---
id: tr-incident-postmortem-db
format: docx
archetype: technical-report
language: en
density: high
title: Post-incident report: primary database failover
---

Write the post-incident report for a four-hour partial outage. At 02:14 the primary database failed over; the replica had been lagging 90 seconds and the application wrote to both for eleven minutes before the load balancer converged. 1,842 orders were affected, 214 of them duplicated. Detection took 19 minutes, diagnosis 96 minutes, resolution 41 minutes. Three contributing causes: replication lag alerting was set at 300 seconds, the failover script did not fence the old primary, and the runbook was eleven months out of date. Include a timeline table, the causes, the remediation with owners, and what would have made this a ten-minute incident.
