/**
 * `jto-mcp` — the stdio entry point.
 *
 * stdout is the protocol. Nothing here writes to it except `--version` and
 * `--help`, both of which exit before a transport exists; the transport
 * failures the SDK hands us go to stderr, and everything a document or a
 * render has to say goes back in the tool result that asked. A single stray
 * `console.log` anywhere in this process desynchronizes the client's framing,
 * which is why the argument parser below is fifteen lines of hand-rolled code
 * rather than commander: fewer things in the graph, fewer things that print.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServerFactory } from './server.js';
import { createToolDeps } from './lib/deps.js';
import { OUTPUT_DIR_ENV } from './lib/output-root.js';
import { SERVER_VERSION } from './lib/version.js';

interface ParsedArgs {
  outputDir?: string;
  version: boolean;
  help: boolean;
  unknown: string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { version: false, help: false, unknown: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version' || arg === '-v') {
      parsed.version = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--output-dir') {
      parsed.outputDir = argv[++index];
    } else if (arg.startsWith('--output-dir=')) {
      parsed.outputDir = arg.slice('--output-dir='.length);
    } else {
      parsed.unknown.push(arg);
    }
  }
  return parsed;
}

const HELP = `jto-mcp — Model Context Protocol server for @json-to-office

Usage:
  jto-mcp [options]

Speaks MCP over stdio; it is started by an MCP client, not run interactively.

Options:
  --output-dir <path>  Directory generated files are written to. Overrides
                       ${OUTPUT_DIR_ENV}. Defaults to a per-connection
                       directory under the system temp dir.
  -v, --version        Print the version and exit.
  -h, --help           Print this help and exit.

Environment:
  ${OUTPUT_DIR_ENV}    Output root, when --output-dir is absent.
  LIBREOFFICE_PATH      LibreOffice binary, for preview.
  PDFTOPPM_PATH         poppler pdftoppm binary, for preview.

Client configuration:
  { "mcpServers": { "json-to-office": { "command": "npx",
      "args": ["-y", "@json-to-office/mcp-server"] } } }
`;

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);

  // The only writes to stdout in this process, and both are followed by exit.
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (args.unknown.length > 0) {
    process.stderr.write(
      `jto-mcp: unknown argument ${args.unknown[0]}\nRun jto-mcp --help.\n`
    );
    process.exitCode = 1;
    return;
  }

  const deps = createToolDeps({
    ...(args.outputDir !== undefined && { outputDir: args.outputDir }),
  });

  // No diagnostic sink is installed here. `jto-ops` emits its warnings
  // (unresolved fonts, unknown themes) through an AsyncLocalStorage sink, and
  // a sink scoped around this function would be off the stack by the time the
  // first request arrives on a later turn of the loop — it looked like a
  // connection-wide fallback and caught nothing. `guarded` scopes one per tool
  // call instead, where the warnings can be folded into the result the agent
  // actually reads.
  const handle = serveStdio(createServerFactory(deps), {
    legacy: 'serve',
    onerror: (error) => {
      process.stderr.write(`jto-mcp: ${error.stack ?? error.message}\n`);
    },
  });

  // Close the transport but leave the output root alone: the paths this
  // connection handed back are the whole point of `outputMode: 'path'`, and a
  // user opening the .docx after the client disconnects would find it gone.
  // Temp roots are the OS's to reap.
  const shutdown = (): void => {
    void handle.close().catch(() => undefined);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main(process.argv.slice(2));
