# Generating documents with LLMs

json-to-office was designed with LLM-driven document generation as a first-class use case: a language model is very good at producing structured JSON and very bad at producing binary `.docx` bytes. The library splits the problem accordingly — the model authors **data**, and predictable rendering code turns that data into a real Office file.

## Why the JSON model fits LLMs

**Schema-constrained output.** Every component's props are defined with TypeBox schemas that export to standard JSON Schema. That gives you a machine-readable contract to hand to the model — in the prompt, or as the schema for a structured-output / constrained-decoding API. The model doesn't have to remember what a `chart` accepts; the schema says so.

**Validation as a feedback loop.** LLMs make mistakes; what matters is whether mistakes are caught and correctable. The [deep validators](/guide/validation) collect _all_ errors in one pass, each with a JSON path and a human-readable message (often with suggestions). Those messages were written for developers, which makes them equally good repair instructions for a model: feed them back and re-generate.

**Reproducible definitions.** The validated JSON is stable, diffable, and replayable. Given the same renderer version, theme, fonts, and assets, it produces the same document structure and content. OOXML archive metadata and generated IDs can still change the file bytes, so persist or hash the JSON contract rather than relying on a `.docx` or `.pptx` checksum. Contrast this with asking a model to drive an imperative document library: every run writes different code, and the failure modes are runtime exceptions rather than data errors.

**A diffable text format.** Model output is JSON you can log, review, store in a database, and diff. Two generations of the same report can be compared line by line — and for DOCX, `diffDocuments` can turn two JSON versions into a native Word redline with tracked changes. Binary formats and generated code offer nothing comparable.

::: info Scope
The core libraries have zero dependency on any AI provider. LLM integration is something you build around the library — plus one reference implementation in the playground, described below.
:::

## Pattern 1: give the model the schema

The repository publishes generated schemas — `document.schema.json` (DOCX), `presentation.schema.json` (PPTX), and `theme.schema.json` — see [JSON Schemas](/reference/json-schemas). You can also generate them programmatically, which is the right move when you've registered custom components, since the schema then includes them:

```ts
import {
  generateUnifiedDocumentSchema,
  convertToJsonSchema,
} from '@json-to-office/json-to-docx';

const unified = generateUnifiedDocumentSchema({ customComponents: [] });
const jsonSchema = convertToJsonSchema(unified, {
  title: 'JSON to DOCX Document',
});
// Include jsonSchema (or a trimmed subset) in the system prompt,
// or pass it to a structured-output API.
```

The full schema is large. Two practical variants:

- For prompt-based generation, a few **worked examples** of valid documents (see [Examples](/examples/)) plus the prop tables for the components you actually use often outperform dumping the entire schema.
- For constrained decoding, use the schema as-is — that's what it's for.

## Pattern 2: validate, then repair

Never render model output blind. Validate first, and if it fails, send the errors back:

```ts
import { validate } from '@json-to-office/json-to-docx';

async function generateWithRepair(prompt: string, maxAttempts = 3) {
  let feedback = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await callYourModel(prompt + feedback); // any provider
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      feedback = '\nYour previous output was not valid JSON. Return only JSON.';
      continue;
    }
    const result = validate.jsonDocument(doc);
    if (result.valid) return result.data;
    feedback =
      '\nYour previous document had validation errors. Fix them:\n' +
      result.errors.map((e) => `- ${e.path}: ${e.message}`).join('\n');
  }
  throw new Error('Model failed to produce a valid document');
}
```

Because the deep validator reports every error at once (not just the first), a single repair round usually fixes everything. In practice most loops converge in one or two attempts.

For PPTX, add a second gate after generation: `generateBufferWithWarnings` returns coded [pipeline warnings](/guide/validation) (skipped charts, unknown colors, clamped grid positions) that schema validation alone can't catch. Treating `warnings.length > 0` as a soft failure — and feeding the warning messages back the same way — catches the "valid but wrong" class of model output.

## Pattern 3: render server-side

The natural architecture is: model produces JSON → your server validates → the library renders to a buffer → you return or store the file. No filesystem needed:

```ts
import { generateBufferFromJson } from '@json-to-office/json-to-docx';

app.post('/reports', async (req, res) => {
  const doc = await generateWithRepair(buildPrompt(req.body));
  const buffer = await generateBufferFromJson(doc); // throws JsonValidationError if invalid
  res
    .setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    .send(buffer);
});
```

Useful properties of this setup:

- The JSON is the artifact worth persisting — store it in a database row and re-render the document on demand, instead of storing an opaque binary you can't diff or edit.
- Documents can be post-processed as data before rendering: toggle nodes with `enabled: false`, inject tenant branding via themes and `componentDefaults`, or merge model-written content into a hand-built template skeleton (see [Core concepts](/guide/core-concepts)).
- Charts via `highcharts` and the DOCX `visual` component need external rendering services at generation time — see [Render server](/guide/render-server). Native PPTX `chart` components need nothing.

## Reference implementation: the playground assistant

The [visual playground](/guide/playground) (`jto docx dev` / `jto pptx dev`) ships with a built-in AI chat panel that generates and edits documents in the editor. It is a working example of the patterns above:

- **Claude via Claude Code auth.** The dev server talks to Claude through `ai-sdk-provider-claude-code`, reusing your local Claude Code authentication — no API key to configure. The model is selectable per chat: Opus, Sonnet, or Haiku.
- **Schema in context.** The server builds the full generated JSON Schema for the active format (DOCX or PPTX) and injects it into the model's instructions, so output is grounded in the real contract rather than the model's memory of it.
- **The editor closes the loop.** Generated JSON lands in the Monaco editor, where the same validators run live and the preview renders the result — errors and visual problems are immediately visible and can be handed back to the chat.
- **Multimodal input.** Attached PDFs and text files are extracted to text and images are passed through, so you can ask for "a deck from this PDF".

Note the boundaries: the assistant is a playground feature, not part of the libraries, and it is disabled on the hosted playgrounds ([docx.json-to-office.com](https://docx.json-to-office.com), [pptx.json-to-office.com](https://pptx.json-to-office.com)) — run the playground locally to use it.

## Honest limitations

- **No magic quality.** Schema validity guarantees a _renderable_ document, not a well-designed one. Layout judgment (what goes on which slide, how much text fits) still comes from your prompts and examples.
- **The repair loop is yours to build.** The library gives you validators and error messages designed to be fed back; it does not ship an automated retry loop outside the playground.
- **Model-agnostic by design.** Everything on this page works with any model that can emit JSON; only the playground assistant is Claude-specific.

## Where to go next

- [Validation](/guide/validation) — the validators and warning codes the loop is built on
- [JSON Schemas](/reference/json-schemas) — schema files and editor integration
- [Playground](/guide/playground) — the local dev environment, including the AI panel
- [API reference](/reference/api) — generation functions and options
