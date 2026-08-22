/**
 * The DOCX parity corpus.
 *
 * One list of documents, assembled from per-area files, used to record golden
 * package hashes from the pipeline as it stands and to check whatever replaces
 * it. Splitting by area keeps each file readable; concatenating here means the
 * goldens and the tests can never see a different corpus.
 *
 * Every document must be deterministic — generation pins ZIP and core metadata
 * timestamps — so one SHA-256 per case describes the whole package.
 */

import type { CorpusCase } from './corpus-types';
import { CASES as ANNOTATIONS } from './corpus-annotations';
import { CASES as BLOCKS } from './corpus-blocks';
import { CASES as HEADINGS } from './corpus-headings';
import { CASES as LINKS } from './corpus-links';
import { CASES as LISTS } from './corpus-lists';
import { CASES as STRUCTURE } from './corpus-structure';
import { CASES as TABLES } from './corpus-tables';
import { CASES as TEXT } from './corpus-text';
import { CASES as THEME } from './corpus-theme';

export type { CorpusCase };

export const CORPUS: CorpusCase[] = [
  ...TEXT,
  ...STRUCTURE,
  ...HEADINGS,
  ...LISTS,
  ...LINKS,
  ...TABLES,
  ...BLOCKS,
  ...ANNOTATIONS,
  ...THEME,
];
