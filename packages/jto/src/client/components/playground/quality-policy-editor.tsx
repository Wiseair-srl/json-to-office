import React, { useCallback, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTheme } from '../theme-provider';
import { cn } from '../../lib/utils';
import { FORMAT } from '../../lib/env';
import {
  EMPTY_POLICY_TEXT,
  parseQualityPolicy,
} from '../../lib/quality-policy';
import { QUALITY_POLICY_MODEL_PATH } from '../../lib/quality-policy-schema';
import { rulesForFormat } from '../../lib/quality-rules';
import { useSettingsStore } from '../../store/settings-store-provider';

/**
 * Hand-written run policy: per-rule severity, parameters, suppressions.
 *
 * A JSON editor rather than a row of controls, because the contract is wider
 * than a form would stay honest about — suppressions carry pointers and a
 * reason, and rule parameters differ per rule. The schema registered in
 * `monaco-config` gives completion over the real rule ids, so this is closer to
 * a guided form than a text box.
 */
export function QualityPolicyEditor({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const { resolvedTheme } = useTheme();
  const policies = useSettingsStore((s) => s.qualityPolicies);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const stored = policies?.[FORMAT];

  // The editor is uncontrolled after mount: re-feeding `value` on every
  // keystroke would fight the model and jump the cursor.
  const [text, setText] = useState(stored ?? EMPTY_POLICY_TEXT);
  const parsed = useMemo(() => parseQualityPolicy(text), [text]);
  const ruleIds = useMemo(() => rulesForFormat().map((rule) => rule.id), []);

  const commit = useCallback(
    (next: string) => {
      setText(next);
      // Persist the text, not the parsed policy: half-typed JSON is the normal
      // state of an editor and losing it on a reload would be worse than
      // carrying something the run will ignore until it parses.
      setSettings({ qualityPolicies: { ...policies, [FORMAT]: next } });
    },
    [policies, setSettings]
  );

  const reset = useCallback(() => commit(EMPTY_POLICY_TEXT), [commit]);

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-snug text-muted-foreground">
          Rule severity, parameters and suppressions. The gate and profile stay
          with their controls above.
        </span>
        <button
          type="button"
          onClick={reset}
          className={cn(
            'flex flex-shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5',
            'text-[11px] font-medium text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
          )}
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="overflow-hidden rounded-sm border">
        <Editor
          height="180px"
          language="json"
          path={QUALITY_POLICY_MODEL_PATH}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
          defaultValue={text}
          onChange={(value) => commit(value ?? '')}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            folding: false,
            scrollBeyondLastLine: false,
            fontSize: 11,
            lineHeight: 17,
            tabSize: 2,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            padding: { top: 8, bottom: 8 },
            automaticLayout: true,
          }}
        />
      </div>

      {parsed.ok ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {parsed.policy
            ? 'Applied to every analysis and build.'
            : 'Empty — the profile decides on its own.'}
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <AlertTriangle
            className="mt-0.5 h-3 w-3 flex-shrink-0"
            aria-hidden="true"
          />
          {/* An unusable policy is not sent, so the run keeps the last good one
              rather than failing every keystroke while it is being typed. */}
          <span>{parsed.error} Until this parses, the run ignores it.</span>
        </p>
      )}

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          Rules in this format
        </summary>
        <ul className="mt-1 space-y-0.5 pl-3">
          {ruleIds.map((id) => (
            <li key={id} className="font-mono text-[10px]">
              {id}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
