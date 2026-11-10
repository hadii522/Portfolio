const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { once } = require('node:events');
const publicDir = path.resolve(process.env.PORTFOLIO_TEST_SITE_ROOT || path.resolve(__dirname, '..'));
const { createRequestHandler, createServer } = require(path.join(publicDir, 'server.js'));
const source = Buffer.from('portfolio fixture');

class Response extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.chunks = [];
    this.statusCode = null;
    this.headersSent = false;
  }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers) {
    assert.equal(this.headersSent, false, 'response headers must only be sent once');
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
  }
  _write(chunk, encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
  get body() { return Buffer.concat(this.chunks).toString(); }
}

function mockFileSystem(overrides = {}) {
  return {
    realpathSync: target => target,
    realpath: (target, done) => queueMicrotask(() => done(null, target)),
    stat: (target, done) => queueMicrotask(() => done(null, { size: source.length, isFile: () => true })),
    createReadStream: () => {
      const stream = Readable.from([source]);
      queueMicrotask(() => stream.emit('open', 1));
      return stream;
    },
    ...overrides
  };
}

async function request(url, { method = 'GET', fileSystem = mockFileSystem() } = {}) {
  const response = new Response();
  const completed = once(response, 'close');
  createRequestHandler({ publicDir, fileSystem })({ url, method }, response);
  await completed;
  return response;
}

test('importing the server creates no listening socket', () => {
  const server = createServer();
  assert.equal(server.listening, false);
});

test('homepage and query-string assets return complete bodies and MIME types', async () => {
  const page = await request('/');
  assert.equal(page.statusCode, 200);
  assert.equal(page.body, source.toString());
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['cache-control'], 'no-cache');
  const image = await request('/assets/thumbnails/sharego.webp?v=2');
  assert.equal(image.statusCode, 200);
  assert.equal(image.headers['content-type'], 'image/webp');
});

test('HEAD returns GET metadata without opening or returning the file body', async () => {
  const response = await request('/CV_Aizaz_Haider_Goraya.pdf', {
    method: 'HEAD',
    fileSystem: mockFileSystem({ createReadStream() { throw new Error('HEAD must not open a stream'); } })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '');
  assert.equal(response.headers['content-length'], source.length);
  assert.equal(response.headers['content-type'], 'application/pdf');
});

test('unsupported methods return 405 and the supported method list', async () => {
  const response = await request('/', { method: 'POST' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

for (const url of ['/%00', '/assets/%00.webp', '/%', '/%ZZ', '/%0a', '/C:%5Csecret.png', '/assets/picture.png%3Astream', 'http://example.com/index.html']) {
  test(`malformed URL ${JSON.stringify(url)} returns 400 without filesystem access`, async () => {
    const response = await request(url, {
      fileSystem: mockFileSystem({ realpath() { throw new Error('invalid URL reached filesystem'); } })
    });
    assert.equal(response.statusCode, 400);
  });
}

for (const url of ['/../index.html', '/%2e%2e/index.html', '/assets/../../index.html', '/assets%5C..%5C..%5Cindex.html']) {
  test(`traversal ${JSON.stringify(url)} returns 403`, async () => {
    assert.equal((await request(url)).statusCode, 403);
  });
}

for (const url of ['/.env', '/.git/config', '/server.js', '/tests/server.test.js', '/assets/.env', '/assets/tests/suite.js', '/assets/app.test.js', '/analysis.md', '/unknown.bin']) {
  test(`internal or unsupported asset ${JSON.stringify(url)} is unavailable`, async () => {
    assert.equal((await request(url)).statusCode, 404);
  });
}

test('realpath containment rejects a symlink into a sibling with the same prefix', async () => {
  const response = await request('/assets/thumbnails/sharego.webp', {
    fileSystem: mockFileSystem({
      realpath: (target, done) => queueMicrotask(() => done(null, path.join(`${publicDir}-private`, 'secret.webp')))
    })
  });
  assert.equal(response.statusCode, 403);
});

test('a public-looking symlink cannot expose an internal file inside the public root', async () => {
  const response = await request('/assets/thumbnails/sharego.webp', {
    fileSystem: mockFileSystem({
      realpath: (target, done) => queueMicrotask(() => done(null, path.join(publicDir, 'server.js')))
    })
  });
  assert.equal(response.statusCode, 403);
});

test('missing files and directories return 404', async () => {
  const missing = await request('/missing.png', {
    fileSystem: mockFileSystem({ realpath: (target, done) => queueMicrotask(() => done({ code: 'ENOENT' })) })
  });
  assert.equal(missing.statusCode, 404);
  const directory = await request('/assets/folder.png', {
    fileSystem: mockFileSystem({ stat: (target, done) => queueMicrotask(() => done(null, { isFile: () => false })) })
  });
  assert.equal(directory.statusCode, 404);
});

test('synchronous filesystem failures return an error instead of escaping the request handler', async () => {
  const response = await request('/index.html', {
    fileSystem: mockFileSystem({ stat() { throw Object.assign(new Error('read denied'), { code: 'EACCES' }); } })
  });
  assert.equal(response.statusCode, 403);
});

test('a file disappearing before open returns 404 instead of crashing', async () => {
  const response = await request('/index.html', {
    fileSystem: mockFileSystem({
      createReadStream() {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => stream.destroy(Object.assign(new Error('gone'), { code: 'ENOENT' })));
        return stream;
      }
    })
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, '404 Not Found');
});

test('read errors after headers close only the affected response', async () => {
  const response = await request('/index.html', {
    fileSystem: mockFileSystem({
      createReadStream() {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => {
          stream.emit('open', 1);
          stream.destroy(Object.assign(new Error('read failed'), { code: 'EIO' }));
        });
        return stream;
      }
    })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.destroyed, true);
  assert.equal((await request('/index.html')).statusCode, 200, 'later requests still succeed');
});

test('only content-hashed images receive immutable caching', async () => {
  const hashed = await request('/assets/thumbnails/sharego.a1b2c3d4.webp');
  assert.equal(hashed.headers['cache-control'], 'public, max-age=31536000, immutable');
  const ordinary = await request('/assets/thumbnails/sharego.webp');
  assert.equal(ordinary.headers['cache-control'], 'public, max-age=3600');
  const app = await request('/app.js');
  assert.equal(app.headers['cache-control'], 'no-cache');
});

test('real portfolio file can be streamed through the handler without socket access', async () => {
  const response = await request('/projects.html', { fileSystem: require('node:fs') });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<!DOCTYPE html>/i);
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
});

for (const filename of ['navigation.js', 'projects.js', 'loading.js']) {
  test(`public script ${filename} streams successfully with JavaScript MIME and revalidation`, async () => {
    const response = await request(`/${filename}`, { fileSystem: require('node:fs') });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /\(\(\) => \{/);
    assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-cache');
  });
}
