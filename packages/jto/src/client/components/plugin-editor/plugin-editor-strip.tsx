import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download as DownloadIcon,
  Globe,
  Info,
  Puzzle,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useToast } from '../ui/use-toast';
import { useBrowserPluginsStore } from '../../store/browser-plugins-store';
import { pluginHost } from '../../lib/plugins/host';
import { compileQueue } from '../../lib/plugins/compile-queue';
import { parseNetworkOrigins } from '../../lib/plugins/network-policy';
import {
  onPluginTypeScriptReady,
  pluginTypeScriptReady,
} from '../../lib/plugins/type-libs';
import { download } from '../../lib/download';
import { cn } from '../../lib/utils';
import { BROWSER_PLUGINS_CHANGED_EVENT } from '../../hooks/useBrowserPluginsSync';
import { PLUGIN_FILE_SUFFIX } from '../../store/documents-store';

/** True once the plugin API declarations are in Monaco's TypeScript. */
function usePluginTypesReady(): boolean {
  const [ready, setReady] = useState(pluginTypeScriptReady);
  useEffect(() => onPluginTypeScriptReady(() => setReady(true)), []);
  return ready;
}

/**
 * The bar above a plugin's source: what it is called, whether it compiled,
 * and the two switches that decide how it takes part — enabled at all, and
 * allowed to reach the network from its sandbox.
 */
