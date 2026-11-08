import { setUserContext, type Database, type UserRow } from "@tessel/db";
import { usersRepository, type NewUser } from "../users/users.repository";
import { workspacesRepository } from "../workspaces/workspaces.repository";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Creates a user and their personal workspace, inside the caller's
 * transaction. Every way of signing up ends here.
 */
export async function createAccount(tx: Transaction, input: NewUser): Promise<UserRow> {
  const created = await usersRepository.insert(tx, input);
  // Act as the new user so row-level security allows creating their workspace.
  await setUserContext(tx, created.id);
  await workspacesRepository.createWithOwner(tx, {
    name: `${input.name.split(/\s+/)[0]}'s workspace`,
    ownerId: created.id,
    isPersonal: true,
  });
  return created;
}
