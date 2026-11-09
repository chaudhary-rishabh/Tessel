import type { AuditEvent } from "@tessel/contracts";

const ACTIONS: Record<string, string> = {
  "auth.signed_up": "Signed up",
  "auth.signed_in": "Signed in",
  "auth.password_changed": "Changed their password",
  "auth.password_reset": "Reset their password",
  "auth.two_factor_enabled": "Turned on two-step sign-in",
  "auth.two_factor_disabled": "Turned off two-step sign-in",
  "auth.recovery_codes_regenerated": "Made new recovery codes",
  "auth.session_revoked": "Logged out a device",
  "auth.sign_in_method_added": "Added a way to sign in",
  "auth.sign_in_method_removed": "Removed a way to sign in",
  "member.invited": "Invited someone",
  "member.invitation_revoked": "Revoked an invitation",
  "member.joined": "Joined a workspace",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "member.left": "Left a workspace",
  "workspace.created": "Created a workspace",
  "workspace.renamed": "Renamed a workspace",
  "workspace.ownership_transferred": "Handed over a workspace",
  "token.created": "Created an access token",
  "token.revoked": "Revoked an access token",
  "app.connected": "Connected an app",
  "app.disconnected": "Disconnected an app",
  "connector.added": "Added a connector",
  "connector.removed": "Removed a connector",
  "document.deleted": "Deleted a document",
  "admin.role_changed": "Changed someone's admin role",
  "admin.user_suspended": "Suspended an account",
  "admin.user_unsuspended": "Lifted a suspension",
  "admin.user_signed_out": "Signed someone out everywhere",
  "admin.models_updated": "Changed the model registry",
};

export const describeAction = (action: string) => ACTIONS[action] ?? action;

/** The few details worth showing inline, as "key: value" pairs. */
export function describeDetails(event: AuditEvent): string {
  const parts = Object.entries(event.metadata)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => `${key}: ${String(value)}`);
  if (event.target) parts.unshift(event.target);
  return parts.join(", ");
}

export const AUDIT_FILTERS = [
  { value: "", label: "Everything" },
  { value: "auth.", label: "Sign-in and security" },
  { value: "member.", label: "Members" },
  { value: "workspace.", label: "Workspaces" },
  { value: "token.", label: "Access tokens" },
  { value: "app.", label: "Connected apps" },
  { value: "connector.", label: "Connectors" },
  { value: "document.", label: "Documents" },
  { value: "admin.", label: "Admin actions" },
] as const;
