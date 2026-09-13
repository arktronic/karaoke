import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.html': 'text/html',
};

export interface AssetRoute {
  /** URL path prefix, e.g. "/jassub". */
  prefix: string;
  /** Absolute directory on disk served under `prefix`. */
  dir: string;
}

export interface AssetServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Serves static files over HTTP so JASSUB's worker/wasm assets (which it loads via relative URLs
 * that don't survive esbuild bundling into an IIFE) can be fetched from a real origin.
 */
export async function startAssetServer(
  routes: AssetRoute[],
  indexHtml: string,
): Promise<AssetServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(indexHtml);
        return;
      }

      const route = routes.find((r) => url.startsWith(r.prefix));
      if (!route) {
        res.writeHead(404).end();
        return;
      }

      const relativePath = url.slice(route.prefix.length).replace(/^\/+/, '');
      const filePath = join(route.dir, relativePath);
      try {
        await stat(filePath);
      } catch {
        res.writeHead(404).end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      });
      createReadStream(filePath).pipe(res);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to determine asset server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
