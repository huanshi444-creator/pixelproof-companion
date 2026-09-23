const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const extracted=path.resolve(process.argv[2]);
for(const name of ['server.cjs','token-evidence.cjs']){
  assert(fs.readFileSync(path.join(extracted,'app/companion',name)).equals(fs.readFileSync(path.join(root,'companion',name))),`Packaged ${name} differs from release source`);
}
assert(fs.existsSync(path.join(extracted,'app/node_modules/playwright-core/package.json')));
const runtime=path.join(extracted,'runtime',process.platform==='win32'?'node.exe':'node-'+process.arch);
assert(fs.existsSync(runtime));
execFileSync(runtime,['--version'],{stdio:'inherit'});
execFileSync(process.execPath,[path.join(__dirname,'capture_safety_test.cjs')],{
  stdio:'inherit',timeout:300000,
  env:{...process.env,PIXELPROOF_TEST_NODE:runtime,PIXELPROOF_TEST_SERVER:path.join(extracted,'app/companion/server.cjs')}
});
console.log('Clean extraction verified: exact source bytes, bundled Node/dependencies, real capture, cancellation and navigation gate.');
