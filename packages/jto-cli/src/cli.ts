import { Command } from 'commander';
import chalk from 'chalk';
import { registerCoreCommands } from './cli-register.js';

declare const __PACKAGE_VERSION__: string | undefined;
const PACKAGE_VERSION =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : 'dev-mode';

const program = new Command();

program
  .name('jto-cli')
  .description(
    'JSON to Office lightweight CLI - Generate .docx and .pptx from JSON'
  )
  .version(PACKAGE_VERSION);

registerCoreCommands(program);

program.addHelpText(
  'after',
  `
${chalk.gray('Examples:')}
  $ jto-cli docx generate doc.json      ${chalk.dim('# Generate DOCX from JSON')}
  $ jto-cli pptx generate slides.json   ${chalk.dim('# Generate PPTX from JSON')}
  $ jto-cli pptx validate slides.json   ${chalk.dim('# Validate PPTX JSON')}
  $ jto-cli docx schemas                ${chalk.dim('# Export DOCX JSON schemas')}
  $ jto-cli pptx discover               ${chalk.dim('# Discover PPTX plugins')}
  $ jto-cli docx fonts install Inter    ${chalk.dim('# Download a Google Font into ./fonts')}

${chalk.gray('Need the web playground?')} install ${chalk.bold('@json-to-office/jto')} for the full CLI with ${chalk.bold('jto docx dev')} / ${chalk.bold('jto pptx dev')}.
`
);

// Register a hidden `dev` placeholder per format so `jto-cli docx dev` /
// `jto-cli pptx dev` print a helpful pointer at the playground-bearing
// package instead of commander's generic "unknown command" error.
function registerDevHint(parent: Command): void {
  parent.addCommand(
    new Command('dev')
      .description('(unavailable in jto-cli — install @json-to-office/jto)')
      .helpOption(false)
      .allowUnknownOption(true)
      .action(() => {
        console.error(
          chalk.yellow(
            '\n`dev` requires the web playground, which is not included in @json-to-office/jto-cli.\n'
          ) +
            `Install ${chalk.bold('@json-to-office/jto')} to enable ${chalk.bold('jto docx dev')} / ${chalk.bold('jto pptx dev')}.\n`
        );
        process.exit(1);
      }),
    { hidden: true }
  );
}
for (const sub of program.commands) registerDevHint(sub);

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
