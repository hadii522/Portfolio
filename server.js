const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const PUBLIC_FILES = new Set([
  'index.html', 'projects.html', 'style.css', 'loading.js', 'app.js', 'navigation.js', 'projects.js',
  'CV_Aizaz_Haider_Goraya.pdf', 'favicon.ico', 'robots.txt', 'sitemap.xml'
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp', '.avif']);

function isWithin(directory, filePath) {
  const relative = path.relative(directory, filePath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isPublicAsset(segments) {
  if (segments.some(segment => segment.startsWith('.'))) return false;
  if (segments.some(segment => ['tests', 'test', 'evidence', 'analysis'].includes(segment.toLowerCase()))) return false;
  if (/^(?:server\.js|.*\.(?:test|spec)\.js)$/i.test(segments.at(-1))) return false;
  const extension = path.extname(segments.at(-1)).toLowerCase();
  if (!MIME_TYPES[extension]) return false;
  if (segments.length === 1) {
    return PUBLIC_FILES.has(segments[0]) || IMAGE_EXTENSIONS.has(extension);
  }
  return segments[0] === 'assets' || segments[0] === 'ezgif-4dd015d8c5e2912b-jpg';
}

function cacheControl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return 'no-cache';
  // Only a content hash in the filename promises that the image will never change.
  if (/[.-][a-f0-9]{8,}\.(?:jpe?g|png|gif|svg|ico|webp|avif)$/i.test(path.basename(filePath))) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

function createRequestHandler({ publicDir = __dirname, fileSystem = fs } = {}) {
  const publicRoot = fileSystem.realpathSync(path.resolve(publicDir));

  return function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    function respond(status, text, extraHeaders = {}) {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
      });
      res.end(req.method === 'HEAD' ? undefined : text);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respond(405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    let segments;
    try {
      const rawPath = (req.url || '').split('?')[0];
      if (!rawPath.startsWith('/')) throw new Error('Expected a request path');
      const decoded = decodeURIComponent(rawPath).replace(/\\/g, '/');
      if (/[\0-\x1f\x7f:?#]/.test(decoded)) throw new Error('Invalid path character');
      segments = decoded.split('/').filter(Boolean);
      if (segments.includes('..')) {
        respond(403, '403 Forbidden');
        return;
      }
      if (segments.length === 0) segments = ['index.html'];
    } catch {
      respond(400, '400 Bad Request');
      return;
    }

    if (!isPublicAsset(segments)) {
      respond(404, '404 Not Found');
      return;
    }

    const requestedPath = path.resolve(publicRoot, ...segments);
    if (!isWithin(publicRoot, requestedPath)) {
      respond(403, '403 Forbidden');
      return;
    }

    function fileError(error) {
      const status = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 :
        error.code === 'EACCES' || error.code === 'EPERM' ? 403 : 500;
      respond(status, `${status} ${status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : 'Internal Server Error'}`);
    }

    // Resolve symlinks before containment checks as well as checking the URL path.
    try {
      fileSystem.realpath(requestedPath, (realpathError, canonicalPath) => {
        if (realpathError) return fileError(realpathError);
        if (!isWithin(publicRoot, canonicalPath)) return respond(403, '403 Forbidden');
        if (!isPublicAsset(path.relative(publicRoot, canonicalPath).split(path.sep))) {
          return respond(403, '403 Forbidden');
        }

        try {
          fileSystem.stat(canonicalPath, (statError, stats) => {
            if (statError) return fileError(statError);
            if (!stats.isFile()) return respond(404, '404 Not Found');

            const headers = {
              'Content-Type': MIME_TYPES[path.extname(canonicalPath).toLowerCase()],
              'Content-Length': stats.size,
              'Cache-Control': cacheControl(canonicalPath)
            };

            if (req.method === 'HEAD') {
              res.writeHead(200, headers);
              res.end();
              return;
            }

            let stream;
            try {
              stream = fileSystem.createReadStream(canonicalPath);
              stream.on('error', error => {
                if (res.destroyed) return;
                if (res.headersSent) res.destroy();
                else fileError(error);
              });
              res.once('close', () => stream.destroy());
              // Wait until the file opens so an open failure can return an error status.
              stream.once('open', () => {
                if (res.destroyed) return stream.destroy();
                res.writeHead(200, headers);
                stream.pipe(res);
              });
            } catch (error) {
              if (stream) stream.destroy();
              if (res.headersSent) res.destroy();
              else fileError(error);
            }
          });
        } catch (error) {
          fileError(error);
        }
      });
    } catch (error) {
      fileError(error);
    }
  };
}

function createServer(options) {
  return http.createServer(createRequestHandler(options));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.on('error', error => {
    console.error(`Could not start portfolio server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Portfolio preview: http://${host}:${server.address().port}`);
  });
}

module.exports = { createServer, createRequestHandler };
