# Blueprints

A blueprint is a document archetype as data: the recommended theme, the quality profile that judges the result, the playground template whose [JSON blocks](/reference/blocks) it invokes, and one or more structural variants — each an ordered list of sections holding block invocations and ordinary components, every slot carrying an explicit `{{…}}` scaffold marker whose text is the guidance for filling it. A blueprint composes nothing and styles nothing: the blocks compose, the theme paints, the profile asks.

Themes and profiles stay independent by construction. Switching the theme of a scaffold changes its appearance and not one requirement; switching the profile changes what validation asks for and not one theme token.

## The registry

Blueprints live as JSON files under `packages/core-docx/src/templates/blueprints/`: the registry reads every `*.docx.blueprint.json` in that directory when the package loads and validates each against the shared blueprint schema, so adding one is a file, not code, and a malformed one fails at import rather than at scaffold time. `jto_discover` lists them per format as summaries — id, title, description, when to use, theme, profile, definitions, variants with their expected length — and the library exposes the registry as `DOCX_BLUEPRINTS`.

| Field         | Meaning                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Kebab-case identifier                                                                                                                             |
| `format`      | `docx` or `pptx`                                                                                                                                  |
| `theme`       | The recommended theme; any theme renders the scaffold                                                                                             |
| `profile`     | The quality profile written to the scaffold's `props.qualityProfile`, so validation without arguments judges it                                   |
| `definitions` | The playground template whose `props.blocks` the variants invoke; the scaffold carries the definitions it uses and the ones those depend on       |
| `numbering`   | `sections` when openers carry numbers the reader cites, else `none`; the variants write the numbers themselves                                    |
| `toc`         | Whether the archetype carries a table of contents; declared for the scaffold to read, and no variant asks for one yet                             |
| `variants`    | Structural variants of the same archetype: `description`, `whenToUse`, `pages` (`min`/`max` once filled), `metadata` and the top-level `children` |

## `client-report`

A report for a client or a public administration, on the `consulting` theme and judged by the `client-report` profile: a cover in its own section, then sections under one running head that tracks the section and numbers the pages, key takeaways first, a takeaway and a source under every figure, notes and sources last.

| Variant      | Structure                                                                                                                              | Pages |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `data-heavy` | Cover; takeaways, a KPI row and body; a chart with its takeaway; a data table with a note; next steps and the notes and sources        | 4–8   |
| `narrative`  | Cover; takeaways and two paragraphs; a section with a note; a section with a KPI row as evidence; next steps and the notes and sources | 3–6   |

Both variants invoke `cover`, `running-head`, `section-opener`, `key-takeaways`, `kpi-row`, `callout`, `footnotes` and, through them, `source-line`; the data-heavy one adds `chart-figure` and `data-table`. The chart slot holds a `highcharts` component whose categories, series name and axis title are markers, so the export server draws a placeholder chart until the data arrives and generation refuses the document until every marker is gone.

## Instantiating one

```ts
import {
  docxBlueprint,
  instantiateDocxBlueprint,
} from '@json-to-office/core-docx';
import { readBlockDefinitions } from '@json-to-office/shared';

const blueprint = docxBlueprint('client-report')!;
const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
  variant: 'data-heavy',
  theme: 'vermilion', // optional; the blueprint's own otherwise
  definitions: readBlockDefinitions(template), // the playground template's props.blocks
});
```

The document is schema- and semantic-valid, carries `qualityProfile: "client-report"`, and validates with only `W_QUALITY_SCAFFOLD_MARKER` findings — advisory, so the draft is workable, while the MCP `jto_generate` tool refuses any marker that remains (the library's own generator renders a marker as text). The fill map lists every marker:

| Field                                                  | Meaning                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `path`                                                 | JSON pointer into the document; the value there is the marker                                                               |
| `marker`, `guidance`                                   | The marker as written, and its text: what to write there                                                                    |
| `kind`                                                 | `slot` inside a block invocation, `text` in an ordinary component, `metadata` under `props.metadata`                        |
| `block`, `slot`                                        | For a slot: the block and the slot, dotted for a nested field (`items.label`)                                               |
| `type`, `maxWords`, `maxLength`, `oneLine`, `required` | For a slot: the declared type and bounds, from the definition; a marker inside a component slot's content reports that slot |

Patch every pointer with content and the document is generation-ready; leave one and `jto_generate` names it.

## Scaffolding through MCP

`jto_scaffold` wraps the same call in a workspace: it takes a blueprint id, an optional variant and theme, the facts of the brief and a markdown outline, and answers with a handle at revision 1, the fill map above with every pointer resolving at that revision, and how many markers the brief and outline already wrote. The agent fills the rest by pointer with `jto_workspace_patch` and never holds the document.

The brief and the outline are mapped by one rule each:

| Input                   | Fills                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brief.<key>`           | `props.metadata.<key>` (`client` also fills `company`) and the `<key>` slot of the cover and the running head — never a body block, where `title` means the section's |
| `# Heading`             | The title, unless the brief gave one                                                                                                                                  |
| `## Heading`, in order  | The next section opener's `title`                                                                                                                                     |
| Paragraphs under a `##` | That section's body text markers, in order; a blank line separates paragraphs                                                                                         |

A brief key that matches nothing comes back as `W_BRIEF_UNUSED`; a section or paragraph the variant has no room for, text before the first `##`, a second `#` and any deeper heading come back as `W_OUTLINE_UNMAPPED`. Nothing is dropped silently. `jto_validate` on the handle reports the markers as advisory findings with `generationReady: false` and, once they are gone, `generationReady: true`; `jto_generate` refuses in between, naming every remaining marker by pointer. `jto://blueprints` serves the plans in full and `jto_discover` their summaries.
