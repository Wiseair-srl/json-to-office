---
'@json-to-office/mcp-server': patch
---

The design-evals harness gains a judge, pairwise comparison and calibration. Private to the repo; the published server gains only the preview pipeline as a library export, which the harness renders through so that what a judge looks at is identical to what an author would have looked at.

`--judge <model>` renders the produced document the way `jto_preview` does, composes one contact sheet, and scores it against the five-level rubric — rendered, never from the JSON, because every question above level 3 is about what a reader sees. It answers the shipping question and rates genericness separately: moving design decisions into a house theme risks making every document look the same, and the scorecard should be able to see that rather than celebrate it as consistency. The rubric prompt is generated from the same table `taste-system.md` defines, so the judge and the rules cannot drift into measuring different things.

The verdict is evaluative and lives in its own object on the scorecard, so a taste change and a defect change stay distinguishable. A failed run is judged unshippable rather than left out — otherwise a phase improves its rate by producing fewer documents. A judge that throws loses the opinion and keeps the hard numbers.

Pairwise comparison exists because absolute scores drift: a judge that has seen forty mediocre decks grades the forty-first generously, and a delta made of two absolute scores inherits all of it. Which document is shown first is derived from the pair id rather than from which is newer, because a rater shown the new work in the same position every time learns the position.

Calibration assembles development-corpus pairs into a rating sheet with the human column blank and the judge's own answer beside it, then reports raw agreement, Cohen's kappa and a percentile bootstrap interval from a seeded PRNG — so "run it again" is not an argument against the number. Unrated pairs are dropped and counted rather than averaged towards whichever answer is convenient. Kappa is reported because agreeing 90% of the time on a corpus that is 90% unshippable is what chance would have done anyway; it comes back as NaN when a rater never varies, rather than as a flattering zero.

`--repeat <n>` runs each brief more than once, which is how run variance at final acceptance becomes visible instead of averaged.

Recording the two baselines — server 2.0.0 cold and skill 3.1.0 assisted — and replacing the spec's estimated "today" column with measured values needs a live run with an API key, and is the one step of this ticket that cannot be done from the repo.
