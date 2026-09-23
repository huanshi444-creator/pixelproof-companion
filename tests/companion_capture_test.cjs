const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const companionPath = path.join(root, 'companion', 'server.cjs');
const testPort = 49323;
const fixturePort = 49324;

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('companion start timeout')), 10000);
    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      if (text.includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('exit', code => reject(new Error(`companion exited early: ${code}`)));
  });
}

(async () => {
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const extraStyle = ':root{--text:#111;--bg:#222}.shared{color:#fff}.override{background-color:var(--bg)}.override{background-color:#123456}#priority{background-color:var(--bg)}.priority{background-color:#fff}.important{background-color:var(--bg)!important}.important{background-color:#fff}.scoped{--bg:#abcdef;background-color:var(--bg)}';
    const extraBody = '<section class="shared">'+Array.from({length:30},(_,i)=>'<span class="inherited">Shared label '+i+'</span>').join('')+'</section><div class="override">Overridden background</div><div id="priority" class="priority">Specificity</div><div class="important" style="background-color:#fff">Important</div><div class="scoped">Scoped token</div><div class="inline" style="color:#fff">Inline one</div><div class="inline" style="color:#fff">Inline two</div>';
    response.end('<!doctype html><html><head><style>:root{--color-action-primary:#2850db;--button-bg:var(--color-action-primary);--spacing-16:16px;--radius-medium:8px;--font-body:Arial}body{margin:0;background:#f4f6fb}main{padding:32px;font:20px var(--font-body)}.confirm{background-color:var(--button-bg);color:white;border:0;padding:14px 24px 14px var(--spacing-16);border-radius:var(--radius-medium)}.confirm::before{content:"OK";color:var(--color-action-primary);margin-right:var(--spacing-16)}</style></head><body><main><h1>PixelProof Fixture</h1><button class="confirm">Confirm</button></main></body></html>'.replace('</style>', extraStyle+'</style>').replace('</body>',extraBody+'</body>'));
  });
  await new Promise(resolve => fixture.listen(fixturePort, '127.0.0.1', resolve));

  const companion = spawn(process.execPath, [companionPath], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PIXELPROOF_PORT: String(testPort) } });
  try {
    await waitForReady(companion);
    const health = await fetch(`http://localhost:${testPort}/health`).then(response => response.json());
    if (!health.ok || health.apiVersion !== 1 || health.version !== '0.3.1' || !health.browserFound || !health.token || !health.capabilities.includes('source-token-scan') || !health.capabilities.includes('pseudo-element-audit')) throw new Error('invalid companion health response');

    const rejected = await fetch(`http://localhost:${testPort}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PixelProof-Token': health.token },
      body: JSON.stringify({ url: `http://127.0.0.1:${fixturePort}/test`, tokenAudit: true, tokenPolicy: { cdtDomain: 'cdt.example.com', strict: false } })
    });
    const rejectedBody = await rejected.json();
    if (rejected.status !== 400 || rejectedBody.ok || !rejectedBody.error.includes('CDT')) throw new Error('strict CDT domain restriction was not enforced');

    const capture = await fetch(`http://localhost:${testPort}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PixelProof-Token': health.token },
      body: JSON.stringify({
        url: `http://127.0.0.1:${fixturePort}/test`,
        width: 390,
        height: 844,
        dpr: 1,
        waitUntil: 'load',
        waitMs: 0,
        fullPage: false,
        tokenAudit: true,
        tokenCategories: ['color', 'spacing', 'radius', 'typography', 'dimension', 'border', 'effect'],
        colorScheme: 'light',
        tokenPolicy: {
          cdtDomain: '127.0.0.1', strict: true, fullDocument: true,
          allowlistValues: ['0', 'none', 'normal', 'transparent'],
          sourceRoot: path.join(root, 'tests', 'fixtures', 'token-source'),
          responsive: [{ width: 412, height: 915 }]
        }
      })
    }).then(response => response.json());

    if (!capture.ok) throw new Error(capture.error || 'capture failed');
    if (!capture.imageBase64 || capture.imageBase64.length < 1000) throw new Error('capture image is empty');
    if (!capture.finalUrl.includes(`127.0.0.1:${fixturePort}`)) throw new Error('unexpected final URL');
    if (!capture.environment || typeof capture.environment.reducedMotion !== 'boolean') throw new Error('capture environment is missing');
    if (!capture.tokenAudit || capture.tokenAudit.scannedElements < 1) throw new Error('DOM/CSS token audit is missing');
    const button = capture.tokenAudit.elements.find(element => element.tag === 'button');
    if (!button) throw new Error('button token evidence is missing');
    if (!button.properties['background-color'].tokenRefs.includes('--button-bg')) throw new Error(`direct color token reference was not preserved: ${JSON.stringify(button.properties)}`);
    if (button.tokenValues['--button-bg'] !== '#2850db' || button.properties['background-color'].aliasChainComplete !== false) throw new Error('scoped computed token value and alias limitations must be preserved');
    if (!button.properties['background-color'].cascadeReliable) throw new Error('simple authored background must be verifiable');
    if (button.properties['padding-top'].cascadeReliable) throw new Error('shorthand var in left padding must not be attributed to top padding');
    if (!button.properties['padding-left'].tokenRefs.includes('--spacing-16')) throw new Error(`spacing token reference was not preserved: ${JSON.stringify(button.properties)}`);
    if (!button.properties['border-radius'].tokenRefs.includes('--radius-medium')) throw new Error(`radius token reference was not preserved: ${JSON.stringify(button.properties)}`);
    if (!capture.tokenAudit.elements.some(element => element.pseudo === 'before')) throw new Error('pseudo-element token evidence is missing');
    if (!capture.tokenAudit.document || capture.tokenAudit.document.height < 844) throw new Error('full document dimensions are missing');
    if (!capture.tokenAudit.sourceAudit || !capture.tokenAudit.sourceAudit.issues.some(issue => issue.file === 'styles.css' && issue.property === 'padding-top')) throw new Error(`source hardcoding scan is missing: ${JSON.stringify(capture.tokenAudit.sourceAudit)}`);
    if (!capture.tokenAudit.responsive || capture.tokenAudit.responsive.length !== 1) throw new Error('responsive token summary is missing');
    const elements=capture.tokenAudit.elements;
    const node=text=>elements.find(e=>e.text===text&&!e.pseudo);
    assert.equal(node('Overridden background').properties['background-color'].authoredValue,'#123456');
    assert.equal(node('Overridden background').properties['background-color'].cascadeReliable,true);
    assert.deepEqual(node('Overridden background').properties['background-color'].overriddenTokenRefs,['--bg']);
    assert.equal(node('Specificity').properties['background-color'].authoredValue,'var(--bg)');
    assert.equal(node('Important').properties['background-color'].authoredValue,'var(--bg)');
    assert.equal(node('Scoped token').tokenValues['--bg'],'#abcdef');
    assert.notEqual(node('Inline one').properties.color.declarationId,node('Inline two').properties.color.declarationId);
    const shared=elements.filter(e=>e.tag==='span'&&e.text.startsWith('Shared label '));
    assert.equal(shared.length,30);
    assert.equal(new Set(shared.map(e=>e.properties.color.declarationId)).size,1);
    assert.ok(shared.every(e=>e.properties.color.cascadeReliable&&e.properties.color.inherited));
    console.log('Live CSS regression passed: override, specificity, important, scoped tokens, independent inline declarations and 30 inherited usages sharing 1 declaration identity. Plugin aggregation is tested in the separate plugin project.');
    const visualCapture=await fetch(`http://localhost:${testPort}/capture`,{method:'POST',headers:{'Content-Type':'application/json','X-PixelProof-Token':health.token},body:JSON.stringify({url:`http://127.0.0.1:${fixturePort}/visual`,width:390,height:844,dpr:2,fullPage:true,waitMs:0,waitUntil:'load',tokenAudit:false})}).then(r=>r.json());
    assert.ok(visualCapture.ok,visualCapture.error);
    assert.equal(visualCapture.visualStructure.schemaVersion,1);
    assert.equal(visualCapture.visualStructure.unstable,false);
    const visualTitle=visualCapture.visualStructure.nodes.find(n=>n.text==='PixelProof Fixture');
    assert.equal(visualTitle.kind,'text');assert.ok(visualTitle.ancestors.length>=2);
    assert.ok(visualTitle.rect.width<390, 'DOM structure uses CSS pixels rather than screenshot DPR pixels');
    assert.equal(visualCapture.tokenAudit,null);
    console.log('Live visual structure capture passed: hierarchy, unique text, CSS coordinates at DPR 2 and before/after screenshot consistency.');
    console.log(`Companion capture + Token audit passed: ${capture.viewport.width}x${capture.viewport.height}, ${capture.tokenAudit.scannedElements} styled elements, ${capture.imageBase64.length} base64 chars.`);
  } finally {
    companion.kill('SIGTERM');
    await new Promise(resolve => fixture.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
