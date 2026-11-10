import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const pages = ['index.html', 'projects.html'];
const files = [...pages, 'style.css', 'app.js', 'navigation.js', 'projects.js', 'favicon.svg', 'CV_Aizaz_Haider_Goraya.pdf'];
const expected = new Set([...files, '.nojekyll', 'robots.txt', 'sitemap.xml']);

function assetFiles(directory, relative = 'assets') {
  const result = [];
  if (lstatSync(directory).isSymbolicLink()) throw new Error(`Symbolic links cannot be published: ${relative}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    const destination = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links cannot be published: ${destination}`);
    if (entry.isDirectory()) result.push(...assetFiles(source, destination));
    else {
      if (!/\.(webp|png|jpe?g|svg|ico|woff2?)$/i.test(entry.name)) throw new Error(`Unexpected public asset: ${destination}`);
      result.push(destination);
    }
  }
  return result;
}

const assets = assetFiles(path.join(root, 'assets'));
for (const asset of assets) expected.add(asset);
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('The output directory cannot be a symbolic link.');
mkdirSync(output, { recursive: true });
for (const file of [...files, ...assets]) {
  const source = path.join(root, file);
  if (lstatSync(source).isSymbolicLink()) throw new Error(`Symbolic link in publish input: ${file}`);
  const destination = path.join(output, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination);
}

const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
if (siteUrl) {
  const base = new URL(`${siteUrl}/`);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('SITE_URL must use HTTPS.');
  for (const page of pages) {
    const target = new URL(page === 'index.html' ? './' : page, base).href;
    const image = new URL('assets/thumbnails/sharego.webp', base).href;
    const file = path.join(output, page);
    let html = readFileSync(file, 'utf8');
    html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(">)/g, `$1${image}$2`);
    html = html.replace('</head>', `  <link rel="canonical" href="${target}">\n  <meta property="og:url" content="${target}">\n</head>`);
    writeFileSync(file, html);
  }
  writeFileSync(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', base).href}\n`);
  writeFileSync(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(page => `<url><loc>${new URL(page === 'index.html' ? './' : page, base).href}</loc></url>`).join('')}</urlset>\n`);
} else {
  writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n');
}
writeFileSync(path.join(output, '.nojekyll'), '');

function validate(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in output: ${name}`);
    if (entry.isDirectory()) validate(path.join(directory, entry.name), name);
    else if (!expected.has(name)) throw new Error(`Unexpected output file; review it before publishing: ${name}`);
  }
}
validate(output);
console.log(`Static portfolio built: ${files.length + assets.length + 3} public files in dist/.`);
