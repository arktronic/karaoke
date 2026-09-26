import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startAssetServer, type AssetServer } from '../src/render/server.js';

function get(
  baseUrl: string,
  path: string,
): Promise<{ statusCode: number | undefined; body: string }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port: Number(port), path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startAssetServer', () => {
  let directory: string;
  let server: AssetServer;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'karaoke-assets-'));
    const routeDirectory = join(directory, 'assets');
    await mkdir(routeDirectory);
    await writeFile(join(routeDirectory, 'asset.txt'), 'asset contents');
    server = await startAssetServer([{ prefix: '/assets', dir: routeDirectory }], 'index');
  });

  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves a regular file under the route root', async () => {
    await expect(get(server.baseUrl, '/assets/asset.txt')).resolves.toEqual({
      statusCode: 200,
      body: 'asset contents',
    });
  });

  it('does not serve directories', async () => {
    await expect(get(server.baseUrl, '/assets')).resolves.toMatchObject({ statusCode: 404 });
  });
});
