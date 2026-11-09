import {
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { WorkspacesService } from "./workspaces.service";

export function createWorkspacesController(service: WorkspacesService) {
  const list: RequestHandler = async (req, res) => {
    res.json({ workspaces: await service.list(getAuth(req).userId) });
  };

  const create: RequestHandler = async (req, res) => {
    const { name } = createWorkspaceRequestSchema.parse(req.body);
    res.status(201).json(await service.create(getAuth(req).userId, name));
  };

  const get: RequestHandler = async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    res.json(await service.get(getAuth(req).userId, workspaceId));
  };

  const rename: RequestHandler = async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const { name } = updateWorkspaceRequestSchema.parse(req.body);
    res.json(await service.rename(getAuth(req).userId, workspaceId, name));
  };

  const remove: RequestHandler = async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const { name } = deleteWorkspaceRequestSchema.parse(req.body);
    await service.remove(getAuth(req).userId, workspaceId, name, req.ip);
    res.status(204).end();
  };

  return { list, create, get, rename, remove };
}
