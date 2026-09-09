const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = 'localhost';
const PORT = Number(process.env.PIXELPROOF_PORT || 49321);
const API_VERSION = 1;
const SERVICE_VERSION = '0.3.0';
const sessionToken = crypto.randomBytes(24).toString('hex');
let captureInProgress = false;
const TOKEN_PROPERTIES = {
  color: ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'fill', 'stroke'],
  spacing: ['gap', 'row-gap', 'column-gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  radius: ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  typography: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'],
  dimension: ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'],
  border: ['border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  effect: ['opacity', 'box-shadow', 'text-shadow', 'filter', 'backdrop-filter']
};
const TOKEN_SHORTHANDS = new Set(['background', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'padding', 'margin', 'font', 'border-radius']);
const PROPERTY_CATEGORY = Object.fromEntries(Object.entries(TOKEN_PROPERTIES).flatMap(([category, properties]) => properties.map(property => [property, category])));

function loadChromium() {
  try {
    return require('playwright-core').chromium;
  } catch (firstError) {
    try {
      return require('C:/Users/Mayn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright').chromium;
    } catch (secondError) {
      throw new Error('缺少 playwright-core。请在本目录运行 npm install。');
    }
  }
}

function findBrowser() {
  const candidates = [
    process.env.PIXELPROOF_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    `${os.homedir()}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
    `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function isAllowedOrigin(origin) {
  return !origin || origin === 'null' || /^https:\/\/([a-z0-9-]+\.)?figma\.com$/i.test(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, X-PixelProof-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  };
  if (origin === 'null') headers['Access-Control-Allow-Origin'] = 'null';
  if (origin && /^https:\/\/([a-z0-9-]+\.)?figma\.com$/i.test(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function sendJson(response, status, body, origin) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('请求体过大。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('请求 JSON 无效。')); }
    });
    request.on('error', reject);
  });
}

function validateCapture(body) {
  const parsed = new URL(String(body.url || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 http 或 https 地址。');
  const width = Math.max(240, Math.min(3840, Number(body.width) || 390));
  const height = Math.max(320, Math.min(4320, Number(body.height) || 844));
  const dpr = Math.max(1, Math.min(4, Number(body.dpr) || 1));
  const waitMs = Math.max(0, Math.min(10000, Number(body.waitMs) || 0));
  const waitUntil = ['domcontentloaded', 'load', 'networkidle'].includes(body.waitUntil) ? body.waitUntil : 'networkidle';
  const tokenCategories = Array.isArray(body.tokenCategories)
    ? body.tokenCategories.filter(category => Object.hasOwn(TOKEN_PROPERTIES, category))
    : ['color', 'spacing', 'radius'];
  const colorScheme = body.colorScheme === 'dark' ? 'dark' : 'light';
  const rawPolicy = body.tokenPolicy && typeof body.tokenPolicy === 'object' ? body.tokenPolicy : {};
  const tokenPolicy = {
    cdtDomain: String(rawPolicy.cdtDomain || '').slice(0, 500),
    strict: rawPolicy.strict !== false,
    fullDocument: rawPolicy.fullDocument !== false,
    allowlistValues: Array.isArray(rawPolicy.allowlistValues) ? rawPolicy.allowlistValues.map(value => String(value).slice(0, 160)).slice(0, 80) : [],
    mappingTable: rawPolicy.mappingTable && typeof rawPolicy.mappingTable === 'object' ? rawPolicy.mappingTable : {},
    sourceRoot: String(rawPolicy.sourceRoot || '').slice(0, 1000),
    responsive: Array.isArray(rawPolicy.responsive) ? rawPolicy.responsive.map(item => ({ width: Math.max(240, Math.min(3840, Number(item.width) || width)), height: Math.max(320, Math.min(4320, Number(item.height) || height)) })).slice(0, 6) : []
  };
  if (body.tokenAudit) {
    const rules = tokenPolicy.cdtDomain.split(',').map(value => value.trim()).filter(Boolean);
    if (!rules.length) throw new Error('Token 合规检查缺少 CDT 允许域名。');
    if (!rules.some(rule => domainMatches(parsed.hostname, rule))) throw new Error(`当前域名 ${parsed.hostname} 不在 CDT 允许范围内。`);
  }
  return {
    url: parsed.href,
    width,
    height,
    dpr,
    waitMs,
    waitUntil,
    fullPage: Boolean(body.fullPage),
    tokenAudit: Boolean(body.tokenAudit),
    tokenCategories: tokenCategories.length ? tokenCategories : ['color'],
    colorScheme,
    tokenPolicy
  };
}

function domainMatches(hostname, rule) {
  const host = String(hostname || '').toLowerCase();
  const normalized = String(rule || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!normalized) return false;
  if (normalized.startsWith('*.')) {
    const root = normalized.slice(2);
    return host === root || host.endsWith(`.${root}`);
  }
  return host === normalized;
}

function attributeMap(attributes = []) {
  const map = {};
  for (let index = 0; index < attributes.length; index += 2) map[attributes[index]] = attributes[index + 1];
  return map;
}

function tokenReferences(value) {
  const refs = [];
  const pattern = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = pattern.exec(String(value || '')))) if (!refs.includes(match[1])) refs.push(match[1]);
  return refs;
}

function collectDeclarations(style, selector, source, targetSet, output) {
  if (!style || !Array.isArray(style.cssProperties)) return;
  for (const property of style.cssProperties) {
    const name = String(property.name || '').toLowerCase();
    if ((!targetSet.has(name) && !TOKEN_SHORTHANDS.has(name)) || property.disabled || !property.value) continue;
    output.push({
      name,
      value: property.value,
      tokenRefs: tokenReferences(property.value),
      selector,
      source,
      important: Boolean(property.important)
    });
  }
}

function resolvedTokenChain(refs, tokenValues) {
  const output = [];
  const queue = [...refs];
  const seen = new Set();
  while (queue.length && output.length < 24) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    output.push(ref);
    for (const nested of tokenReferences(tokenValues && tokenValues[ref])) queue.push(nested);
  }
  return output;
}

