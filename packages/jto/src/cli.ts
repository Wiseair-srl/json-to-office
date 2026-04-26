import { Command } from 'commander';
import chalk from 'chalk';
import { registerCoreCommands } from '@json-to-office/jto-cli';
import { createDevCommand } from './commands/dev.js';

declare const __PACKAGE_VERSION__: string | undefined;
const PACKAGE_VERSION =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : 'dev-mode';

const program = new Command();

program
  .name('jto')
  .description('JSON to Office CLI - Generate .docx and .pptx from JSON')
  .version(PACKAGE_VERSION);

registerCoreCommands(program, {
  extraCommands: (adapter) => [createDevCommand(adapter)],
});

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
  $ jto docx fonts install Inter    ${chalk.dim('# Download a Google Font into ./fonts')}
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
