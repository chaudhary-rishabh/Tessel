import type { PublicUser } from "@tessel/contracts";
import type { Database } from "@tessel/db";
import { errors } from "../../lib/errors";
import { toPublicUser } from "./users.mapper";
import { usersRepository } from "./users.repository";

export function createUsersService({ db }: { db: Database }) {
  return {
    async getMe(userId: string): Promise<PublicUser> {
      const user = await usersRepository.findById(db, userId);
      if (!user) throw errors.unauthorized();
      return toPublicUser(user);
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
