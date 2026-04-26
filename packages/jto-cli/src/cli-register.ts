import { Command } from 'commander';
import {
  DocxFormatAdapter,
  PptxFormatAdapter,
  type FormatAdapter,
} from './format-adapter.js';
import { createGenerateCommand } from './commands/generate.js';
import { createValidateCommand } from './commands/validate.js';
import { createSchemasCommand } from './commands/schemas.js';
import { createDiscoverCommand } from './commands/discover.js';
import { createInitCommand } from './commands/init.js';
import { createFontsCommand } from './commands/fonts.js';

export interface RegisterOptions {
  /**
   * Extra per-format commands to mount alongside the core set.
   * Full `jto` uses this to inject the `dev` playground command without
   * forcing the lean CLI to depend on playground code.
   */
  extraCommands?: (adapter: FormatAdapter) => Command[];
}

function registerFormatCommands(
  parent: Command,
  adapter: FormatAdapter,
  extras?: (adapter: FormatAdapter) => Command[]
): void {
  parent.addCommand(createGenerateCommand(adapter));
  parent.addCommand(createValidateCommand(adapter));
  parent.addCommand(createSchemasCommand(adapter));
  parent.addCommand(createDiscoverCommand(adapter));
  parent.addCommand(createInitCommand(adapter));
  parent.addCommand(createFontsCommand(adapter));
  if (extras) {
    for (const cmd of extras(adapter)) parent.addCommand(cmd);
  }
}

/**
 * Attach the format-scoped `docx` and `pptx` subcommands (with all core CLI
 * commands) to a commander program. Callers wire their own name/version/help.
 */
export function registerCoreCommands(
  program: Command,
  options: RegisterOptions = {}
): Command {
  const docx = new Command('docx').description('DOCX document commands');
  registerFormatCommands(docx, new DocxFormatAdapter(), options.extraCommands);

  const pptx = new Command('pptx').description('PPTX presentation commands');
  registerFormatCommands(pptx, new PptxFormatAdapter(), options.extraCommands);

  program.addCommand(docx);
  program.addCommand(pptx);
  return program;
}
