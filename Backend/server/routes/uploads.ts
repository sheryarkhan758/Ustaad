/**
 * Local-development upload endpoint.
 *
 * Stands in for Supabase Storage's signed-URL upload so that development
 * proceeds without a Supabase account, behind the same interface
 * (`server/services/storage.ts`). It is **not mounted in production**: the
 * factory below refuses, and `LocalDocumentStorage` refuses to construct there
 * too, because a serverless filesystem is ephemeral and a CNIC image written to
 * it would be silently lost.
 *
 * The ticket in the path is HMAC-signed and short-lived, so this endpoint
 * cannot be pointed at an arbitrary key.
 */

import { Router, type Request } from 'express';

import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  readLocalUpload,
  verifyLocalTicket,
  writeLocalUpload,
} from '../services/storage';

/** Collects the raw body, capped, without buffering an unbounded stream. */
async function readBody(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      throw new UploadValidationError('the file exceeds the 5 MB limit');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function createLocalUploadRouter(): Router {
  const router = Router();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('the local upload route must never be mounted in production');
  }

  router.put('/local/:token', async (req, res, next) => {
    try {
      const storagePath = verifyLocalTicket(String(req.params.token));
      await writeLocalUpload(storagePath, await readBody(req));
      res.status(200).json({ ok: true, storagePath });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        res.status(400).json({ error: { code: 'upload_rejected', message: error.message } });
        return;
      }
      next(error);
    }
  });

  /**
   * Stands in for a signed read URL.
   *
   * The same short-lived signed ticket, so an administrator's document viewer
   * behaves the same locally as it will against Supabase.
   */
  router.get('/local/:token', async (req, res, next) => {
    try {
      const storagePath = verifyLocalTicket(String(req.params.token));
      const body = await readLocalUpload(storagePath);
      res.setHeader('Content-Type', 'application/octet-stream');
      // Never inline: a stored file must not be rendered by the browser in the
      // application's origin.
      res.setHeader('Content-Disposition', 'attachment');
      res.status(200).send(body);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        res.status(400).json({ error: { code: 'link_rejected', message: error.message } });
        return;
      }
      next(error);
    }
  });

  return router;
}
