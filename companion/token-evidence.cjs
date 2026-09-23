// Conservative authored-declaration attribution. Unsupported cascade features stay unverifiable.
const INHERITED = new Set(['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-shadow','fill','stroke']);
const refs = value => [...new Set([...String(value || '').matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]))];
function specificity(selector) {
  // CDP supplies specificity on recent Chromium. Only fall back for simple selectors.
  if (/[:&\\]|\|/.test(selector)) return null;
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
  const types = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g, '').match(/[a-zA-Z][\w-]*/g) || []).length;
  return [ids, classes, types];
}
function compare(a,b) { for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return a[i]-b[i]; return 0; }
function related(declaration, property) {
  if(declaration.name===property || declaration.name==='all') return true;
  if(property==='border-radius'&&/^border-(top|bottom)-(left|right)-radius$/.test(declaration.name))return true;
  if(['border-width','border-color'].includes(property)&&new RegExp('^border-(top|right|bottom|left)-'+property.split('-')[1]+'$').test(declaration.name))return true;
  if(property==='gap'&&['row-gap','column-gap'].includes(declaration.name))return true;
  if(/^(padding|margin|border)-(inline|block)/.test(declaration.name)&&property.startsWith(declaration.name.split('-')[0]+'-'))return true;
  if(/^(min-|max-)?(inline|block)-size$/.test(declaration.name)&&/^(min-|max-)?(width|height)$/.test(property))return true;
  if(declaration.longhands.includes(property)) return true;
  if(property==='background-color') return declaration.name==='background';
  if(/^(padding|margin)-/.test(property)) return declaration.name===property.split('-')[0];
  if(property.startsWith('border-')) return ['border', `border-${property.split('-')[1]}`, `border-${property.split('-').at(-1)}`].includes(declaration.name);
  if(property.startsWith('font-')||property==='line-height') return declaration.name==='font';
  if(['gap','row-gap','column-gap'].includes(property)) return declaration.name==='gap';
  return false;
}
function collect(style, metadata, output) {
  if(!style) return;
  for(const [index,p] of (style.cssProperties||[]).entries()) {
    if(p.disabled || p.parsedOk===false || p.implicit || !p.value || p.name.startsWith('--')) continue;
    // Generated CDP longhands have no range/text. Keep authored declarations only.
    if(!p.range && !p.text && !metadata.userAgent) continue;
    const range=p.range||style.range;
    const id=[metadata.inline?metadata.owner:(style.styleSheetId||metadata.owner), range&&range.startLine, range&&range.startColumn,p.name,index].join(':');
    const value=p.value.replace(/\s*!important\s*$/i,'').trim();
    output.push({...metadata,name:p.name,value,tokenRefs:refs(value),important:Boolean(p.important||/!important\s*$/i.test(p.value)),
      longhands:(p.longhandProperties||[]).map(item=>item.name),declarationId:id,styleSheetId:style.styleSheetId||null,range,
      order:index,unsupported:metadata.unsupported||p.name==='all'||/^(padding|margin|border)-(inline|block)/.test(p.name)||/^(min-|max-)?(inline|block)-size$/.test(p.name)});
  }
}
function collectMatched(matched, owner, depth, output, sheets) {
  for(const [ruleOrder,match] of (matched.matchedCSSRules||matched.matches||[]).entries()) {
    const rule=match.rule;
    if(!rule) continue;
    const selected=(match.matchingSelectors||[]).map(i=>rule.selectorList?.selectors[i]).filter(Boolean);
    const weights=selected.map(s=>s.specificity?[s.specificity.a,s.specificity.b,s.specificity.c]:specificity(s.text));
    const weight=weights.length&&weights.every(Boolean)?weights.sort(compare).at(-1):null;
    const sheet=sheets.get(rule.style?.styleSheetId);
    collect(rule.style,{owner,depth,inline:false,selector:rule.selectorList?.text||owner,ruleOrder,specificity:weight,
      source:depth?'inherited-rule':'matched-rule',sourceUrl:sheet?.sourceURL||'',userAgent:rule.origin==='user-agent',
      unsupported:!weight||!['regular','injected'].includes(rule.origin)||Boolean(rule.layers?.length||rule.scopes?.length||rule.nestingSelectors?.length||rule.containerQueries?.length||rule.media?.some(m=>m.mediaList?.some(q=>!q.active))||rule.supports?.some(s=>!s.active))},output);
  }
  collect(matched.inlineStyle,{owner,depth,inline:true,selector:owner,ruleOrder:1e9,specificity:[0,0,0],source:depth?'inherited-inline':'inline'},output);
}
function resolve(property, declarations) {
  let candidates=declarations.filter(d=>related(d,property)&&(d.depth===0||INHERITED.has(property)));
  if(!candidates.length) return {chosen:null,reliable:false,reason:'未读取到生效声明',overriddenTokenRefs:[]};
  const nearest=Math.min(...candidates.map(d=>d.depth));
  candidates=candidates.filter(d=>d.depth===nearest);
  if(candidates.some(d=>!d.userAgent)&&!candidates.some(d=>d.userAgent&&d.important))candidates=candidates.filter(d=>!d.userAgent);
  if(candidates.some(d=>d.unsupported)) return {chosen:null,reliable:false,reason:'层叠、选择器或来源暂不能可靠解析',overriddenTokenRefs:[]};
  candidates.sort((a,b)=>Number(a.important)-Number(b.important)||Number(a.inline)-Number(b.inline)||compare(a.specificity,b.specificity)||((a.styleSheetId&&a.styleSheetId===b.styleSheetId)?((a.range?.startLine||0)-(b.range?.startLine||0)||(a.range?.startColumn||0)-(b.range?.startColumn||0)):0)||a.ruleOrder-b.ruleOrder||a.order-b.order);
  const chosen=candidates.at(-1);
  if(candidates.some(d=>d!==chosen&&d.important===chosen.important&&d.inline===chosen.inline&&compare(d.specificity,chosen.specificity)===0&&d.styleSheetId!==chosen.styleSheetId)) {
    return {chosen:null,reliable:false,reason:'同优先级跨样式表声明顺序待确认',overriddenTokenRefs:[]};
  }
  // Shorthand var() may feed a different longhand. Never assert token identity from it.
  const shorthand=chosen.name!==property;
  const reliable=!shorthand&&!/\b(inherit|unset|revert|revert-layer|currentcolor)\b/i.test(chosen.value);
  return {chosen,reliable,reason:reliable?'':'简写或依赖上下文的声明需要人工确认',overriddenTokenRefs:candidates.filter(d=>d!==chosen&&d.name===property).flatMap(d=>d.tokenRefs)};
}
module.exports={collectMatched,resolve};
