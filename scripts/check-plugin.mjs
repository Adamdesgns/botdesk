import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runMcpSmoke } from './mcp-smoke.mjs';

const folder = fileURLToPath(new URL('../dist/botdoor-plugin/', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(folder, 'plugin.json'), 'utf8'));
const presentation = manifest.extensions['com.openai'].interface;
assert.equal(manifest.name, 'botdoor');
assert.equal(manifest.version, '1.7.0');
assert.ok(presentation.displayName.length <= 30);
assert.ok(presentation.shortDescription.length <= 30);
assert.ok(presentation.longDescription.length <= 4000);
for (const path of [presentation.logo, presentation.composerIcon, manifest.extensions['com.openai'].onboardingSkill]) {
  assert.ok(path.startsWith('./') && !path.includes('..'));
  assert.ok((await stat(resolve(folder, path))).isFile());
}
const icon = await readFile(resolve(folder, presentation.logo));
assert.equal(icon.toString('ascii', 12, 16), 'IHDR');
assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20));
assert.ok(icon.readUInt32BE(16) >= 48);
const config = JSON.parse(await readFile(resolve(folder, 'mcp.json'), 'utf8'));
assert.equal(config.mcpServers.botdoor.type, 'stdio');
assert.deepEqual(config.mcpServers.botdoor.args, ['${PLUGIN_ROOT}/runtime/server.mjs']);
assert.equal(config.mcpServers.botdoor.env, undefined, 'No embedded environment credentials');
const allowed = new Set(['plugin.json', 'mcp.json', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'assets/icon.png', 'runtime/server.mjs', 'skills/botdoor/SKILL.md']);
async function inventory(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'No linked files in package');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await inventory(resolve(dir, entry.name), `${relative}/`);
    else assert.ok(allowed.has(relative), `Unexpected package file: ${relative}`);
  }
}
await inventory(folder);
for (const file of allowed) assert.ok((await stat(resolve(folder, file))).isFile());
for (const file of allowed) {
  if (file.endsWith('.png')) continue;
  const text = await readFile(resolve(folder, file), 'utf8');
  assert.ok(!/C:[\\/]+Users[\\/]+steam|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/i.test(text), `Private material marker in ${file}`);
  assert.ok(!text.includes('local-smoke-token-123456789'), 'Fixture credentials must not be packaged');
}
const bundled = resolve(folder, 'runtime/server.mjs');
console.log(`Bundled SDK smoke: ${JSON.stringify(await runMcpSmoke(bundled))}`);

// Exercise missing credentials without ever loading a real private configuration.
const privateFreeEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('BOTDESK_')));
const transport = new StdioClientTransport({ command: process.execPath, args: [bundled], env: privateFreeEnv, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'botdoor-package-check', version: '1.7.0' });
try {
  await client.connect(transport, { timeout: 10_000 });
  const result = await client.callTool({ name: 'botdesk_status', arguments: {} });
  assert.equal(result.isError, true, 'Missing credentials must fail closed');
} finally {
  await client.close();
  await transport.close();
}
console.log('Package inventory, listing bounds, icons, bundled tools and missing-credential refusal passed. Public submission gates remain open.');
