export interface EnvironmentCleanerOptions {
  forceClean?: boolean;
  debug?: boolean;
  additionalVars?: string[];
}

export function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.CI === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}

export function isExplicitDebugMode(): boolean {
  const hasDebugArgs = process.argv.some(
    (arg) => arg.includes('--inspect') || arg.includes('--debug')
  );
  const hasDebugExecArgs = process.execArgv.some(
    (execArg) => execArg.includes('--inspect') || execArg.includes('--debug')
  );
  return hasDebugArgs || hasDebugExecArgs;
}

export function cleanNodeOptions(debug = false): string | undefined {
  if (!process.env.NODE_OPTIONS) return undefined;

  const original = process.env.NODE_OPTIONS;

  const countUnescaped = (str: string, ch: string) => {
    let count = 0;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (str[i] === '\\') { escaped = true; continue; }
      if (str[i] === ch) count++;
    }
    return count;
  };

  const dq = countUnescaped(original, '"');
  const sq = countUnescaped(original, '\'');
  if (dq % 2 === 1 || sq % 2 === 1) {
    console.warn('[WARN] Detected malformed NODE_OPTIONS. Removing.');
    return undefined;
  }

  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (escape) { current += ch; escape = false; continue; }
    if (ch === '\\') { current += ch; escape = true; continue; }
    if (ch === '\'' && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);

  const isDebuggerRelatedValue = (val: string) => {
    const lower = val.toLowerCase();
    return lower.includes('js-debug') || lower.includes('bootloader');
  };
  const shouldDropToken = (tok: string) => {
    const lower = tok.toLowerCase();
    return lower.includes('--inspect') || lower.includes('--debug') || isDebuggerRelatedValue(tok);
  };

  const filtered: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();

    if (lower === '--require' || lower === '-r') {
      const next = tokens[i + 1];
      if (!next) continue;
      if (isDebuggerRelatedValue(next)) { i++; continue; }
      filtered.push(tok, next);
      i++;
      continue;
    }
    if (lower.startsWith('--require=') || lower.startsWith('-r=')) {
      const eqIdx = tok.indexOf('=');
      const val = eqIdx >= 0 ? tok.substring(eqIdx + 1) : '';
      if (!val || isDebuggerRelatedValue(val)) continue;
      filtered.push(tok);
      continue;
    }

    if (shouldDropToken(tok)) continue;
    filtered.push(tok);
  }

  const cleanOptions = filtered.join(' ').trim();

  if (debug && cleanOptions !== original) {
    console.log('[DEBUG] Cleaned NODE_OPTIONS:', { original, cleaned: cleanOptions || '(empty)' });
  }

  return cleanOptions || undefined;
}

export const IDE_DEBUGGER_VARS = [
  'VSCODE_INSPECTOR_OPTIONS',
  'BUN_INSPECT_CONNECT_TO',
  'VSCODE_PID',
  'VSCODE_CWD',
  'VSCODE_IPC_HOOK',
  'VSCODE_IPC_HOOK_CLI',
  'VSCODE_HANDLES_UNCAUGHT_ERRORS',
  'ELECTRON_RUN_AS_NODE',
] as const;

export function removeDebuggerVars(
  vars: readonly string[] = IDE_DEBUGGER_VARS,
  _debug = false
): void {
  vars.forEach((varName) => { delete process.env[varName]; });
}

export function cleanDebuggerEnvironment(
  options: EnvironmentCleanerOptions = {}
): void {
  const { forceClean = false, debug = false, additionalVars = [] } = options;

  const isProduction = isProductionEnvironment();
  const isExplicitDebug = isExplicitDebugMode();
  const hasIDEDebuggerVars =
    !!process.env.VSCODE_INSPECTOR_OPTIONS ||
    !!process.env.BUN_INSPECT_CONNECT_TO;

  const shouldClean =
    forceClean || isProduction || (hasIDEDebuggerVars && !isExplicitDebug);

  if (!shouldClean) return;

  const cleanedNodeOptions = cleanNodeOptions(debug);
  if (cleanedNodeOptions === undefined) {
    delete process.env.NODE_OPTIONS;
  } else if (cleanedNodeOptions !== process.env.NODE_OPTIONS) {
    process.env.NODE_OPTIONS = cleanedNodeOptions;
  }

  const varsToRemove = [...IDE_DEBUGGER_VARS, ...additionalVars];
  removeDebuggerVars(varsToRemove, debug);
}

export function createCleanEnv(): NodeJS.ProcessEnv {
  const cleanEnv = { ...process.env };

  if (cleanEnv.NODE_OPTIONS) {
    const cleaned = cleanNodeOptions();
    if (cleaned) {
      cleanEnv.NODE_OPTIONS = cleaned;
    } else {
      delete cleanEnv.NODE_OPTIONS;
    }
  }

  IDE_DEBUGGER_VARS.forEach((varName) => { delete cleanEnv[varName]; });

  return cleanEnv;
}
