import { hash, verify } from "@node-rs/argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Spends the same time as a real verification and always fails. Used when
   * no account matches, so response time doesn't reveal which emails exist.
   */
  verifyNothing(password: string): Promise<false>;
}

export interface PasswordHasherOptions {
  /** KiB of memory per hash. Default 19456 (19 MiB), the OWASP minimum for Argon2id. */
  memoryCost?: number;
  /** Iterations. Default 2. */
  timeCost?: number;
}

/** Argon2id password hashing. */
export function createPasswordHasher({
  memoryCost = 19_456,
  timeCost = 2,
}: PasswordHasherOptions = {}): PasswordHasher {
  const options = { memoryCost, timeCost, parallelism: 1 };
  let dummyHash: Promise<string> | undefined;

  return {
    hash: (password) => hash(password, options),
    verify: async (passwordHash, password) => {
      try {
        return await verify(passwordHash, password);
      } catch {
        return false;
      }
    },
    verifyNothing: async (password) => {
      dummyHash ??= hash("timing-equalizer-not-a-real-password", options);
      await verify(await dummyHash, password).catch(() => false);
      return false;
    },
  };
}