async function inspectPageTokens(page, categories, policy = {}) {
  const targetProperties = [...new Set(categories.flatMap(category => TOKEN_PROPERTIES[category] || []))];
  const evaluated = await page.evaluate(({ targetProperties, categories, propertyCategories, fullDocument }) => {
    const categoryFor = property => propertyCategories[property] || (property.includes('margin') || property.includes('padding') || property.includes('gap') ? 'spacing' : 'dimension');
    const meaningful = (property, value, style) => {
      if (!value) return false;
      if (property === 'background-color' && /rgba?\(0, 0, 0(?:, 0)?\)/.test(value)) return false;
      if ((property === 'fill' || property === 'stroke') && value === 'none') return false;
      if (property.startsWith('border-') && property.endsWith('-color')) {
        const side = property.split('-')[1];
        if (parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0) return false;
      }
      if (categoryFor(property) === 'typography' && property === 'font-family' && !value.trim()) return false;
      if (categoryFor(property) === 'effect' && property === 'box-shadow' && value === 'none') return false;
      if ((categoryFor(property) === 'spacing' || categoryFor(property) === 'radius' || categoryFor(property) === 'dimension' || categoryFor(property) === 'border') && value === 'normal') return false;
      return true;
    };
    const selectorFor = element => {
      if (element.id) return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 4) {
        let part = current.tagName.toLowerCase();
        const classes = [...current.classList].filter(name => !name.startsWith('pixelproof-')).slice(0, 2);
        if (classes.length) part += `.${classes.map(name => CSS.escape(name)).join('.')}`;
        else if (current.parentElement) {
          const same = [...current.parentElement.children].filter(child => child.tagName === current.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const globalTokenValues = {};
    const readRules = rules => {
      for (const rule of rules || []) {
        try {
          if (rule.style) for (let index = 0; index < rule.style.length; index += 1) { const name = rule.style[index]; if (name.startsWith('--')) globalTokenValues[name] = rule.style.getPropertyValue(name).trim(); }
          if (rule.cssRules) readRules(rule.cssRules);
        } catch {}
      }
    };
    for (const sheet of document.styleSheets) { try { readRules(sheet.cssRules); } catch {} }
    const nodes = [document.documentElement, document.body, ...document.querySelectorAll('body *')];
    const items = [];
    for (const element of nodes) {
      if (items.length >= (fullDocument ? 900 : 300)) break;
      if (!(element instanceof Element) || ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(element.tagName)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      if (!fullDocument && (rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight)) continue;
      const computed = {};
      for (const property of targetProperties) {
        if (!categories.includes(categoryFor(property))) continue;
        const value = style.getPropertyValue(property).trim();
        if (meaningful(property, value, style)) computed[property] = value;
      }
      if (!Object.keys(computed).length) continue;
      const tokenValues = { ...globalTokenValues };
      for (let index = 0; index < style.length && Object.keys(tokenValues).length < 240; index += 1) {
        const name = style[index];
        if (name.startsWith('--') && !Object.hasOwn(tokenValues, name)) tokenValues[name] = style.getPropertyValue(name).trim();
      }
      const id = `pp-${items.length + 1}`;
      element.setAttribute('data-pixelproof-node', id);
      const directText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 80);
      items.push({
        id,
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: directText,
        rect: {
          x: Number((rect.x + scrollX).toFixed(2)),
          y: Number((rect.y + scrollY).toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        },
        computed,
        tokenValues
      });
      for (const pseudo of ['before', 'after']) {
        const pseudoStyle = getComputedStyle(element, `::${pseudo}`);
        const content = pseudoStyle.content;
        if (!content || content === 'none' || content === 'normal' || items.length >= (fullDocument ? 900 : 300)) continue;
        const pseudoComputed = {};
        for (const property of targetProperties) {
          if (!categories.includes(categoryFor(property))) continue;
          const value = pseudoStyle.getPropertyValue(property).trim();
          if (meaningful(property, value, pseudoStyle)) pseudoComputed[property] = value;
        }
        if (Object.keys(pseudoComputed).length) items.push({id:`${id}-${pseudo}`,ownerId:id,pseudo,selector:`${selectorFor(element)}::${pseudo}`,tag:`::${pseudo}`,text:content.slice(0,80),rect:{x:Number((rect.x+scrollX).toFixed(2)),y:Number((rect.y+scrollY).toFixed(2)),width:Number(rect.width.toFixed(2)),height:Number(rect.height.toFixed(2))},computed:pseudoComputed,tokenValues});
      }
    }
    return {items,document:{width:Math.max(document.documentElement.scrollWidth,document.body&&document.body.scrollWidth||0,innerWidth),height:Math.max(document.documentElement.scrollHeight,document.body&&document.body.scrollHeight||0,innerHeight)}};
  }, { targetProperties, categories, propertyCategories: PROPERTY_CATEGORY, fullDocument: policy.fullDocument !== false });
  const snapshots = evaluated.items;

  const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
  const targetSet = new Set(targetProperties);
  let session;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 1, pierce: true });
    const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-pixelproof-node]' });
    const queue = [...nodeIds];
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (queue.length) {
        const nodeId = queue.shift();
        try {
          const { attributes } = await session.send('DOM.getAttributes', { nodeId });
          const id = attributeMap(attributes)['data-pixelproof-node'];
          const snapshot = byId.get(id);
          if (!snapshot) continue;
          const matched = await session.send('CSS.getMatchedStylesForNode', { nodeId });
          const declarations = [];
          for (const entry of matched.inherited || []) {
            for (const match of entry.matchedCSSRules || []) collectDeclarations(match.rule && match.rule.style, match.rule && match.rule.selectorList && match.rule.selectorList.text, 'inherited-rule', targetSet, declarations);
            collectDeclarations(entry.inlineStyle, 'style attribute', 'inherited-inline', targetSet, declarations);
          }
          for (const match of matched.matchedCSSRules || []) collectDeclarations(match.rule && match.rule.style, match.rule && match.rule.selectorList && match.rule.selectorList.text, 'matched-rule', targetSet, declarations);
          collectDeclarations(matched.inlineStyle, 'style attribute', 'inline', targetSet, declarations);
          const assignProperties = (target, ruleDeclarations) => {
            target.properties = {};
            for (const [name, computed] of Object.entries(target.computed || {})) {
            const related = declaration => {
              if (declaration.name === name) return true;
              if (name === 'background-color') return declaration.name === 'background';
              if (name.startsWith('padding-')) return declaration.name === 'padding';
              if (name.startsWith('margin-')) return declaration.name === 'margin';
              if (name.startsWith('border-') && name.endsWith('-width')) return declaration.name === 'border' || declaration.name === `border-${name.split('-')[1]}`;
              if (name.startsWith('border-') && name.endsWith('-radius')) return declaration.name === 'border-radius';
              if (name.startsWith('border-') && name.endsWith('-color')) {
                const side = name.split('-')[1];
                return ['border', 'border-color', `border-${side}`].includes(declaration.name);
              }
              return false;
            };
            const candidates = ruleDeclarations.filter(related);
            const tokenCandidates = candidates.filter(candidate => candidate.tokenRefs.length);
            const chosen = tokenCandidates.at(-1) || candidates.at(-1) || null;
            target.properties[name] = {
              computed,
              authoredValue: chosen ? chosen.value : computed,
              tokenRefs: chosen ? chosen.tokenRefs : [],
              tokenChain: resolvedTokenChain(chosen ? chosen.tokenRefs : [], target.tokenValues),
              selector: chosen ? chosen.selector : snapshot.selector,
              source: chosen ? chosen.source : (target.pseudo ? 'computed-pseudo' : 'computed')
            };
          }
            delete target.computed;
          };
          assignProperties(snapshot, declarations);
          for (const pseudoSnapshot of snapshots.filter(item => item.ownerId === id)) {
            const pseudoMatch = (matched.pseudoElements || []).find(item => String(item.pseudoType || '').toLowerCase() === pseudoSnapshot.pseudo);
            const pseudoDeclarations = [];
            for (const match of pseudoMatch && pseudoMatch.matches || []) collectDeclarations(match.rule && match.rule.style, match.rule && match.rule.selectorList && match.rule.selectorList.text, 'pseudo-rule', targetSet, pseudoDeclarations);
            assignProperties(pseudoSnapshot, pseudoDeclarations);
          }
        } catch {}
      }
    });
    await Promise.all(workers);
  } catch {
    for (const snapshot of snapshots) {
      snapshot.properties = Object.fromEntries(Object.entries(snapshot.computed).map(([name, computed]) => [name, {
        computed,
        authoredValue: computed,
        tokenRefs: [], tokenChain: [],
        selector: snapshot.selector,
        source: 'computed'
      }]));
      delete snapshot.computed;
    }
  } finally {
    if (session) await session.detach().catch(() => {});
    await page.evaluate(() => document.querySelectorAll('[data-pixelproof-node]').forEach(element => element.removeAttribute('data-pixelproof-node'))).catch(() => {});
  }

  return {
    scannedElements: snapshots.length,
    truncated: snapshots.length >= (policy.fullDocument !== false ? 900 : 300),
    categories,
    document: evaluated.document,
    elements: snapshots
  };
}

