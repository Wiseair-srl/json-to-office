import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { renderPreview, getAdapter, collectRenderedFindings } from '@json-to-office/mcp-server';
const S = process.argv[2];
const out = JSON.parse(readFileSync(`${S}/fill-measure.json`, 'utf8'));
out['checkpoint-after-3'] = {};
for (const run of readdirSync('evals-out/checkpoint-after-3/runs').filter((d) => d.includes('#')).sort()) {
  const document = JSON.parse(readFileSync(`evals-out/checkpoint-after-3/runs/${run}/document.json`, 'utf8'));
  const r = await renderPreview({ format: 'docx', document, dpi: 36, outputMode: 'path', rendered: true, getAdapter });
  if (!r.ok || !r.rendered) { out['checkpoint-after-3'][run] = { error: JSON.stringify(r.diagnostics ?? r).slice(0, 160) }; continue; }
  const f = await collectRenderedFindings({ format: 'docx', document, render: {}, rendered: r.rendered, adapter: getAdapter('docx'), quality: { profile: { id: 'client-report' } } });
  const under = f.diagnostics.filter((d) => d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED');
  out['checkpoint-after-3'][run] = { pages: r.totalPages, underfilled: under.length, fills: under.map((d) => d.context.fill), codes: [...new Set(f.diagnostics.map((d) => d.code))] };
  process.stderr.write(`${run}\n`);
}
writeFileSync(`${S}/fill-measure.json`, JSON.stringify(out));
