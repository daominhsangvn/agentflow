"use client";

import {
  ClaudeCodeVersionChannel,
  type ComputeTargetModelProvider,
  claudeCodeVersionSchema,
  countPemCertificates,
  type ModelProviderCaCertificate,
  ModelProviderMode,
  modelProviderCaCertificateSchema,
  type UpdateComputeTargetModelProviderInput,
} from "@repo/api/src/types/compute-target-model-provider";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import {
  useComputeTargetModelProvider,
  useUpdateComputeTargetModelProvider,
} from "../hooks/use-compute-target-model-provider";
import {
  type ImportedModelProvider,
  importClaudeSettings,
} from "../lib/model-provider-import";

export type ModelProviderDialogProps = {
  computeTargetId: string;
  machineName: string;
  onClose: () => void;
};

/**
 * Which endpoint Claude Code uses for loops on one computer: its own Claude
 * account, or an Anthropic-compatible API (DeepSeek, a proxy, ...) with a
 * token, a default model and extra Claude Code variables. AgentFlow keeps
 * the token sealed and sends the settings with each loop; nothing is written
 * to the computer's Claude configuration. Mount it only while open.
 */
export function ModelProviderDialog({
  computeTargetId,
  machineName,
  onClose,
}: Readonly<ModelProviderDialogProps>) {
  const provider = useComputeTargetModelProvider(computeTargetId, {
    enabled: true,
  });
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Model provider · {machineName}</DialogTitle>
          <DialogDescription>
            Which API Claude Code uses for loops on this computer.
          </DialogDescription>
        </DialogHeader>
        {provider.data ? (
          <ModelProviderForm
            computeTargetId={computeTargetId}
            initial={provider.data}
            onClose={onClose}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {provider.error ? provider.error.message : "Loading…"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type EnvRow = { key: string; value: string };

function ModelProviderForm({
  computeTargetId,
  initial,
  onClose,
}: Readonly<{
  computeTargetId: string;
  initial: ComputeTargetModelProvider;
  onClose: () => void;
}>) {
  const update = useUpdateComputeTargetModelProvider(computeTargetId);
  const [mode, setMode] = useState(initial.mode);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [env, setEnv] = useState<EnvRow[]>(
    Object.entries(initial.env).map(([key, value]) => ({ key, value }))
  );
  // Undefined: keep the stored certificate. Null: remove it.
  const [caCertificate, setCaCertificate] = useState<
    ModelProviderCaCertificate | null | undefined
  >(undefined);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [claudeCodeVersion, setClaudeCodeVersion] = useState(
    initial.claudeCodeVersion
  );
  const isCustom = mode === ModelProviderMode.Custom;
  // A blank field means the default, the latest release.
  const version = claudeCodeVersionSchema.safeParse(
    claudeCodeVersion.trim() || ClaudeCodeVersionChannel.Latest
  );

  const handleImport = () => {
    const imported = importClaudeSettings(importText);
    if ("error" in imported) {
      setImportMessage(imported.error);
      return;
    }
    setMode(ModelProviderMode.Custom);
    setBaseUrl(imported.baseUrl ?? baseUrl);
    setModel(imported.model ?? model);
    if (imported.token) {
      setToken(imported.token);
      setClearToken(false);
    }
    setEnv(imported.env);
    setImportText("");
    setImportMessage(importSummary(imported));
  };

  const handleSave = () => {
    update.mutate(toInput(), { onSuccess: onClose });
  };

  const toInput = (): UpdateComputeTargetModelProviderInput => {
    const input: UpdateComputeTargetModelProviderInput = {
      mode,
      baseUrl: isCustom ? baseUrl.trim() || null : null,
      model: isCustom ? model.trim() || null : null,
      env: isCustom
        ? Object.fromEntries(
            env
              .filter((row) => row.key.trim())
              .map((row) => [row.key.trim(), row.value])
          )
        : {},
      claudeCodeVersion: version.data ?? ClaudeCodeVersionChannel.Latest,
    };
    if (clearToken) {
      input.token = null;
    } else if (token.trim()) {
      input.token = token.trim();
    }
    if (isCustom && caCertificate !== undefined) {
      input.caCertificate = caCertificate;
    }
    return input;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="model-provider-mode">Provider</Label>
        <Select
          onValueChange={(value) => setMode(value as typeof mode)}
          value={mode}
        >
          <SelectTrigger className="w-full" id="model-provider-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ModelProviderMode.Machine}>
              Claude account on this computer
            </SelectItem>
            <SelectItem value={ModelProviderMode.Custom}>
              Anthropic-compatible API (DeepSeek, a proxy, …)
            </SelectItem>
          </SelectContent>
        </Select>
        {isCustom ? null : (
          <p className="text-muted-foreground text-xs">
            Loops use the credential configured on the computer: a
            <code> claude </code> login, <code>claude setup-token</code> or
            ANTHROPIC_API_KEY. System Check shows whether one is present.
          </p>
        )}
      </div>

      {isCustom ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="model-provider-import">
              Import from Claude settings.json (optional)
            </Label>
            <Textarea
              className="font-mono text-xs"
              id="model-provider-import"
              onChange={(event) => setImportText(event.target.value)}
              placeholder={
                '{ "env": { "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic", … } }'
              }
              rows={3}
              value={importText}
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={!importText.trim()}
                onClick={handleImport}
                size="sm"
                type="button"
                variant="outline"
              >
                Import
              </Button>
              {importMessage ? (
                <span className="text-muted-foreground text-xs">
                  {importMessage}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="model-provider-base-url">Base URL</Label>
              <Input
                id="model-provider-base-url"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.deepseek.com/anthropic"
                value={baseUrl}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-provider-token">Auth token</Label>
              <Input
                autoComplete="off"
                id="model-provider-token"
                onChange={(event) => {
                  setToken(event.target.value);
                  setClearToken(false);
                }}
                placeholder={tokenPlaceholder(initial, clearToken)}
                type="password"
                value={token}
              />
              {initial.token.isSet && !clearToken ? (
                <button
                  className="text-muted-foreground text-xs underline"
                  onClick={() => {
                    setClearToken(true);
                    setToken("");
                  }}
                  type="button"
                >
                  Remove the stored token
                </button>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-provider-model">Default model</Label>
              <Input
                id="model-provider-model"
                onChange={(event) => setModel(event.target.value)}
                placeholder="deepseek-chat"
                value={model}
              />
              <p className="text-muted-foreground text-xs">
                Used for the main model, Opus, Sonnet, Haiku and subagents
                unless a variable below sets one.
              </p>
            </div>
          </div>

          <CaCertificateField
            onChange={setCaCertificate}
            stored={initial.caCertificate}
            value={caCertificate}
          />

          <EnvRows onChange={setEnv} rows={env} />
        </>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="model-provider-claude-code-version">
          Claude Code version
        </Label>
        <Input
          aria-invalid={version.success ? undefined : true}
          className="font-mono"
          id="model-provider-claude-code-version"
          onChange={(event) => setClaudeCodeVersion(event.target.value)}
          placeholder={ClaudeCodeVersionChannel.Latest}
          value={claudeCodeVersion}
        />
        {version.success ? (
          <p className="text-muted-foreground text-xs">
            <code>latest</code> or a release such as <code>2.1.296</code>. A
            headless runner installs it before its next loop and runs
            <code> claude </code> with it; the desktop app keeps its own Claude
            Code.
          </p>
        ) : (
          <p className="text-destructive text-xs">
            {version.error.issues[0]?.message}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={update.isPending || !version.success}
          onClick={handleSave}
          type="button"
        >
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

function EnvRows({
  rows,
  onChange,
}: Readonly<{ rows: EnvRow[]; onChange: (rows: EnvRow[]) => void }>) {
  const setRow = (index: number, row: EnvRow) =>
    onChange(rows.map((current, i) => (i === index ? row : current)));
  return (
    <div className="space-y-2">
      <Label>Claude Code variables</Label>
      <p className="text-muted-foreground text-xs">
        ANTHROPIC_*, CLAUDE_CODE_*, HTTPS_PROXY / HTTP_PROXY / NO_PROXY and
        other Claude Code settings, e.g. ANTHROPIC_CUSTOM_HEADERS or
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.
      </p>
      {rows.map((row, index) => (
        <div
          className="flex items-center gap-2"
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their position while being edited
          key={index}
        >
          <Input
            aria-label={`Variable ${index + 1} name`}
            className="font-mono text-xs"
            onChange={(event) =>
              setRow(index, { ...row, key: event.target.value.toUpperCase() })
            }
            placeholder="CLAUDE_CODE_EFFORT_LEVEL"
            value={row.key}
          />
          <Input
            aria-label={`Variable ${index + 1} value`}
            className="font-mono text-xs"
            onChange={(event) =>
              setRow(index, { ...row, value: event.target.value })
            }
            placeholder="max"
            value={row.value}
          />
          <Button
            aria-label={`Remove variable ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon className="size-3.5" />
        Add variable
      </Button>
    </div>
  );
}

function tokenPlaceholder(
  provider: ComputeTargetModelProvider,
  clearToken: boolean
): string {
  if (clearToken || !provider.token.isSet) {
    return "sk-…";
  }
  return `Stored (ends in ${provider.token.lastFour ?? "…"}); type to replace`;
}

function importSummary(imported: ImportedModelProvider): string {
  const notes: string[] = [];
  if (imported.ignoredKeys.length > 0) {
    notes.push(
      `Ignored (not Claude Code variables): ${imported.ignoredKeys.join(", ")}.`
    );
  }
  if (imported.caCertificatePath) {
    notes.push(
      `NODE_EXTRA_CA_CERTS points to ${imported.caCertificatePath}: upload that file as the CA certificate.`
    );
  }
  return ["Imported.", ...notes].join(" ");
}

/**
 * CA certificate the provider (or the proxy in front of it) is signed with,
 * uploaded as a PEM file. The computer writes it to a file and sets
 * NODE_EXTRA_CA_CERTS for Claude Code.
 */
function CaCertificateField({
  stored,
  value,
  onChange,
}: Readonly<{
  stored: ComputeTargetModelProvider["caCertificate"];
  value: ModelProviderCaCertificate | null | undefined;
  onChange: (value: ModelProviderCaCertificate | null) => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const current = currentCaCertificate(stored, value);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const parsed = modelProviderCaCertificateSchema.safeParse({
      fileName: file.name,
      pem: await file.text(),
    });
    if (parsed.success) {
      setError(null);
      onChange(parsed.data);
    } else {
      setError(parsed.error.issues[0]?.message ?? "Invalid certificate");
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="model-provider-ca-certificate">
        CA certificate (optional)
      </Label>
      <p className="text-muted-foreground text-xs">
        A PEM file (.pem, .crt) to trust when the API or the proxy uses a
        private certificate authority. Claude Code gets it as
        NODE_EXTRA_CA_CERTS.
      </p>
      <input
        accept=".pem,.crt,.cer,.ca-bundle,application/x-pem-file,application/x-x509-ca-cert"
        className="hidden"
        id="model-provider-ca-certificate"
        onChange={handleFile}
        ref={inputRef}
        type="file"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          <UploadIcon className="size-3.5" />
          {current ? "Replace file" : "Upload file"}
        </Button>
        {current ? (
          <>
            <span className="font-mono text-xs">
              {current.fileName} · {pluralizeCertificates(current.count)}
            </span>
            <button
              className="text-muted-foreground text-xs underline"
              onClick={() => onChange(null)}
              type="button"
            >
              Remove
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function currentCaCertificate(
  stored: ComputeTargetModelProvider["caCertificate"],
  value: ModelProviderCaCertificate | null | undefined
): { fileName: string; count: number } | null {
  if (value) {
    return { fileName: value.fileName, count: countPemCertificates(value.pem) };
  }
  if (value === null || !stored) {
    return null;
  }
  return { fileName: stored.fileName, count: stored.certificateCount };
}

function pluralizeCertificates(count: number): string {
  return count === 1 ? "1 certificate" : `${count} certificates`;
}
