"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiClientError } from "@tessel/api-client";
import { useMe, useRenameWorkspace } from "@tessel/api-client/react";
import { changePasswordRequestSchema, updateWorkspaceRequestSchema } from "@tessel/contracts";
import { Button, TextField } from "@tessel/ui";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { FormError, FormSuccess } from "@/components/form-error";
import { AccessTokensSection } from "@/components/settings/access-tokens-section";
import { ActivitySection } from "@/components/settings/activity-section";
import { ConnectedAppsSection } from "@/components/settings/connected-apps-section";
import { MemorySection } from "@/components/settings/memory-section";
import { SessionsSection } from "@/components/settings/sessions-section";
import { SignInMethodsSection } from "@/components/settings/sign-in-methods-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { UsageSection } from "@/components/settings/usage-section";
import { useChangePassword } from "@/hooks/use-auth";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { applyApiError } from "@/lib/form-errors";
import { useSessionStore } from "@/lib/session-store";

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="border-line grid gap-4 border-t py-8 first:border-t-0 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10"
    >
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-muted mt-1 text-sm">{description}</p>
      </div>
      <div className="max-w-md">{children}</div>
    </section>
  );
}

function ProfileSection() {
  const user = useSessionStore((state) => state.user);
  if (!user) return null;
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Section id="profile" title="Profile" description="How you appear to your teammates.">
      <dl className="grid gap-4">
        <div>
          <dt className="text-muted text-sm">Name</dt>
          <dd className="mt-0.5 font-medium">{user.name}</dd>
        </div>
        <div>
          <dt className="text-muted text-sm">Email</dt>
          <dd className="mt-0.5 font-medium break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-muted text-sm">Member since</dt>
          <dd className="mt-0.5 font-medium">{memberSince}</dd>
        </div>
      </dl>
    </Section>
  );
}

function WorkspaceSection() {
  const { current } = useCurrentWorkspace();
  const rename = useRenameWorkspace();
  const [saved, setSaved] = useState<string>();
  const form = useForm({
    resolver: zodResolver(updateWorkspaceRequestSchema),
    defaultValues: { name: current?.name ?? "" },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  // Show the selected workspace's name when it loads or the user switches.
  useEffect(() => {
    if (current) form.reset({ name: current.name });
  }, [current, form]);

  if (!current) return null;
  const canRename = current.role === "owner" || current.role === "admin";

  const onSubmit = form.handleSubmit(async ({ name }) => {
    setSaved(undefined);
    try {
      await rename.mutateAsync({ workspaceId: current.id, name });
      setSaved("Workspace renamed.");
    } catch (error) {
      applyApiError(error, form.setError, ["name"]);
    }
  });

  return (
    <Section
      id="workspace"
      title="Workspace"
      description={
        canRename
          ? "Settings for the workspace you have open."
          : "Only owners and admins can change these settings."
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <TextField
          label="Workspace name"
          disabled={!canRename}
          error={errors.name?.message}
          {...form.register("name")}
        />
        {canRename ? (
          <div className="flex items-center gap-4">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save name
            </Button>
            <FormSuccess message={saved} />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

function UsageSettings() {
  const { current } = useCurrentWorkspace();
  if (!current) return null;
  const seesWorkspace = current.role === "owner" || current.role === "admin";
  return (
    <Section
      id="usage"
      title="Usage"
      description={
        seesWorkspace
          ? "AI usage across this workspace in the last 30 days."
          : "Your AI usage in this workspace in the last 30 days."
      }
    >
      <UsageSection workspaceId={current.id} />
    </Section>
  );
}

function PasswordSection() {
  const me = useMe();
  const changePassword = useChangePassword();
  const [saved, setSaved] = useState<string>();
  const form = useForm({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(undefined);
    try {
      await changePassword.mutateAsync(values);
      form.reset();
      setSaved("Password changed. You've been logged out on other devices.");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "invalid_current_password") {
        form.setError("currentPassword", { message: "Current password is incorrect" });
        return;
      }
      applyApiError(error, form.setError, ["currentPassword", "newPassword"]);
    }
  });

  // Accounts without a password set one from Sign-in methods instead.
  if (me.data && !me.data.hasPassword) return null;

  return (
    <Section id="password" title="Password" description="Changing it logs you out everywhere else.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...form.register("currentPassword")}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.newPassword?.message}
          {...form.register("newPassword")}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" loading={isSubmitting}>
            Change password
          </Button>
          <FormSuccess message={saved} />
        </div>
      </form>
    </Section>
  );
}

function MemorySettings() {
  const { current } = useCurrentWorkspace();
  if (!current) return null;
  return (
    <Section
      id="memory"
      title="Memory"
      description="What Tessel remembers about you in this workspace. Only you can see it."
    >
      <MemorySection workspaceId={current.id} />
    </Section>
  );
}

function AccessTokenSettings() {
  const { current } = useCurrentWorkspace();
  if (!current) return null;
  return (
    <Section
      id="access-tokens"
      title="Access tokens"
      description="Connect outside tools, like Claude or Cursor, through Tessel's MCP server. Apps that can sign in only need its URL; for the rest, make a token."
    >
      <AccessTokensSection workspaceId={current.id} />
    </Section>
  );
}

function ActivitySettings() {
  const { current } = useCurrentWorkspace();
  if (!current || (current.role !== "owner" && current.role !== "admin")) return null;
  return (
    <Section
      id="activity"
      title="Activity"
      description={`Changes to ${current.name}: members, tokens, connectors, and deleted documents. Kept for a year.`}
    >
      <ActivitySection workspaceId={current.id} />
    </Section>
  );
}

function ConnectedAppsSettings() {
  return (
    <Section
      id="connected-apps"
      title="Connected apps"
      description="Apps you signed in to Tessel from. Each can search and read one workspace's documents."
    >
      <ConnectedAppsSection />
    </Section>
  );
}

function SecuritySettings() {
  return (
    <>
      <Section
        id="sign-in-methods"
        title="Sign-in methods"
        description="Ways you can log in to Tessel. Keep at least one."
      >
        <Suspense fallback={null}>
          <SignInMethodsSection />
        </Suspense>
      </Section>
      <Section
        id="two-factor"
        title="Two-step sign-in"
        description="Ask for a code from your phone as well as your password."
      >
        <TwoFactorSection />
      </Section>
      <Section
        id="sessions"
        title="Where you're signed in"
        description="Sign out of any browser or device you don't recognise."
      >
        <SessionsSection />
      </Section>
    </>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 md:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-6">
        <ProfileSection />
        <WorkspaceSection />
        <MemorySettings />
        <UsageSettings />
        <AccessTokenSettings />
        <ConnectedAppsSettings />
        <PasswordSection />
        <SecuritySettings />
        <ActivitySettings />
      </div>
    </div>
  );
}
