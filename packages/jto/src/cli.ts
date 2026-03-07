import { Command } from 'commander';
import chalk from 'chalk';

declare const __PACKAGE_VERSION__: string | undefined;
const PACKAGE_VERSION =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : 'dev-mode';

const program = new Command();

program
  .name('jto')
  .description('JSON to Office CLI - Generate .docx and .pptx from JSON')
  .version(PACKAGE_VERSION);

// === DOCX subcommand ===
const docx = new Command('docx').description('DOCX document commands');

docx
  .command('generate <input>')
  .description('Generate a .docx file from JSON')
  .option('-o, --output <path>', 'Output file path')
  .option('-t, --theme <path>', 'Theme file path')
  .action(async (input, options) => {
    console.log(chalk.blue('Generating DOCX from'), input);
    // Phase 2: wire up actual generation
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

docx
  .command('validate <input>')
  .description('Validate a JSON document or theme')
  .option('--type <type>', 'Type to validate: document or theme', 'document')
  .action(async (input, options) => {
    console.log(chalk.blue('Validating'), input, `(${options.type})`);
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

docx
  .command('schemas')
  .description('Generate JSON schemas')
  .option('-o, --output <dir>', 'Output directory')
  .action(async (options) => {
    console.log(chalk.blue('Generating DOCX schemas'));
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

docx
  .command('dev')
  .description('Start development server with web UI')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (options) => {
    console.log(chalk.blue('Starting DOCX dev server on port'), options.port);
    console.log(chalk.gray('(not yet implemented — Phase 3)'));
  });

docx
  .command('init [name]')
  .description('Create a new json-to-docx project')
  .action(async (name) => {
    console.log(chalk.blue('Initializing DOCX project'), name || '');
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

docx
  .command('discover')
  .description('Discover custom plugins')
  .action(async () => {
    console.log(chalk.blue('Discovering DOCX plugins'));
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

// === PPTX subcommand ===
const pptx = new Command('pptx').description('PPTX presentation commands');

pptx
  .command('generate <input>')
  .description('Generate a .pptx file from JSON')
  .option('-o, --output <path>', 'Output file path')
  .option('-t, --theme <path>', 'Theme file path')
  .action(async (input, options) => {
    console.log(chalk.blue('Generating PPTX from'), input);
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

pptx
  .command('validate <input>')
  .description('Validate a JSON presentation or theme')
  .option('--type <type>', 'Type to validate: document or theme', 'document')
  .action(async (input, options) => {
    console.log(chalk.blue('Validating'), input, `(${options.type})`);
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

pptx
  .command('schemas')
  .description('Generate JSON schemas')
  .option('-o, --output <dir>', 'Output directory')
  .action(async (options) => {
    console.log(chalk.blue('Generating PPTX schemas'));
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

pptx
  .command('dev')
  .description('Start development server with web UI')
  .option('-p, --port <port>', 'Port number', '3001')
  .action(async (options) => {
    console.log(chalk.blue('Starting PPTX dev server on port'), options.port);
    console.log(chalk.gray('(not yet implemented — Phase 3)'));
  });

pptx
  .command('init [name]')
  .description('Create a new json-to-pptx project')
  .action(async (name) => {
    console.log(chalk.blue('Initializing PPTX project'), name || '');
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

pptx
  .command('discover')
  .description('Discover custom plugins')
  .action(async () => {
    console.log(chalk.blue('Discovering PPTX plugins'));
    console.log(chalk.gray('(not yet implemented — Phase 2)'));
  });

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
