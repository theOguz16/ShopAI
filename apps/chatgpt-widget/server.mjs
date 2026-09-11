import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const host = process.env.WIDGET_HOST ?? '127.0.0.1';
const port = Number(process.env.WIDGET_PORT ?? 3001);
const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(process.env.WIDGET_DIST_DIR ?? join(here, 'dist'));
const assetFiles = new Map([
  ['/assets/widget-v3.js', { file: 'assets/widget-v3.js', type: 'application/javascript; charset=utf-8' }],
  ['/assets/widget-v3.css', { file: 'assets/widget-v3.css', type: 'text/css; charset=utf-8' }],
]);

async function assetsReady() {
  await Promise.all(
    [...assetFiles.values()].map(({ file }) => access(join(distRoot, file))),
  );
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

const server = createServer(async (request, response) => {
  try {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://widget.internal');

    if (!['GET', 'HEAD'].includes(method)) {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }

    if (url.pathname === '/health/live') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/health/ready') {
      try {
        await assetsReady();
        sendJson(response, 200, { status: 'ok' });
      } catch {
        sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

    const asset = assetFiles.get(url.pathname);
    if (!asset) {
      response.writeHead(404, {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end();
      return;
    }

    const content = await readFile(join(distRoot, asset.file));
    response.writeHead(200, {
      'content-type': asset.type,
      'content-length': String(content.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    if (method === 'HEAD') response.end();
    else response.end(content);
  } catch (error) {
    console.error('Widget asset request failed', error);
    sendJson(response, 500, { status: 'error' });
  }
});

server.listen(port, host, () => {
  console.log(`ShopAI widget assets listening on http://${host}:${port}`);
});