function sourcePropertyName(value) {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/^['"]|['"]$/g, '').toLowerCase();
}

function hardcodedSourceValue(property, value, allowlist) {
  const normalized = String(value || '').replace(/!important\s*/ig, '').replace(/[;,]\s*$/, '').trim();
  if (!normalized || allowlist.has(normalized.toLowerCase()) || (allowlist.has('0') && /^-?0(?:\.0+)?(?:px|rem|em|%|vh|vw|pt|s|ms|deg)?$/i.test(normalized))) return false;
  if (/^(?:theme|token|tokens|gettoken|vartoken)\s*[.(\[]/i.test(normalized)) return false;
  const withoutVars = normalized.replace(/var\([^)]*\)/g, '').trim();
  if (!withoutVars || allowlist.has(withoutVars.toLowerCase())) return false;
  if (PROPERTY_CATEGORY[property] === 'color') return /#(?:[0-9a-f]{3,8})\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(?:white|black|red|blue|green|gray|grey)\b/i.test(withoutVars);
  if (PROPERTY_CATEGORY[property] === 'typography' && property === 'font-family') return true;
  if (PROPERTY_CATEGORY[property] === 'effect' && /shadow|filter/.test(property)) return withoutVars !== 'none';
  return /(?:^|[\s(,+-])-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|%|pt|pc|ch|ex|s|ms|deg)?\b/i.test(withoutVars);
}

function scanSourceTree(rootPath, categories, policy) {
  if (!rootPath) return { enabled: false, root: '', scannedFiles: 0, truncated: false, issues: [] };
  const resolved = path.resolve(rootPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('源码扫描路径必须是文件夹。');
  const allowedExtensions = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html']);
  const ignoredFolders = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor', 'out', '.cache']);
  const targetProperties = new Set(categories.flatMap(category => TOKEN_PROPERTIES[category] || []));
  const allowlist = new Set((policy.allowlistValues || []).map(value => String(value).trim().toLowerCase()));
  const stack = [resolved], issues = [];
  let scannedFiles = 0, totalBytes = 0, truncated = false;
  while (stack.length && scannedFiles < 1200 && totalBytes < 12 * 1024 * 1024 && issues.length < 2000) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { if (!ignoredFolders.has(entry.name)) stack.push(fullPath); continue; }
      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) continue;
      let fileStat;
      try { fileStat = fs.statSync(fullPath); } catch { continue; }
      if (fileStat.size > 1024 * 1024) continue;
      scannedFiles += 1; totalBytes += fileStat.size;
      let text;
      try { text = fs.readFileSync(fullPath, 'utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && issues.length < 2000; index += 1) {
        const line = lines[index];
        const pattern = /(["']?[a-zA-Z][\w-]*["']?)\s*:\s*([^;}{]+)(?:;|,|$)/g;
        let match;
        while ((match = pattern.exec(line))) {
          const property = sourcePropertyName(match[1]);
          if (!targetProperties.has(property)) continue;
          const value = match[2].trim();
          if (!hardcodedSourceValue(property, value, allowlist)) continue;
          issues.push({ file: path.relative(resolved, fullPath).replace(/\\/g, '/'), line: index + 1, property, category: PROPERTY_CATEGORY[property], value: value.slice(0, 240), severity: 'severe', code: 'SRC01', title: '源码属性存在硬编码' });
        }
      }
    }
  }
  if (stack.length || scannedFiles >= 1200 || totalBytes >= 12 * 1024 * 1024 || issues.length >= 2000) truncated = true;
  return { enabled: true, root: resolved, scannedFiles, scannedBytes: totalBytes, truncated, issues };
}

function runtimeHardcodeSummary(audit, policy) {
  const allowlist = new Set((policy.allowlistValues || []).map(value => String(value).trim().toLowerCase()));
  let checked = 0, hardcoded = 0;
  for (const element of audit.elements || []) for (const evidence of Object.values(element.properties || {})) {
    checked += 1;
    const authored = String(evidence.authoredValue || '').trim().toLowerCase();
    const zeroAllowed = allowlist.has('0') && /^-?0(?:\.0+)?(?:px|rem|em|%|vh|vw|pt|s|ms|deg)?$/i.test(authored);
    if (!(evidence.tokenRefs || []).length && !String(evidence.source || '').startsWith('computed') && !allowlist.has(authored) && !zeroAllowed) hardcoded += 1;
  }
  return { checked, hardcoded, pass: hardcoded === 0 };
}

async function capturePage(options) {
  const chromium = loadChromium();
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('未找到 Microsoft Edge 或 Google Chrome。');

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--disable-background-networking', '--disable-component-update']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.dpr,
      reducedMotion: 'reduce',
      colorScheme: options.colorScheme
    });
    const page = await context.newPage();
    const startedAt = Date.now();
    const response = await page.goto(options.url, { waitUntil: options.waitUntil, timeout: 30000 });
    if (options.waitMs) await page.waitForTimeout(options.waitMs);
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    }).catch(() => {});
    await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important;animation-play-state:paused!important}' }).catch(() => {});
    const tokenAudit = options.tokenAudit ? await inspectPageTokens(page, options.tokenCategories, options.tokenPolicy) : null;
    const bytes = await page.screenshot({ type: 'png', fullPage: options.fullPage, animations: 'disabled' });
    if (tokenAudit) {
      tokenAudit.sourceAudit = scanSourceTree(options.tokenPolicy.sourceRoot, options.tokenCategories, options.tokenPolicy);
      tokenAudit.responsive = [];
      for (const viewport of options.tokenPolicy.responsive.filter(item => item.width !== options.width || item.height !== options.height).slice(0, 3)) {
        const responsiveContext = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: options.colorScheme });
        try {
          const responsivePage = await responsiveContext.newPage();
          await responsivePage.goto(options.url, { waitUntil: options.waitUntil, timeout: 30000 });
          if (options.waitMs) await responsivePage.waitForTimeout(options.waitMs);
          const audit = await inspectPageTokens(responsivePage, options.tokenCategories, { ...options.tokenPolicy, fullDocument: true });
          tokenAudit.responsive.push({ viewport, ...runtimeHardcodeSummary(audit, options.tokenPolicy), scannedElements: audit.scannedElements });
        } catch (error) {
          tokenAudit.responsive.push({ viewport, error: error instanceof Error ? error.message : '响应式检查失败。' });
        } finally { await responsiveContext.close(); }
      }
    }
    const environment = await page.evaluate(() => ({
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    })).catch(() => ({}));
    return {
      imageBase64: bytes.toString('base64'),
      mimeType: 'image/png',
      finalUrl: page.url(),
      title: await page.title(),
      status: response ? response.status() : null,
      viewport: { width: options.width, height: options.height, dpr: options.dpr, fullPage: options.fullPage },
      environment,
      tokenAudit,
      duration: Date.now() - startedAt
    };
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, { ok: false, error: '请求来源不受信任。' }, origin);
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, apiVersion: API_VERSION, service: 'PixelProof Browser Companion', version: SERVICE_VERSION, platform: process.platform, arch: process.arch, busy: captureInProgress, token: sessionToken, browserFound: Boolean(findBrowser()), capabilities: ['capture', 'high-precision-diff', 'dom-css-token-audit', 'strict-cdt-policy', 'source-token-scan', 'responsive-token-scan', 'pseudo-element-audit'] }, origin);
    return;
  }

  if (request.method === 'POST' && request.url === '/capture') {
    if (request.headers['x-pixelproof-token'] !== sessionToken) {
      sendJson(response, 403, { ok: false, error: '本机会话令牌无效。' }, origin);
      return;
    }
    if (captureInProgress) {
      sendJson(response, 409, { ok: false, error: '本机伴侣正在执行另一次检查，请等待完成后重试。' }, origin);
      return;
    }
    captureInProgress = true;
    try {
      const body = await readJson(request);
      const options = validateCapture(body);
      const result = await capturePage(options);
      sendJson(response, 200, { ok: true, ...result }, origin);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : '页面抓取失败。' }, origin);
    } finally { captureInProgress = false; }
    return;
  }

  sendJson(response, 404, { ok: false, error: '接口不存在。' }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`PixelProof Browser Companion listening on http://${HOST}:${PORT}`);
  console.log(`Session token: ${sessionToken.slice(0, 8)}…`);
});
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') console.error(`PixelProof 端口 ${PORT} 已被占用。如果伴侣已在运行，请直接回到 Figma；否则请关闭占用该端口的程序。`);
  else console.error(error && error.stack || error);
  process.exitCode = 1;
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
