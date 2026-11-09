"use client";

import { toApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import { Button, safeNextPath, TesselMark, TextField } from "@tessel/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSessionStore } from "@/lib/session-store";

function LoginForm() {
  const api = useApi();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const status = useSessionStore((state) => state.status);
  const setSession = useSessionStore((state) => state.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (challengeToken) {
        setSession(await api.auth.completeTwoFactor({ challengeToken, code }));
      } else {
        const result = await api.auth.login({ email, password });
        if ("challengeToken" in result) setChallengeToken(result.challengeToken);
        else setSession(result);
      }
    } catch (caught) {
      setError(toApiClientError(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="font-display flex items-center gap-2.5 text-lg font-semibold">
        <TesselMark />
        Tessel Admin
      </div>
      <h1 className="mt-10 text-2xl font-semibold tracking-tight">
        {challengeToken ? "Two-step sign-in" : "Log in"}
      </h1>
      <p className="text-muted mt-2 text-sm">
        {challengeToken
          ? "Enter the code from your authenticator app."
          : "Use your Tessel account. Only Tessel admins can continue."}
      </p>
      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
        {challengeToken ? (
          <TextField
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        ) : (
          <>
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        )}
        <Button type="submit" loading={busy}>
          {challengeToken ? "Verify" : "Log in"}
        </Button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
