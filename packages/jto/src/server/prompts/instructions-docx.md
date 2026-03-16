# DOCX Document Guidelines

## Architecture

A DOCX document is an array of component objects. Use `Report` as the root container with `Section` components for page layout control.

```json
[
  {
    "name": "Report",
    "props": { "title": "My Report" },
    "children": [
      { "name": "Section", "props": {}, "children": [ ...components... ] }
    ]
  }
]
```

## Component Catalog

- **Heading** — section titles. Props: `text`, `level` (1–6), `color`, `bold`, `alignment`
- **Paragraph** — body text. Props: `text`, `fontSize`, `bold`, `italic`, `color`, `alignment`, `spacing`
- **Table** — data grids. Props: `rows` (2D array of strings or cell objects), `columnWidths`, `headerRow`
- **Image** — pictures. Props: `src` (path or base64), `width`, `height`, `altText`
- **List** — ordered/unordered lists. Props: `items`, `type` ("bullet" | "number"), `level`
- **Columns** — side-by-side layout. Props: `columns` (array of child arrays), `spacing`
- **Statistic** — key metric display. Props: `value`, `label`, `description`
- **TextBox** — bordered/shaded text block. Props: `text`, `background`, `border`
- **Header** — page header. Props: `text`, `alignment`
- **Footer** — page footer. Props: `text`, `alignment`, `pageNumber`
- **TableOfContents** — auto TOC. Props: `maxLevel`

## Design Patterns

- **Heading hierarchy**: use level 1 once (document title), level 2 for major sections, level 3 for subsections
- **Section grouping**: wrap related content in a `Section` for page break control
- **Side-by-side content**: use `Columns` for comparisons, before/after, or multi-column layouts
- **Data presentation**: use `Table` for structured data, `Statistic` for key metrics
- **Readability**: alternate between Paragraphs, Tables, and Lists — avoid long runs of the same component

## Pitfalls

- Keep table column counts consistent across all rows
- Use Heading level 1 only once per document
- Group related content in Sections rather than flat at the root
- Include Header/Footer for professional documents
