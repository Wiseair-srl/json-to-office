---
id: tr-observability-standard
format: docx
archetype: technical-report
language: en
density: medium
title: Observability standard for backend services
---

Write the standard that all 34 backend services will be held to. It must state the required signals (structured logs, RED metrics, trace propagation), the naming conventions, the retention periods, and the exemption process. Today 12 services emit structured logs, 21 emit metrics with inconsistent names, and trace context is dropped at four service boundaries. Rollout is one quarter for new services and three for existing ones. Number the sections, define terms once, and make it a document an engineer can implement from without asking anyone.
