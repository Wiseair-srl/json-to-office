import { Command } from 'commander';
import chalk from 'chalk';
import { DocxFormatAdapter, PptxFormatAdapter, type FormatAdapter } from './format-adapter.js';
import { createGenerateCommand } from './commands/generate.js';
import { createValidateCommand } from './commands/validate.js';
import { createSchemasCommand } from './commands/schemas.js';
import { createDiscoverCommand } from './commands/discover.js';
import { createInitCommand } from './commands/init.js';
import { createDevCommand } from './commands/dev.js';

declare const __PACKAGE_VERSION__: string | undefined;
const PACKAGE_VERSION =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : 'dev-mode';

function registerFormatCommands(parent: Command, adapter: FormatAdapter): void {
  parent.addCommand(createGenerateCommand(adapter));
  parent.addCommand(createValidateCommand(adapter));
  parent.addCommand(createSchemasCommand(adapter));
  parent.addCommand(createDiscoverCommand(adapter));
  parent.addCommand(createInitCommand(adapter));
  parent.addCommand(createDevCommand(adapter));
}

const program = new Command();

program
  .name('jto')
  .description('JSON to Office CLI - Generate .docx and .pptx from JSON')
  .version(PACKAGE_VERSION);

// === DOCX subcommand ===
const docx = new Command('docx').description('DOCX document commands');
registerFormatCommands(docx, new DocxFormatAdapter());

// === PPTX subcommand ===
const pptx = new Command('pptx').description('PPTX presentation commands');
registerFormatCommands(pptx, new PptxFormatAdapter());

program.addCommand(docx);
program.addCommand(pptx);

program.addHelpText(
  'after',
  `
${chalk.gray('Examples:')}
  $ jto docx generate doc.json      ${chalk.dim('# Generate DOCX from JSON')}
  $ jto pptx generate slides.json   ${chalk.dim('# Generate PPTX from JSON')}
  $ jto docx dev                    ${chalk.dim('# Start DOCX dev server')}
  $ jto pptx validate slides.json   ${chalk.dim('# Validate PPTX JSON')}
  $ jto docx schemas                ${chalk.dim('# Export DOCX JSON schemas')}
  $ jto pptx discover               ${chalk.dim('# Discover PPTX plugins')}
`
);

program.exitOverride();

(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (error: any) {
    if (
      error.code === 'commander.version' ||
      error.code === 'commander.help' ||
      error.code === 'commander.helpDisplayed'
    ) {
      process.exit(0);
    }
    if (error.code === 'commander.executeSubCommandAsync') {
      process.exit(error.exitCode);
    }
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
})();
