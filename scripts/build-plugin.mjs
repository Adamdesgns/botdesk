import { build } from 'esbuild';
import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/botdoor-plugin');
await mkdir(resolve(output, 'runtime'), { recursive: true });
for (const file of ['plugin.json', 'mcp.json', 'README.md']) await copyFile(resolve(root, 'plugins/botdoor', file), resolve(output, file));
await cp(resolve(root, 'plugins/botdoor/skills'), resolve(output, 'skills'), { recursive: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
await copyFile(resolve(root, 'host/ui/assets/icon.png'), resolve(output, 'assets/icon.png'));
await build({
  entryPoints: [resolve(root, 'mcp/server.mjs')],
  outfile: resolve(output, 'runtime/server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', tsconfigRaw: {},
  banner: { js: "import { createRequire as botdoorCreateRequire } from 'node:module'; const require = botdoorCreateRequire(import.meta.url);" },
  metafile: true, legalComments: 'eof'
}).then(async (result) => {
  const packages = [...new Set(Object.keys(result.metafile.inputs).filter((p) => p.includes('node_modules/')).map((p) => p.split('node_modules/').at(-1).split('/').slice(0, p.split('node_modules/').at(-1).startsWith('@') ? 2 : 1).join('/')))];
  const notices = [];
  for (const name of packages) {
    const base = resolve(root, 'node_modules', name);
    const metadata = JSON.parse(await readFile(resolve(base, 'package.json'), 'utf8'));
    let license = '';
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE']) {
      try { license = await readFile(resolve(base, candidate), 'utf8'); break; } catch {}
    }
    if (!license) throw new Error(`Missing bundled dependency license: ${name}`);
    notices.push(`${name} ${metadata.version}\n${license}`);
  }
  await writeFile(resolve(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n--------------------\n\n'));
});
await writeFile(resolve(root, 'dist/botdoor-marketplace.json'), JSON.stringify({ name: 'botdoor-local', interface: { displayName: 'BotDoor Local' }, plugins: [{ name: 'botdoor', source: { source: 'local', path: './botdoor-plugin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2));
console.log('Built dist/botdoor-plugin; no host or relay changes.');
