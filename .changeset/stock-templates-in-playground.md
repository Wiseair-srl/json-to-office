---
'@json-to-office/jto': patch
---

Ship the eight stock templates with the playground.

They lived in the repo-root `templates/` directory, which the Docker image
never copies, so the deployed DOCX and PPTX playgrounds listed none of them.
Moved the documents and their media under
`packages/jto/src/client/public/templates/`, next to the Company deck
templates that already reach the deployed playgrounds, and rewrote the image
paths to match — they resolve against the process CWD, which is the repo root
locally and `/app` in the container.
