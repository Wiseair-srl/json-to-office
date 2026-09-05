/**
 * One design note per component, in one table.
 *
 * A schema says what a component accepts; it never says what good use of it
 * looks like. That advice existed only in prose outside the product — a skill
 * file, a playground prompt — where it drifted from the schema release after
 * release. Here it sits next to the surface that serves it: `jto_discover` and
 * `jto_describe_component` both read this table, and `discovery-drift`
 * fails the build when a component gains or loses a name without a note
 * following it.
 *
 * A note is one sentence about *taste*, not about mechanics. Where a
 * `W_QUALITY_*` rule already enforces something, the note says the same thing
 * in the affirmative, so an agent reads the advice before it earns the
 * finding.
 */

import type { FormatName } from './adapters.js';

export type DesignNotes = Readonly<Record<string, string>>;

const DOCX_DESIGN_NOTES: DesignNotes = {
  docx: 'Set metadata.title and a theme on the root, and let the theme carry type and colour — a document that names no theme inherits defaults nobody chose.',
  section:
    'One section per part of the argument, in reading order; a new section for a page setup change, not for every heading.',
  columns:
    'Two columns suit short, scannable copy — a sidebar, a glossary — and fight long paragraphs and wide tables; leave body prose in one column.',
  'text-box':
    'A pinned box is for chrome the flow cannot carry: a running head, a cover panel, a margin note. Body copy belongs in paragraphs, which repaginate.',
  heading:
    'Say what the section concludes, not what it contains — "Adoption doubled after onboarding changed" over "Adoption". Never skip a level.',
  paragraph:
    'One idea per paragraph, 45-90 characters per line for comfortable reading; let the theme set size and spacing rather than styling each run.',
  image:
    'Caption every figure and give it alt text; keep the asset aspect ratio and let width, not both dimensions, drive the size.',
  statistic:
    'A number earns its size only with a label and a unit — a bare 42 tells the reader nothing. Round to the precision the source supports.',
  table:
    'Right-align numeric columns, keep the same decimal places down a column, and let the theme draw the rules — borders on every cell read as a spreadsheet.',
  list: 'Parallel phrasing, one line per item; past about seven items a list is a table or a section in disguise.',
  'key-takeaways':
    'Open a report or a major section with it: three to five conclusions, each one claim in one sentence, written before the body they summarise. The theme draws the box — never rebuild it from paragraphs and rules.',
  toc: 'Worth it past roughly eight headings or ten pages; below that it costs a page and answers nothing.',
  divider:
    'A rule separates what whitespace cannot; two dividers on a page means the spacing is doing too little.',
  highcharts:
    'Title the chart with its takeaway and name the source. Set the series colours from theme tokens — the library default palette is not this document.',
  chart:
    'Pick the type from the comparison: bars for categories, lines for time, and a bar axis that starts at zero. Never 3D.',
  visual:
    'A rendered slide inside a document: use it for a diagram or a layout the flow cannot express, and keep it to the page width.',
};

const PPTX_DESIGN_NOTES: DesignNotes = {
  pptx: 'Declare props.slideWidth and slideHeight — 13.333 x 7.5 for 16:9 — and name a theme; an undeclared canvas renders 4:3 with a dead strip.',
  slide:
    'One idea per slide, with a title that states the message rather than labelling the topic. If it needs two ideas, it needs two slides.',
  text: 'Prefer named styles (title, heading1, body) and theme colour tokens over raw sizes and hex, so a theme swap restyles the deck instead of leaving it half-changed.',
  image:
    'Full-bleed or aligned to the grid — an image floated at an arbitrary offset reads as an accident. Keep its aspect ratio.',
  shape:
    'Shapes are structure and emphasis: a card behind content, a rule, an accent. A shape with a fill nobody can name is decoration the deck does not need.',
  table:
    'A slide table is a summary, not a report — a handful of rows, numbers right-aligned, no borders on every cell. Long tables belong in the document.',
  highcharts:
    'State the takeaway in the title and cite the source; drive the series colours from theme tokens so the chart belongs to the deck.',
  chart:
    'Set the series colours explicitly from the theme, one accent per series — the auto palette reads as default Office. Bars from zero, and never 3D.',
};

const NOTES: Readonly<Record<FormatName, DesignNotes>> = {
  docx: DOCX_DESIGN_NOTES,
  pptx: PPTX_DESIGN_NOTES,
};

/** The note for one component, or undefined when the table has none. */
export function designNote(
  format: FormatName,
  component: string
): string | undefined {
  return NOTES[format][component];
}

/** Every component the table covers, for the drift check. */
export function designNoteNames(format: FormatName): readonly string[] {
  return Object.keys(NOTES[format]).sort();
}