export function PluginEditorStrip({
  docName,
  text,
}: {
  docName: string;
  text: string;
}) {
  const record = useBrowserPluginsStore((s) => s.records[docName]);
  const setEnabled = useBrowserPluginsStore((s) => s.setEnabled);
  const setAllowNetwork = useBrowserPluginsStore((s) => s.setAllowNetwork);
  const setNetworkOrigins = useBrowserPluginsStore((s) => s.setNetworkOrigins);
  const { toast } = useToast();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const typesReady = usePluginTypesReady();

  const metadata = record?.metadata;
  const status = record?.status ?? 'idle';
  const errorCount = (record?.diagnostics ?? []).filter(
    (d) => d.severity === 'error'
  ).length;
  const displayName =
    metadata?.name ??
    docName.replace(new RegExp(`${PLUGIN_FILE_SUFFIX}$`, 'i'), '');
  const examples = metadata?.examples ?? [];

  const announce = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(BROWSER_PLUGINS_CHANGED_EVENT, { detail: { docName } })
    );
  }, [docName]);

  const toggleEnabled = useCallback(
    (enabled: boolean) => {
      setEnabled(docName, enabled);
      announce();
    },
    [announce, docName, setEnabled]
  );

  // The sandbox is hardened once, when it loads, and its CSP is fixed when
  // the frame is written: a new setting needs a new frame. Compile again as
  // well — a plugin that failed to load because it reached for the network is
  // only known to work, or not, once it has loaded under the new setting.
  const recompileUnderNewPolicy = useCallback(() => {
    pluginHost.dispose(docName);
    useBrowserPluginsStore.getState().upsert(docName, { status: 'idle' });
    void compileQueue.run(docName);
  }, [docName]);

  const toggleNetwork = useCallback(
    (allowNetwork: boolean) => {
      setAllowNetwork(docName, allowNetwork);
      recompileUnderNewPolicy();
    },
    [docName, recompileUnderNewPolicy, setAllowNetwork]
  );

  const commitOrigins = useCallback(
    (origins: string[]) => {
      setNetworkOrigins(docName, origins);
      recompileUnderNewPolicy();
    },
    [docName, recompileUnderNewPolicy, setNetworkOrigins]
  );

  const copyExample = useCallback(
    async (index: number) => {
      const example = examples[index];
      if (!example || !metadata) return;
      const usage = JSON.stringify(
        { name: metadata.name, props: example.props },
        null,
        2
      );
      try {
        await navigator.clipboard.writeText(usage);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1500);
      } catch {
        toast({
          title: 'Clipboard unavailable',
          description: 'Could not copy the example to the clipboard.',
          variant: 'destructive',
        });
      }
    },
    [examples, metadata, toast]
  );

  const statusChip = (() => {
    if (!typesReady && status !== 'ready' && status !== 'error') {
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="sm" />
          Loading types…
        </span>
      );
    }
    switch (status) {
      case 'compiling':
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="sm" />
            Compiling…
          </span>
        );
      case 'ready':
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Ready
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-destructive"
            />
            {errorCount > 0
              ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
              : 'Failed'}
          </span>
        );
      default:
        return (
          <span className="text-xs text-muted-foreground">Not compiled</span>
        );
    }
  })();

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar px-3">
      <Puzzle className="size-3.5 shrink-0 text-sidebar-foreground/60" />
      <span className="truncate text-[13px] font-medium">{displayName}</span>
      {metadata?.latest && (
        <Badge variant="outline" className="h-4 px-1.5 font-mono text-[10px]">
          v{metadata.latest}
        </Badge>
      )}
      <span className="mx-1 h-4 w-px bg-border/60" />
      {statusChip}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="How plugins run"
            className="inline-flex size-6 cursor-help items-center justify-center rounded-sm hover:bg-muted/60"
          >
            <Info className="size-3.5 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <p className="text-sm">
            Compiled in your browser and run in a worker inside a sandboxed
            frame with its own origin: no page, no cookies, no storage, and
            nothing on the network it has not been given. The server only ever
            receives the standard components it produces.
          </p>
          <p className="mt-2 text-sm">
            Network is per host. A plugin allowed to call a host can also load
            code from it and send it anything it renders, so list only hosts you
            would trust with the document.
          </p>
        </TooltipContent>
      </Tooltip>

      <span className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={examples.length === 0}
            title={
              examples.length === 0
                ? 'Add a JSDoc @example with a JSON block to list usage examples here'
                : undefined
            }
          >
            <BookOpen className="size-3.5" />
            Examples
            {examples.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {examples.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Copy as component JSON
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {examples.map((example, index) => (
            <DropdownMenuItem
              key={index}
              onClick={(event) => {
                event.preventDefault();
                void copyExample(index);
              }}
              className="gap-2"
            >
              {copiedIndex === index ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5 text-muted-foreground" />
              )}
              <span className="truncate">
                {example.title ?? `Example ${index + 1}`}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <label
        htmlFor={`plugin-enabled-${docName}`}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-xs',
          record?.enabled ? 'text-foreground' : 'text-muted-foreground'
        )}
        title="On: the component is offered in completions and expanded in every build. Off: a document that still names it fails to build with a message pointing here."
      >
        Enabled
        <Switch
          id={`plugin-enabled-${docName}`}
          checked={record?.enabled ?? true}
          onCheckedChange={toggleEnabled}
          aria-label="Enable plugin"
        />
      </label>
      <NetworkControl
        docName={docName}
        allowNetwork={record?.allowNetwork ?? false}
        origins={record?.networkOrigins ?? []}
        onToggle={toggleNetwork}
        onCommitOrigins={commitOrigins}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Download plugin source"
            onClick={() =>
              download(docName, new Blob([text], { type: 'text/typescript' }))
            }
          >
            <DownloadIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Download <code>{docName}</code> to use it on disk with the CLI
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export const PluginEditorStripMemoized = React.memo(PluginEditorStrip);

/**
 * The Network control: a switch, and the hosts the switch grants.
 *
 * The switch alone reaches nothing. That is the point — "on" used to mean the
 * whole internet, which made it a grant nobody could reason about: a plugin
 * that may call anywhere may also fetch code and run it, so reading its source
 * stops telling you what it does. Naming the hosts keeps the decision one an
 * author can actually make.
 */
function NetworkControl({
  docName,
  allowNetwork,
  origins,
  onToggle,
  onCommitOrigins,
}: {
  docName: string;
  allowNetwork: boolean;
  origins: string[];
  onToggle: (allowNetwork: boolean) => void;
  onCommitOrigins: (origins: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => origins.join('\n'));

  // The field trails the record while it is closed; opening re-seeds it so a
  // rename or an edit from elsewhere is not overwritten by a stale draft.
  useEffect(() => {
    if (!open) setDraft(origins.join('\n'));
  }, [open, origins]);

  const parsed = parseNetworkOrigins(draft);
  const granted = allowNetwork && origins.length > 0;
  const label = !allowNetwork
    ? 'Network off'
    : origins.length === 0
      ? 'Network on, no hosts listed'
      : `Network: ${origins.join(', ')}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-xs',
            'transition-colors hover:bg-muted/60',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            granted ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <Globe className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Network</span>
          {granted && (
            <Badge
              variant="outline"
              className="h-4 px-1 font-mono text-[10px] tabular-nums"
            >
              {origins.length}
            </Badge>
          )}
          {allowNetwork && origins.length === 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-500">
              no hosts
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <label
          htmlFor={`plugin-network-${docName}`}
          className="flex cursor-pointer items-center justify-between gap-2"
        >
          <span className="text-sm font-medium">Allow network</span>
          <Switch
            id={`plugin-network-${docName}`}
            checked={allowNetwork}
            onCheckedChange={onToggle}
            aria-label="Allow network access"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Off: <code>fetch</code>, <code>XMLHttpRequest</code>,{' '}
          <code>WebSocket</code> and <code>EventSource</code> throw inside the
          sandbox. On: only the hosts below are reachable — everything else is
          refused by the browser, not by the plugin.
        </p>
        {allowNetwork && (
          <>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => onCommitOrigins(parsed.origins)}
              spellCheck={false}
              rows={3}
              aria-label="Hosts this plugin may call"
              placeholder={'api.open-meteo.com\ngeocoding-api.open-meteo.com'}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              One host per line. <code>https</code> is assumed;{' '}
              <code>*.example.com</code> matches subdomains.
            </p>
            {parsed.errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive">
                {parsed.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {parsed.errors.length === 0 && parsed.origins.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Nothing listed, so nothing is reachable.
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
