import type { FastifyRequest } from "fastify";

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function requireBearer(req: FastifyRequest): void {
  const secret = process.env.PDF_RENDER_SECRET;
  if (!secret) {
    throw new HttpError(500, "PDF_RENDER_SECRET not set on server");
  }
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${secret}`) {
    throw new HttpError(401, "unauthorized");
  }
}
