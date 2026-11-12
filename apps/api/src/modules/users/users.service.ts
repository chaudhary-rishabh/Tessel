import type { PublicUser, UpdateProfileRequest } from "@tessel/contracts";
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

    async updateProfile(userId: string, input: UpdateProfileRequest): Promise<PublicUser> {
      const user = await usersRepository.update(db, userId, { name: input.name });
      if (!user) throw errors.unauthorized();
      return toPublicUser(user);
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
