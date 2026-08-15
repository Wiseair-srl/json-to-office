import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'json-to-office',
  description:
    'Generate professional .docx and .pptx files from JSON definitions. Documents as data, not code.',
  lang: 'en-US',
  lastUpdated: true,
  ignoreDeadLinks: false,

  // fonts.md predates the docs site and is kept for README links;
  // its content lives at /guide/fonts on the site.
  srcExclude: ['fonts.md'],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/what-is-json-to-office' },
      {
        text: 'Reference',
        items: [
          { text: 'DOCX', link: '/reference/docx/document' },
          { text: 'PPTX', link: '/reference/pptx/presentation' },
          { text: 'Themes', link: '/reference/theme-schema' },
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Library API', link: '/reference/api' },
        ],
      },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'Playgrounds',
        items: [
          { text: 'DOCX Playground', link: 'https://docx.json-to-office.com' },
          { text: 'PPTX Playground', link: 'https://pptx.json-to-office.com' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            {
              text: 'What is json-to-office?',
              link: '/guide/what-is-json-to-office',
            },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Core concepts', link: '/guide/core-concepts' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Authoring',
          items: [
            { text: 'Writing Word documents', link: '/guide/writing-docx' },
            { text: 'Writing presentations', link: '/guide/writing-pptx' },
            { text: 'Themes & styling', link: '/guide/themes' },
            { text: 'Fonts', link: '/guide/fonts' },
            { text: 'Charts', link: '/guide/charts' },
          ],
        },
        {
          text: 'Tooling',
          items: [
            { text: 'The visual playground', link: '/guide/playground' },
            { text: 'CLI workflows', link: '/guide/cli' },
            { text: 'Validation', link: '/guide/validation' },
          ],
        },
        {
          text: 'Going further',
          items: [
            {
              text: 'Render server & deployment',
              link: '/guide/render-server',
            },
            { text: 'Using with LLMs', link: '/guide/llms' },
            { text: 'Contributing', link: '/guide/contributing' },
          ],
        },
      ],

      '/reference/': [
        {
          text: 'DOCX reference',
          items: [
            { text: 'Document root', link: '/reference/docx/document' },
            { text: 'Components', link: '/reference/docx/components' },
          ],
        },
        {
          text: 'PPTX reference',
          items: [
            { text: 'Presentation root', link: '/reference/pptx/presentation' },
            { text: 'Slides & grid', link: '/reference/pptx/slides-and-grid' },
            { text: 'Components', link: '/reference/pptx/components' },
            { text: 'Charts', link: '/reference/pptx/charts' },
          ],
        },
        {
          text: 'Shared reference',
          items: [
            { text: 'Theme schema', link: '/reference/theme-schema' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Library API', link: '/reference/api' },
            { text: 'JSON Schemas', link: '/reference/json-schemas' },
          ],
        },
      ],

      '/examples/': [
        {
          text: 'Examples',
          items: [{ text: 'Overview', link: '/examples/' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Wiseair-srl/json-to-office' },
      {
        icon: 'npm',
        link: 'https://www.npmjs.com/package/@json-to-office/json-to-docx',
      },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/Wiseair-srl/json-to-office/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Wiseair srl',
    },

    outline: { level: [2, 3] },
  },
});
