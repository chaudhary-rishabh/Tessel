import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

/**
 * Accounts. Not tenant-scoped (no row-level security): the auth service must
 * look users up by email before any user context exists.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Always stored trimmed and lowercased, so the unique constraint is case-insensitive. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** Null for accounts that only sign in another way (Google, GitHub, phone). */
  passwordHash: text("password_hash"),
  /** When the user proved they own the email (the emailed link, Google or GitHub, or a password reset). */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Two-factor sign-in: the TOTP secret, encrypted, once confirmed. */
  totpSecret: text("totp_secret"),
  /** A secret being set up, until the user confirms it with a code. */
  totpPendingSecret: text("totp_pending_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** The last time step a code was accepted for, so a code can't be used twice. */
  totpLastStep: integer("totp_last_step"),
  /** A verified mobile number in E.164 form (+919876543210), for signing in with a text code. */
  phone: text("phone").unique(),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  role: userRole("role").notNull().default("user"),
  /** Set by an admin: the account can't sign in, and its tokens stop working. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Signups waiting for an email code, from before signup created the account
 * at once (D-100). Nothing writes here any more; the nightly cleanup empties it.
 */
export const signupChallenges = pgTable(
  "signup_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Null when the email already has an account. */
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("signup_challenges_email_idx").on(table.email)],
);

/** Single-use password reset links; only a hash of the token is kept. */
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Links that confirm a user owns their email; only a hash of the token is kept. Only the newest works. */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("email_verifications_user_idx").on(table.userId)],
);

/** Two-factor recovery codes, hashed; each works once. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recovery_codes_user_idx").on(table.userId)],
);

export type SignupChallengeRow = typeof signupChallenges.$inferSelect;

export const identityProvider = pgEnum("identity_provider", ["google", "github"]);

/** Google or GitHub accounts a user signs in with. One of each per user. */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: identityProvider("provider").notNull(),
    /** The provider's stable ID for the account (Google `sub`, GitHub user ID). */
    providerUserId: text("provider_user_id").notNull(),
    /** The email the provider reported, for display. */
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("user_identities_provider_account_unique").on(table.provider, table.providerUserId),
    unique("user_identities_user_provider_unique").on(table.userId, table.provider),
  ],
);

/**
 * One-time tickets that hand a Google or GitHub sign-in from the API's
 * callback to the web app, which exchanges the ticket for a session.
 */
export const loginTickets = pgTable("login_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ticketHash: text("ticket_hash").notNull().unique(),
  /** Which provider the sign-in came through, for the audit log. */
  provider: identityProvider("provider"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phoneChallengePurpose = pgEnum("phone_challenge_purpose", ["verify", "login"]);

/**
 * A code texted to a phone: to confirm a number being added (`verify`), or
 * to sign in with it (`login`). Sign-in challenges for numbers no account has
 * get no code, so they can never be completed.
 */
export const phoneChallenges = pgTable(
  "phone_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: phoneChallengePurpose("purpose").notNull(),
    phone: text("phone").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("phone_challenges_phone_idx").on(table.phone)],
);

export type UserIdentityRow = typeof userIdentities.$inferSelect;
