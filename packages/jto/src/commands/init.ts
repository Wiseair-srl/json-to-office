import { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import type { FormatAdapter } from '../format-adapter.js';
import { EXIT_CODES } from './ui.js';

interface InitOptions {
  template?: string;
  skipInstall?: boolean;
}

export function createInitCommand(adapter: FormatAdapter): Command {
  return new Command('init')
    .description(`Initialize a new json-to-${adapter.name} project`)
    .argument('[name]', 'Project name')
    .option('-t, --template <type>', 'Project template', 'basic')
    .option('--skip-install', 'Skip dependency installation')
    .action(async (name: string | undefined, options: InitOptions) => {
      try {
        if (!name) {
          try {
            // @ts-expect-error -- prompts lacks type declarations
            const prompts = (await import('prompts')).default;
            const response = await prompts({
              type: 'text',
              name: 'projectName',
              message: 'Project name:',
              initial: `my-json-to-${adapter.name}-project`,
            });
            name = response.projectName;
          } catch {
            name = `my-json-to-${adapter.name}-project`;
          }

          if (!name) {
            console.log(chalk.red('Project name is required'));
            process.exit(EXIT_CODES.FAIL);
          }
        }

        const projectPath = resolve(process.cwd(), name);

        if (existsSync(projectPath)) {
          console.error(chalk.red(`Directory ${name} already exists`));
          process.exit(EXIT_CODES.FAIL);
        }

        mkdirSync(projectPath, { recursive: true });

        const packageJson = {
          name,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: {
            dev: `jto ${adapter.name} dev`,
            generate: `jto ${adapter.name} generate`,
            validate: `jto ${adapter.name} validate`,
            schemas: `jto ${adapter.name} schemas`,
          },
          dependencies: {
            [`@json-to-office/json-to-${adapter.name}`]: 'latest',
          },
          devDependencies: {
            '@json-to-office/jto': 'latest',
            typescript: '^5.3.3',
          },
        };

        writeFileSync(
          join(projectPath, 'package.json'),
          JSON.stringify(packageJson, null, 2)
        );

        // Create example document based on format
        const exampleDocument =
          adapter.name === 'docx'
            ? {
              name: 'report',
              props: {
                title: 'Welcome to JSON-to-Office',
                subtitle: `Your ${adapter.label} generation project`,
                theme: 'minimal',
              },
              children: [
                {
                  name: 'heading',
                  props: { text: 'Welcome', level: 1 },
                },
                {
                  name: 'paragraph',
                  props: {
                    text: 'Edit example.json to customize your document.',
                  },
                },
              ],
            }
            : {
              name: 'presentation',
              props: {
                title: 'Welcome to JSON-to-Office',
              },
              children: [
                {
                  name: 'slide',
                  props: {},
                  children: [
                    {
                      name: 'text',
                      props: {
                        text: 'Welcome to JSON-to-Office',
                        x: 1,
                        y: 1,
                        w: 8,
                        h: 2,
                        fontSize: 36,
                      },
                    },
                  ],
                },
              ],
            };

        writeFileSync(
          join(projectPath, 'example.json'),
          JSON.stringify(exampleDocument, null, 2)
        );

        const gitignore = `node_modules\ndist\n.cache\n*${adapter.extension}\n.env\n.env.local\n`;
        writeFileSync(join(projectPath, '.gitignore'), gitignore);

        console.log(chalk.green(`\nCreated project at ${projectPath}\n`));

        if (!options.skipInstall) {
          const spinner = ora('Installing dependencies...').start();

          try {
            execSync('npm install', {
              cwd: projectPath,
              stdio: 'ignore',
            });
            spinner.succeed('Dependencies installed');
          } catch {
            spinner.fail('Failed to install dependencies');
            console.log(
              chalk.yellow(
                '\nRun `npm install` manually to install dependencies'
              )
            );
          }
        }

        const nextSteps = [
          `cd ${name}`,
          ...(options.skipInstall ? ['npm install'] : []),
          `jto ${adapter.name} generate example.json`,
        ];

        console.log(
          boxen(
            chalk.bold(`${name}\n\n`) +
            chalk.gray('Next steps:\n') +
            nextSteps.map((s) => chalk.cyan(`  $ ${s}`)).join('\n'),
            {
              padding: 1,
              borderColor: 'green',
              borderStyle: 'round',
              title: 'Project created',
              titleAlignment: 'center',
            }
          )
        );
      } catch (error: any) {
        console.error(chalk.red('Failed to create project:'), error.message);
        process.exit(EXIT_CODES.FAIL);
      }
    });
}
