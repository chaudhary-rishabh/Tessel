"use client";

import { toApiClientError } from "@tessel/api-client";
import { useMe, useTwoFactorActions } from "@tessel/api-client/react";
import type { TwoFactorSetupResponse } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, Spinner, TextField } from "@tessel/ui";
import { Download, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CodeForm } from "@/components/auth/code-form";
import { CopyButton } from "@/components/chat/markdown";
import { FormError } from "@/components/form-error";

/** The recovery codes, shown once, with ways to keep them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`Tessel recovery codes\n\n${text}\n`], { type: "text/plain" }),
    );
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "tessel-recovery-codes.txt",
    });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-5 flex flex-col gap-4">
      <p className="text-sm">
        If you lose your phone, each of these lets you sign in once. This is the only time
        they&apos;re shown.
      </p>
      <ol
        className="bg-paper grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg p-4 font-mono text-sm"
        aria-label="Recovery codes"
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <CopyButton text={text} label="Copy recovery codes" />
          <Button variant="ghost" size="sm" onClick={download}>
            <Download className="size-4" aria-hidden="true" />
            Download
          </Button>
        </div>
        <Button onClick={onDone}>I&apos;ve saved them</Button>
      </div>
    </div>
  );
}

function EnableDialog({ onClose }: { onClose: () => void }) {
  const { setup, enable } = useTwoFactorActions();
  const [secret, setSecret] = useState<TwoFactorSetupResponse>();
  const [codes, setCodes] = useState<string[]>();
  const start = setup.mutateAsync;
  // Once per dialog: a second setup would replace the secret being scanned.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start().then(setSecret, () => undefined);
  }, [start]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={codes ? "Save your recovery codes" : "Turn on two-step sign-in"}
        description={
          codes
            ? "Two-step sign-in is on."
            : "Scan this with an authenticator app, such as Google Authenticator, 1Password, or Authy."
        }
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
      >
        {codes ? (
          <RecoveryCodes codes={codes} onDone={onClose} />
        ) : setup.isError ? (
          <div className="mt-5">
            <FormError message={setup.error.message} />
          </div>
        ) : !secret ? (
          <div className="mt-5">
            <Spinner label="Preparing" />
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            {/* A data URL made by the API; next/image adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={secret.qrCode}
              alt="QR code for your authenticator app"
              width={200}
              height={200}
              className="border-line mx-auto rounded-lg border bg-white p-2"
            />
            <details className="text-sm">
              <summary className="text-accent cursor-pointer font-medium">
                Can&apos;t scan it? Enter a key instead
              </summary>
              <div className="bg-paper mt-2 flex items-center gap-2 rounded-lg px-3 py-2">
                <code
                  className="min-w-0 flex-1 font-mono text-sm break-all"
                  data-testid="totp-secret"
                >
                  {secret.secret}
                </code>
                <CopyButton text={secret.secret} label="Copy key" />
              </div>
            </details>
            <CodeForm
              className="mt-1"
              label="Code from your app"
              submitLabel="Turn on"
              onSubmit={async (code) => setCodes(await enable.mutateAsync(code))}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ hasPassword, onClose }: { hasPassword: boolean; onClose: () => void }) {
  const { disable } = useTwoFactorActions();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await disable.mutateAsync({ password: hasPassword ? password : undefined, code });
      onClose();
    } catch {
      // Shown below from the mutation's error.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Turn off two-step sign-in?"
        description="Signing in will only need your password. Your recovery codes stop working."
        className="max-w-md"
      >
        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
          <FormError
            message={disable.error ? toApiClientError(disable.error).message : undefined}
          />
          {hasPassword ? (
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          ) : null}
          <TextField
            label="Code from your app"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="danger"
              loading={disable.isPending}
              disabled={code.length !== 6 || (hasPassword && !password)}
            >
              Turn off
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateDialog({ onClose }: { onClose: () => void }) {
  const { regenerate } = useTwoFactorActions();
  const [codes, setCodes] = useState<string[]>();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={codes ? "Your new recovery codes" : "Get new recovery codes"}
        description={
          codes ? "Your old codes no longer work." : "This replaces your current recovery codes."
        }
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
      >
        {codes ? (
          <RecoveryCodes codes={codes} onDone={onClose} />
        ) : (
          <CodeForm
            className="mt-5"
            label="Code from your app"
            submitLabel="Get new codes"
            onSubmit={async (code) => setCodes(await regenerate.mutateAsync(code))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Two-step sign-in with an authenticator app, in Settings. */
export function TwoFactorSection() {
  const me = useMe();
  const [dialog, setDialog] = useState<"enable" | "disable" | "regenerate" | null>(null);
  if (me.isPending) return <Spinner label="Loading" />;
  if (me.isError) return <p className="text-danger text-sm">This couldn&apos;t be loaded.</p>;
  const enabled = me.data.twoFactorEnabled;
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2.5 text-sm" data-testid="two-factor-status">
        <ShieldCheck
          className={`mt-0.5 size-4 shrink-0 ${enabled ? "text-accent" : "text-muted"}`}
          aria-hidden="true"
        />
        {enabled
          ? "On. Signing in asks for a code from your authenticator app."
          : "Off. Add a code from your phone to signing in, so a stolen password isn't enough."}
      </p>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button variant="secondary" onClick={() => setDialog("regenerate")}>
              New recovery codes
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => setDialog("disable")}>
              Turn off
            </Button>
          </>
        ) : (
          <Button onClick={() => setDialog("enable")}>Turn on two-step sign-in</Button>
        )}
      </div>
      {dialog === "enable" ? <EnableDialog onClose={close} /> : null}
      {dialog === "disable" ? (
        <DisableDialog hasPassword={me.data.hasPassword} onClose={close} />
      ) : null}
      {dialog === "regenerate" ? <RegenerateDialog onClose={close} /> : null}
    </div>
  );
}
