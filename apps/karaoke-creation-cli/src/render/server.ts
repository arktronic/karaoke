import { createServer, type Server } from 'node:http';
import express from 'express';

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
  const app = express();
  app.get('/', (_req, res) => res.type('html').send(indexHtml));
  for (const route of routes) {
    app.use(route.prefix, express.static(route.dir, { index: false, redirect: false }));
  }

  const server: Server = createServer(app);

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
