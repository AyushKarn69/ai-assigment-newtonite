import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve the web app (plain HTML/CSS/JS, no build step) from `dir`.
 *
 * `/` serves index.html and other paths are looked up inside `dir`. Anything
 * that resolves outside `dir`, is a dotfile, or does not exist is a 404 in the
 * normal API error format. `/api/*` is never handled here.
 */
export function registerFrontend(app: FastifyInstance, dir: string): void {
  const root = path.resolve(dir);
  if (!existsSync(root)) return;

  app.get('/*', async (request, reply) => {
    const requested = decodeURIComponent((request.params as { '*': string })['*'] || '');
    const relative = requested === '' ? 'index.html' : requested;

    const file = path.resolve(root, relative);
    const inside = file === root || file.startsWith(root + path.sep);
    const isDotfile = relative.split('/').some((part) => part.startsWith('.'));
    const isApi = relative === 'api' || relative.startsWith('api/');

    if (!inside || isDotfile || isApi || !existsSync(file) || !statSync(file).isFile()) {
      return reply.callNotFound();
    }

    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Always revalidate so a redeploy is picked up immediately
    return reply.header('content-type', type).header('cache-control', 'no-cache').send(await readFile(file));
  });
}
