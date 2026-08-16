---
'@json-to-office/jto': minor
---

Align the playground UI with the Wiseair design system.

The playground now runs on the Banani tokens from `wiseair-mono/apps/dashboard`.
Light is the cool-grey enterprise surface (canvas `#f4f6f9`, white panels,
`#e2e6ed` hairlines, Brand Slate `#383F5D` primary, `#546f9c` secondary text).
Dark is a surface ramp rather than one flat near-black — canvas `#1D2130` → card
`#282c3e` → subtle fill `#3b4054` → border `#494e65`, over a recessed `#10141e`
sidebar rail — so cards, popovers and muted fills stay distinguishable from each
other. Also: the 2/4/6/10px radius ladder, the dense 11/13/14/16/20/24/30/36
type scale, and self-hosted Inter in place of Geist (dropping a render-blocking
Google Fonts request).

Ad-hoc Tailwind palette colors scattered across the sidebar, warnings panel,
preview status bar and schema viewer are gone; document and theme states now use
the system's own vocabulary (`success`, `warning`, `destructive`, `data-blue`,
`accent2`, `header-bg`, `sidebar-accent`) with the dashboard's soft-wash callout
recipe, so they read as one system in both themes.

Components follow the same recipes: flat surfaces separated by hairlines rather
than shadows, 2px-cornered controls, 4px badges, 6px floating overlays. The
Monaco editor gets `jto-light` / `jto-dark` themes so the editor pane is painted
from the same surface tokens as the rest of the shell instead of stock white /
`#1E1E1E`.
