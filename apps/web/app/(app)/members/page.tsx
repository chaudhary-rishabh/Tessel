"use client";

import { toApiClientError } from "@tessel/api-client";
import { useInvitations, useMemberActions, useMembers } from "@tessel/api-client/react";
import { createInvitationRequestSchema, type Member, type WorkspaceRole } from "@tessel/contracts";
import { Button, Dialog, DialogClose, DialogContent, Spinner, TextField } from "@tessel/ui";
import { MailPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import { FormError } from "@/components/form-error";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSessionStore } from "@/lib/session-store";
import { toast } from "@/lib/toast-store";

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const failed = (error: unknown) => toast.error(toApiClientError(error).message);

function InviteForm({
  workspaceId,
  canInviteAdmins,
}: {
  workspaceId: string;
  canInviteAdmins: boolean;
}) {
  const { invite } = useMemberActions(workspaceId);
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createInvitationRequestSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    try {
      await invite.mutateAsync(parsed.data);
      toast.success(`Invitation sent to ${parsed.data.email}`);
      setEmail("");
    } catch (caught) {
      setError(toApiClientError(caught).message);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormError message={error} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          className="flex-1"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-medium">
            Role
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
            className="border-line bg-surface focus:border-accent focus:outline-accent/25 h-11 rounded-lg border px-3 text-base focus:outline-2"
          >
            <option value="member">Member</option>
            {canInviteAdmins ? <option value="admin">Admin</option> : null}
          </select>
        </div>
        <Button type="submit" loading={invite.isPending} disabled={!email.trim()}>
          <MailPlus className="size-4" aria-hidden="true" />
          Send invitation
        </Button>
      </div>
    </form>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description={description} className="max-w-md">
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({
  member,
  workspaceId,
  workspaceName,
  myRole,
  isMe,
}: {
  member: Member;
  workspaceId: string;
  workspaceName: string;
  myRole: WorkspaceRole;
  isMe: boolean;
}) {
  const actions = useMemberActions(workspaceId);
  const router = useRouter();
  const roleId = useId();
  const [confirm, setConfirm] = useState<"remove" | "leave" | "transfer">();
  const canChangeRole = myRole === "owner" && member.role !== "owner";
  const canRemove =
    !isMe &&
    member.role !== "owner" &&
    (myRole === "owner" || (myRole === "admin" && member.role === "member"));

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {member.name}
          {isMe ? <span className="text-muted ml-2 text-xs">You</span> : null}
        </p>
        <p className="text-muted break-all">{member.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canChangeRole ? (
          <>
            <label htmlFor={roleId} className="sr-only">
              Role for {member.name}
            </label>
            <select
              id={roleId}
              value={member.role}
              onChange={(event) => {
                // Read it now: the select shows the saved role again until the list refreshes.
                const role = event.target.value as "admin" | "member";
                actions.updateRole
                  .mutateAsync({ userId: member.userId, role })
                  .then(
                    () =>
                      toast.success(
                        `${member.name} is now ${role === "admin" ? "an admin" : "a member"}`,
                      ),
                    failed,
                  );
              }}
              className="border-line bg-surface focus:border-accent h-9 rounded-lg border px-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </>
        ) : (
          <span className="bg-paper rounded-md px-2 py-1 text-xs font-medium">
            {ROLE_LABELS[member.role]}
          </span>
        )}
        {myRole === "owner" && !isMe ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirm("transfer")}>
            Make owner
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            aria-label={`Remove ${member.name}`}
            onClick={() => setConfirm("remove")}
          >
            Remove
          </Button>
        ) : null}
        {isMe && member.role !== "owner" ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirm("leave")}
          >
            Leave
          </Button>
        ) : null}
      </div>

      {confirm === "remove" ? (
        <ConfirmDialog
          title={`Remove ${member.name}?`}
          description={`They lose access to ${workspaceName} straight away, along with any tokens and apps they connected to it.`}
          confirmLabel="Remove"
          onConfirm={() =>
            actions.remove
              .mutateAsync(member.userId)
              .then(() => toast.success(`${member.name} was removed`), failed)
          }
          onClose={() => setConfirm(undefined)}
        />
      ) : null}
      {confirm === "leave" ? (
        <ConfirmDialog
          title={`Leave ${workspaceName}?`}
          description="You'll need a new invitation to come back."
          confirmLabel="Leave"
          onConfirm={() =>
            actions.remove.mutateAsync(member.userId).then(() => {
              toast.success(`You left ${workspaceName}`);
              router.replace("/chat");
            }, failed)
          }
          onClose={() => setConfirm(undefined)}
        />
      ) : null}
      {confirm === "transfer" ? (
        <ConfirmDialog
          title={`Make ${member.name} the owner?`}
          description="They'll control roles and can remove anyone. You'll become an admin."
          confirmLabel="Make owner"
          onConfirm={() =>
            actions.transfer
              .mutateAsync(member.userId)
              .then(() => toast.success(`${member.name} is now the owner`), failed)
          }
          onClose={() => setConfirm(undefined)}
        />
      ) : null}
    </li>
  );
}

