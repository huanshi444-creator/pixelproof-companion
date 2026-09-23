const assert=require('node:assert/strict');
const {collectMatched,resolve}=require('../companion/token-evidence.cjs');
let count=0;
function test(name,fn){fn();console.log('PASS '+name);count++;}
const range=n=>({startLine:n,startColumn:0,endLine:n,endColumn:40});
function rule(value,line=0,options={}){return {rule:{origin:options.origin||'regular',selectorList:{text:options.selector||'.card',selectors:[{text:options.selector||'.card',specificity:options.specificity||{a:0,b:1,c:0}}]},style:{styleSheetId:options.sheet||'s1',cssProperties:[{name:options.property||'color',value,text:'color:'+value,range:range(line),important:!!options.important}]},layers:options.layers||[]},matchingSelectors:[0]};}
function collect(rules,owner='html > body > .card',depth=0,output=[]){collectMatched({matchedCSSRules:rules},owner,depth,output,new Map());return output;}
test('later literal wins, overridden token is evidence rather than winner',()=>{const r=resolve('color',collect([rule('var(--text)',1),rule('#fff',2)]));assert.equal(r.chosen.value,'#fff');assert.equal(r.reliable,true);assert.deepEqual(r.overriddenTokenRefs,['--text']);});
test('specificity beats later declaration',()=>{const r=resolve('color',collect([rule('var(--text)',1,{specificity:{a:1,b:0,c:0}}),rule('#fff',2)]));assert.equal(r.chosen.value,'var(--text)');});
test('important beats inline normal',()=>{const d=collect([rule('#fff',0,{important:true})]);collectMatched({inlineStyle:{cssProperties:[{name:'color',value:'#000',text:'color:#000',range:range(0)}]}},'owner',0,d,new Map());assert.equal(resolve('color',d).chosen.value,'#fff');});
test('inherited parent declaration is one stable cause across children',()=>{const a=collect([rule('#fff',1)],'parent',1),b=collect([rule('#fff',1)],'parent',1);assert.equal(resolve('color',a).chosen.declarationId,resolve('color',b).chosen.declarationId);});
test('noninherited padding does not inherit parent declaration',()=>{const d=collect([rule('16px',1,{property:'padding-left'})],'parent',1);assert.equal(resolve('padding-left',d).reliable,false);});
test('own declaration beats important ancestor',()=>{const d=collect([rule('#111',1)]);collect([rule('#fff',2,{important:true})],'parent',1,d);assert.equal(resolve('color',d).chosen.value,'#111');});
test('own user agent declaration prevents erroneous ancestor attribution',()=>{const d=collect([rule('ButtonText',1,{origin:'user-agent'})]);collect([rule('var(--text)',2)],'parent',1,d);assert.equal(resolve('color',d).reliable,false);});
test('author normal overrides user agent normal',()=>{const d=collect([rule('ButtonText',1,{origin:'user-agent'}),rule('#fff',2)]);assert.equal(resolve('color',d).reliable,true);});
test('cascade layers remain explicitly unverifiable',()=>{assert.equal(resolve('color',collect([rule('#fff',0,{layers:[{text:'theme'}]})])).reliable,false);});
test('cross stylesheet order is not guessed',()=>{assert.equal(resolve('color',collect([rule('#fff',0),rule('#000',1,{sheet:'s2'})])).reliable,false);});
test('shorthand var is not assigned to every longhand',()=>{assert.equal(resolve('padding-top',collect([rule('0 0 0 var(--space)',0,{property:'padding'})])).reliable,false);});
test('independent inline declarations cannot share a cause ID',()=>{const a=[],b=[];const matched={inlineStyle:{styleSheetId:'same-inline-sheet',cssProperties:[{name:'color',value:'#fff',text:'color:#fff',range:range(0)}]}};collectMatched(matched,'a',0,a,new Map());collectMatched(matched,'b',0,b,new Map());assert.notEqual(a[0].declarationId,b[0].declarationId);});
console.log(count+' CSS attribution regression cases passed.');
test('later corner override invalidates aggregate border-radius attribution',()=>{const d=collect([rule('var(--radius)',1,{property:'border-radius'}),rule('3px',2,{property:'border-top-left-radius'})]);assert.equal(resolve('border-radius',d).reliable,false);});
test('logical padding is not ignored when checking physical padding',()=>{const d=collect([rule('var(--space)',1,{property:'padding-left'}),rule('4px',2,{property:'padding-inline-start'})]);assert.equal(resolve('padding-left',d).reliable,false);});
console.log('Total: '+count+' CSS attribution regression cases passed.');
