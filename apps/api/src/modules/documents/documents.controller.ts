import {
  createDocumentRequestSchema,
  documentParamsSchema,
  documentTextQuerySchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import type { Request, RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, DocumentsService } from "./documents.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

const documentIdOf = (req: Request) => documentParamsSchema.parse(req.params).documentId;

export function createDocumentsController(service: DocumentsService) {
  const list: RequestHandler = async (req, res) => {
    res.json({ documents: await service.list(actorFor(req)) });
  };
  const get: RequestHandler = async (req, res) => {
    res.json(await service.get(actorFor(req), documentIdOf(req)));
  };
  const create: RequestHandler = async (req, res) => {
    res
      .status(201)
      .json(await service.create(actorFor(req), createDocumentRequestSchema.parse(req.body)));
  };
  const complete: RequestHandler = async (req, res) => {
    res.json(await service.complete(actorFor(req), documentIdOf(req)));
  };
  const reprocess: RequestHandler = async (req, res) => {
    res.json(await service.reprocess(actorFor(req), documentIdOf(req)));
  };
  const download: RequestHandler = async (req, res) => {
    res.json({ url: await service.downloadUrl(actorFor(req), documentIdOf(req)) });
  };
  const text: RequestHandler = async (req, res) => {
    const { maxCharacters } = documentTextQuerySchema.parse(req.query);
    res.json(await service.text(actorFor(req), documentIdOf(req), maxCharacters));
  };
  const remove: RequestHandler = async (req, res) => {
    await service.remove(actorFor(req), documentIdOf(req));
    res.status(204).end();
  };
  const search: RequestHandler = async (req, res) => {
    res.json(await service.search(actorFor(req), req.body));
  };
  return { list, get, create, complete, reprocess, download, text, remove, search };
}
