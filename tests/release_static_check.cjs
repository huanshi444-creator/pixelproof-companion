const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

for (const relative of [
  'companion/server.cjs',
  'companion/token-evidence.cjs',
  'launcher/build-portable.ps1',
  'launcher-macos/build-macos.sh',
  'launcher-macos/PixelProof Companion.command',
  'launcher-macos/Stop PixelProof Companion.command',
  '.github/workflows/release-companion.yml'
]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing release input: ${relative}`);
}

const macBuild = read('launcher-macos/build-macos.sh');
const macLauncher = read('launcher-macos/PixelProof Companion.command');
const releaseWorkflow = read('.github/workflows/release-companion.yml');
const version = JSON.parse(read('package.json')).version;
if (!read('companion/server.cjs').includes(`SERVICE_VERSION = '${version}'`)) throw new Error('Service/package versions differ');
if (!read('launcher/Program.cs').includes(`AssemblyFileVersion("${version}.0")`)) throw new Error('Windows launcher version differs');
if (!releaseWorkflow.includes('test:capture-safety') || !releaseWorkflow.includes('package_smoke_test.cjs')) throw new Error('Release safety gates missing');

for (const marker of ['PIXELPROOF_NODE_ARM64_BIN', 'PIXELPROOF_NODE_X64_BIN', 'node-arm64', 'node-x64']) {
  if (!macBuild.includes(marker) && !macLauncher.includes(marker)) throw new Error(`Universal macOS marker missing: ${marker}`);
}
for (const asset of ['PixelProof-Companion-macOS.zip', 'PixelProof-Companion-Windows-x64.zip']) {
  if (!releaseWorkflow.includes(asset)) throw new Error(`Stable GitHub Release asset missing: ${asset}`);
}
if (!releaseWorkflow.includes('gh release create') || !releaseWorkflow.includes('gh release upload')) {
  throw new Error('Release workflow must create or update the GitHub Release automatically');
}

console.log('Release static checks passed: Windows package, universal macOS runtimes and stable GitHub assets.');