export default function MembersPage() {
  const { current } = useCurrentWorkspace();
  const user = useSessionStore((state) => state.user);
  const members = useMembers(current?.id);
  const isManager = current?.role === "owner" || current?.role === "admin";
  const invitations = useInvitations(current?.id, Boolean(isManager && !current?.isPersonal));
  const actions = useMemberActions(current?.id ?? "none");
  const [creating, setCreating] = useState(false);
  if (!current) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 md:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
      {current.isPersonal ? (
        <div className="mt-4 max-w-prose">
          <p className="text-muted">
            {current.name} is your personal workspace, so it&apos;s just you. Create a team
            workspace to invite people and share documents, skills, and chats.
          </p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            Create a team workspace
          </Button>
          <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
        </div>
      ) : (
        <>
          <p className="text-muted mt-2 max-w-prose">
            Everyone here can use {current.name}&apos;s documents, skills, and connectors.
          </p>
          {isManager ? (
            <section aria-labelledby="invite-heading" className="mt-8">
              <h2 id="invite-heading" className="text-lg font-semibold">
                Invite people
              </h2>
              <div className="mt-3">
                <InviteForm workspaceId={current.id} canInviteAdmins={current.role === "owner"} />
              </div>
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby="people-heading" className="mt-10">
        <h2 id="people-heading" className="text-lg font-semibold">
          People
        </h2>
        {members.isPending ? (
          <Spinner label="Loading members" />
        ) : members.isError ? (
          <p className="text-danger mt-3 text-sm">Members couldn&apos;t be loaded.</p>
        ) : (
          <ul className="divide-line border-line mt-3 divide-y border-y" aria-label="Members">
            {members.data.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                workspaceId={current.id}
                workspaceName={current.name}
                myRole={current.role}
                isMe={member.userId === user?.id}
              />
            ))}
          </ul>
        )}
      </section>

      {isManager && !current.isPersonal && invitations.data && invitations.data.length > 0 ? (
        <section aria-labelledby="pending-heading" className="mt-10">
          <h2 id="pending-heading" className="text-lg font-semibold">
            Pending invitations
          </h2>
          <ul
            className="divide-line border-line mt-3 divide-y border-y"
            aria-label="Pending invitations"
          >
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-3 py-3.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-all">{invitation.email}</p>
                  <p className="text-muted text-xs">
                    {ROLE_LABELS[invitation.role]}, invited by {invitation.invitedBy ?? "someone"}.
                    Expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    .
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  aria-label={`Revoke invitation for ${invitation.email}`}
                  onClick={() =>
                    actions.revokeInvitation
                      .mutateAsync(invitation.id)
                      .then(() => toast.success("Invitation revoked"), failed)
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
