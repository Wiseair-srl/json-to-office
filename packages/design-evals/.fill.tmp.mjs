import { readFileSync, readdirSync } from 'node:fs';
import { renderPreview, getAdapter, collectRenderedFindings } from '@json-to-office/mcp-server';
const out = {};
for (const set of ['checkpoint-before', 'checkpoint-after', 'checkpoint-after-2']) {
  out[set] = {};
  for (const run of readdirSync(`evals-out/${set}/runs`).filter((d) => d.includes('#')).sort()) {
    const document = JSON.parse(readFileSync(`evals-out/${set}/runs/${run}/document.json`, 'utf8'));
    try {
      const r = await renderPreview({ format: 'docx', document, dpi: 36, outputMode: 'path', rendered: true, getAdapter });
      const f = await collectRenderedFindings({ format: 'docx', document, render: {}, rendered: r.rendered, adapter: getAdapter('docx'), quality: { profile: { id: 'client-report' } } });
      const under = f.diagnostics.filter((d) => d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED');
      out[set][run] = { pages: r.totalPages, underfilled: under.length, fills: under.map((d) => d.context.fill), codes: [...new Set(f.diagnostics.map((d) => d.code))] };
    } catch (e) { out[set][run] = { error: String(e).slice(0, 120) }; }
    process.stderr.write(`${set} ${run}\n`);
  }
}
console.log(JSON.stringify(out));
