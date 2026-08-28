import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FormatAdapter } from '@json-to-office/jto-ops';
import {
  formatError,
  promptText,
  renderLines,
  runTask,
  EXIT_CODES,
} from './ui.js';
import { exitAfterFlush } from './exit.js';

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
          name = await promptText(
            'Project name:',
            `my-json-to-${adapter.name}-project`
          );
        }
        if (!name) throw new Error('Project name is required');

        const projectName = name;
        const projectPath = resolve(process.cwd(), projectName);
        const result = await runTask(
          'Creating project...',
          async (reporter) => {
            if (existsSync(projectPath)) {
              throw new Error(`Directory ${projectName} already exists`);
            }
            mkdirSync(projectPath, { recursive: true });

            writeFileSync(
              join(projectPath, 'package.json'),
              JSON.stringify(
                {
                  name: projectName,
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
                },
                null,
                2
              )
            );

            const exampleDocument =
              adapter.name === 'docx'
                ? {
                    name: 'docx',
                    props: {
                      title: 'Welcome to JSON-to-Office',
                      subtitle: `Your ${adapter.label} generation project`,
                      theme: 'minimal',
                    },
                    children: [
                      { name: 'heading', props: { text: 'Welcome', level: 1 } },
                      {
                        name: 'paragraph',
                        props: {
                          text: 'Edit example.json to customize your document.',
                        },
                      },
                    ],
                  }
                : {
                    name: 'pptx',
                    props: { title: 'Welcome to JSON-to-Office' },
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
            writeFileSync(
              join(projectPath, '.gitignore'),
              `node_modules\ndist\n.cache\n*${adapter.extension}\n.env\n.env.local\n`
            );

            let installed = false;
            if (!options.skipInstall) {
              reporter.update('Installing dependencies with pnpm...');
              try {
                execFileSync('pnpm', ['install'], {
                  cwd: projectPath,
                  stdio: 'ignore',
                });
                installed = true;
              } catch {
                reporter.log(
                  'Dependency install failed. Run `pnpm install` manually.',
                  'warning'
                );
              }
            }
            return { installed };
          },
          {
            success: 'Project created',
            failure: 'Project creation failed',
          }
        );

        await renderLines([
          { text: projectPath, tone: 'success' },
          { text: 'Next steps:', tone: 'muted' },
          { text: `  cd ${projectName}`, tone: 'info' },
          ...(!result.installed
            ? [{ text: '  pnpm install', tone: 'info' as const }]
            : []),
          { text: `  jto ${adapter.name} generate example.json`, tone: 'info' },
        ]);
      } catch (error: any) {
        await formatError(error);
        await exitAfterFlush(EXIT_CODES.FAIL);
      }
    });
}
