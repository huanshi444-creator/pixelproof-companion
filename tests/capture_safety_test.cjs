// Isolated HTTP fixtures and companion process. Never uses the user's port 49321.
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

(async () => {
  let forbiddenHits = 0, assetHits = 0, slowHits = 0;
  const fixture = http.createServer((req, res) => {
    const port = fixture.address().port;
    if (req.url === '/slow') { slowHits++; return; }
    if (req.url === '/forbidden') forbiddenHits++;
    if (req.url === '/asset.css') { assetHits++;res.writeHead(200, {'Content-Type':'text/css'});res.end('p{color:green}');return; }
    if (req.url === '/outside' || req.url === '/chain') {
      res.writeHead(302, {Location:req.url === '/chain'?'/outside':`http://localhost:${port}/forbidden`});res.end();return;
    }
    if (req.url === '/inside') {res.writeHead(302,{Location:'/ok'});res.end();return;}
    res.writeHead(200, {'Content-Type':'text/html'});
    const script = req.url === '/js' ? `location.href='http://localhost:${port}/forbidden'` : req.url === '/responsive' ? `if(innerWidth>600)location.href='http://localhost:${port}/forbidden'` : '';
    res.end(`<!doctype html><html><head><style>:root{--text:red}p{color:var(--text)}</style>${req.url==='/cdn'?`<link rel="stylesheet" href="http://localhost:${port}/asset.css">`:''}</head><body><p>Inspection fixture</p><script>${script}</script></body></html>`);
  });
  const fixturePort = await listen(fixture);
  const reservation = http.createServer();const companionPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.env.PIXELPROOF_TEST_NODE || process.execPath, [process.env.PIXELPROOF_TEST_SERVER || path.resolve(__dirname,'../companion/server.cjs')], {env:{...process.env,PIXELPROOF_PORT:String(companionPort)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const base=`http://localhost:${companionPort}`;
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Companion startup timed out: '+stderr)),10000);
      child.stdout.on('data',chunk=>{if(String(chunk).includes('listening on')){clearTimeout(timeout);resolve();}});
      child.once('exit',code=>{clearTimeout(timeout);reject(Error('Companion exited '+code+': '+stderr));});
    });
    const health=()=>fetch(base+'/health').then(r=>r.json());
    const initial=await health();assert.equal(initial.version,require('../package.json').version);assert(initial.capabilities.includes('capture-cancel-v1'));assert(initial.capabilities.includes('navigation-domain-guard-v1'));
    const headers={'Content-Type':'application/json','X-PixelProof-Token':initial.token};
    const options=(route,extra={})=>({url:`http://127.0.0.1:${fixturePort}${route}`,width:390,height:844,dpr:1,waitUntil:'load',tokenAudit:true,tokenCategories:['color'],tokenPolicy:{cdtDomain:'127.0.0.1',responsive:[]},...extra});
    const capture=(body,signal)=>fetch(base+'/capture',{method:'POST',headers,body:JSON.stringify(body),signal}).then(r=>r.json());
    const cancel=id=>fetch(base+'/cancel',{method:'POST',headers,body:JSON.stringify({requestId:id})}).then(r=>r.json());
    const idle=async()=>{for(let i=0;i<100;i++){if(!(await health()).busy)return;await sleep(50);}throw Error('Companion did not release cancelled task');};
    const waitSlow=async count=>{for(let i=0;i<100;i++){if(slowHits>=count)return;await sleep(50);}throw Error('Slow capture never started');};
    for (const route of ['/outside','/chain','/js','/responsive']) {
      const result=await capture(options(route,route==='/responsive'?{tokenPolicy:{cdtDomain:'127.0.0.1',responsive:[{width:768,height:1024}]}}:{}));
      assert.equal(result.ok,false,route);assert.match(result.error,/CDT/,route);assert.equal(forbiddenHits,0,'Forbidden document must not be requested');
      console.log('PASS blocked navigation '+route);
    }
    const same=await capture(options('/inside'));assert(same.ok,same.error);assert(same.finalUrl.endsWith('/ok'));
    const allowed=await capture(options('/outside',{tokenPolicy:{cdtDomain:'127.0.0.1,localhost',responsive:[]}}));assert(allowed.ok,allowed.error);assert.equal(new URL(allowed.finalUrl).hostname,'localhost');
    const cdn=await capture(options('/cdn'));assert(cdn.ok,cdn.error);assert(assetHits>0);console.log('PASS allowed redirects and external CSS preserved');
    const forbiddenCancel=await fetch(base+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"requestId":"x"}'});assert.equal(forbiddenCancel.status,403);
    await cancel('before-start');const pre=await capture(options('/ok',{requestId:'before-start'}));assert.equal(pre.ok,false);assert.match(pre.error,/取消/);
    const slow=capture(options('/slow',{requestId:'slow-task'}));await waitSlow(1);
    assert.equal((await cancel('other-task')).cancelled,false);assert.equal((await health()).busy,true);
    assert.equal((await cancel('slow-task')).cancelled,true);const stopped=await slow;assert.equal(stopped.ok,false);assert.match(stopped.error,/取消/);await idle();
    const next=await capture(options('/ok',{requestId:'next-task'}));assert(next.ok,next.error);console.log('PASS cancel authorization, identity, early cancellation and next capture');
    const controller=new AbortController();const disconnected=capture(options('/slow',{requestId:'disconnect'}),controller.signal).catch(error=>({aborted:error.name==='AbortError'}));await waitSlow(2);controller.abort();assert((await disconnected).aborted);await idle();console.log('PASS disconnected client releases browser and busy state');
    // Visual mode has no CDT restriction but must return the actual inspection address.
    const visual=await capture(options('/outside',{tokenAudit:false}));assert(visual.ok,visual.error);assert.equal(new URL(visual.finalUrl).hostname,'localhost');
    console.log('Capture safety integration checks passed.');
  } finally {
    child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode)resolve();else child.once('exit',resolve);});
    fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
