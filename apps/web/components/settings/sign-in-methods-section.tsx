"use client";

import { toApiClientError } from "@tessel/api-client";
import {
  useApi,
  useIdentities,
  useMe,
  usePhoneActions,
  useSignInOptions,
  useUnlinkIdentity,
} from "@tessel/api-client/react";
import { phoneCodeRequestSchema, type IdentityProvider } from "@tessel/contracts";
import { Button, Dialog, DialogContent, Spinner, TextField } from "@tessel/ui";
import { KeyRound, Mail, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { CodeForm } from "@/components/auth/code-form";
import { SOCIAL_ERRORS } from "@/components/auth/social-buttons";
import { FormError, FormSuccess } from "@/components/form-error";
import { useForgotPassword } from "@/hooks/use-auth";

const LABELS: Record<IdentityProvider, string> = { google: "Google", github: "GitHub" };

function MethodRow({
  icon,
  name,
  detail,
  action,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3.5">
      <span className="text-muted mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{name}</p>
        <p className="text-muted mt-0.5 text-xs break-all">{detail}</p>
      </div>
      {action}
    </li>
  );
}

function AddPhoneDialog({ onClose }: { onClose: () => void }) {
  const { add, confirm } = usePhoneActions();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [challenge, setChallenge] = useState<{ challengeId: string; phone: string }>();

  async function send(event: FormEvent) {
    event.preventDefault();
    const parsed = phoneCodeRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    try {
      const { challengeId } = await add.mutateAsync(parsed.data.phone);
      setChallenge({ challengeId, phone: parsed.data.phone });
    } catch (caught) {
      setError(toApiClientError(caught).message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Add a mobile number"
        description={
          challenge
            ? `Enter the code we texted to ${challenge.phone}.`
            : "You'll be able to log in with a code texted to it."
        }
        className="max-w-md"
      >
        {challenge ? (
          <CodeForm
            className="mt-5"
            label="Code from the text message"
            submitLabel="Add number"
            onSubmit={async (code) => {
              await confirm.mutateAsync({ challengeId: challenge.challengeId, code });
              onClose();
            }}
          />
        ) : (
          <form onSubmit={send} noValidate className="mt-5 flex flex-col gap-4">
            <FormError message={error} />
            <TextField
              label="Mobile number"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+91 98765 43210"
              hint="Include the country code."
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" loading={add.isPending} disabled={!phone.trim()}>
                Text me a code
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Every way to sign in: password, Google, GitHub, and a phone number. */
export function SignInMethodsSection() {
  const api = useApi();
  const me = useMe();
  const options = useSignInOptions();
  const identities = useIdentities();
  const unlink = useUnlinkIdentity();
  const { remove } = usePhoneActions();
  const forgot = useForgotPassword();
  const params = useSearchParams();
  const [addingPhone, setAddingPhone] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [linking, setLinking] = useState<IdentityProvider>();

  if (me.isPending || identities.isPending || options.isPending) {
    return <Spinner label="Loading sign-in methods" />;
  }
  if (me.isError || identities.isError) {
    return <p className="text-danger text-sm">Sign-in methods couldn&apos;t be loaded.</p>;
  }
  const user = me.data;
  const linked = params.get("linked") as IdentityProvider | null;
  const linkError = SOCIAL_ERRORS[params.get("link_error") ?? ""];

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (caught) {
      setError(toApiClientError(caught).message);
    }
  };

  const link = async (provider: IdentityProvider) => {
    setLinking(provider);
    await run(async () => {
      window.location.assign(await api.users.linkIdentity(provider));
    });
    setLinking(undefined);
  };

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error ?? linkError} />
      {linked && LABELS[linked] && !error ? (
        <FormSuccess message={`${LABELS[linked]} is linked. You can log in with it now.`} />
      ) : null}
      <ul className="divide-line border-line divide-y border-y" aria-label="Sign-in methods">
        <MethodRow
          icon={<KeyRound className="size-4" />}
          name="Password"
          detail={user.hasPassword ? `With ${user.email}` : "Not set"}
          action={
            user.hasPassword ? null : (
              <Button
                variant="ghost"
                size="sm"
                loading={forgot.isPending}
                onClick={() =>
                  run(async () => {
                    await forgot.mutateAsync(user.email);
                    setNotice(`We emailed ${user.email} a link to set a password.`);
                  })
                }
              >
                Set a password
              </Button>
            )
          }
        />
        {(["google", "github"] as const)
          .filter(
            (provider) =>
              options.data?.[provider] ||
              identities.data.some((identity) => identity.provider === provider),
          )
          .map((provider) => {
            const identity = identities.data.find((item) => item.provider === provider);
            return (
              <MethodRow
                key={provider}
                icon={<Mail className="size-4" />}
                name={LABELS[provider]}
                detail={identity ? identity.email : "Not linked"}
                action={
                  identity ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      aria-label={`Unlink ${LABELS[provider]}`}
                      onClick={() => run(() => unlink.mutateAsync(provider))}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={linking === provider}
                      onClick={() => link(provider)}
                    >
                      Link {LABELS[provider]}
                    </Button>
                  )
                }
              />
            );
          })}
        {options.data?.phone || user.phone ? (
          <MethodRow
            icon={<Smartphone className="size-4" />}
            name="Phone"
            detail={user.phone ?? "Not added"}
            action={
              user.phone ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  aria-label="Remove phone number"
                  onClick={() => run(() => remove.mutateAsync())}
                >
                  Remove
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setAddingPhone(true)}>
                  Add number
                </Button>
              )
            }
          />
        ) : null}
      </ul>
      <FormSuccess message={notice} />
      {addingPhone ? <AddPhoneDialog onClose={() => setAddingPhone(false)} /> : null}
    </div>
  );
}
