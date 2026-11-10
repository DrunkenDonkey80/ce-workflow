// Builds the self-contained preview bundle into public/assets and refreshes public/LICENSES.txt.
// Usage: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const outdir = path.join(root, 'public', 'assets');

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [
    {in: 'src/main.jsx', out: 'app'},
    {in: 'src/vendor.css', out: 'astryx'},
  ],
  outdir,
  bundle: true,
  format: 'iife', // classic script: runs in the opaque sandbox without module or network loading
  minify: true,
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
  legalComments: 'none', // notices are collected into LICENSES.txt instead
  metafile: true,
  logLevel: 'warning',
});

// One notice per bundled package, read from that package's own license file.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (!match || packages.has(match[1])) continue;
  const dir = path.join(root, 'node_modules', match[1]);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(dir).find(f => /^licen[cs]e/i.test(f));
  const author = typeof pkg.author === 'object' ? pkg.author.name : pkg.author;
  const text = licenseFile
    ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim()
    : `The installed package ships no license file. Its package.json declares license ${pkg.license}, author ${author}, repository ${pkg.repository?.url ?? pkg.homepage}.`;
  packages.set(match[1], `${pkg.name}@${pkg.version} (${pkg.license})\n\n${text}`);
}
const notices = [...packages.keys()].sort().map(name => packages.get(name));
fs.writeFileSync(
  path.join(root, 'public', 'LICENSES.txt'),
  `Third-party notices for code bundled into assets/app.js and assets/astryx.css.\n\n${notices.join('\n\n' + '-'.repeat(72) + '\n\n')}\n`,
);
console.log(`Built ${Object.keys(result.metafile.outputs).join(', ')}; ${packages.size} bundled packages noted in LICENSES.txt`);
