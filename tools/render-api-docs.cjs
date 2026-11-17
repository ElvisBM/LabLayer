// Generates the public, self-contained documentation. Run: node tools/render-api-docs.cjs
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/api/anuncios.md'), 'utf8');
if (/ll_drafts_[A-Za-z0-9_-]{20,}/.test(source)) throw new Error('Credential-like content found in public documentation');
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headings = [];
let body = marked.parse(source, { gfm: true });
body = body.replace(/<h1>.*?<\/h1>/s, '').replace(/<h2>(.*?)<\/h2>/g, (_, title) => {
  const id = 'secao-' + (headings.length + 1); headings.push({id,title}); return `<h2 id="${id}">${title}</h2>`;
});
const nav = headings.map(h => `<a href="#${h.id}">${h.title}</a>`).join('');
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API de anúncios · LabLayer</title><meta name="description" content="Documentação da API LabLayer: upload de fotos, criação e edição de rascunhos de anúncios para revisão e publicação no Mercado Livre.">
<meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer">
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:#f7f8fc;color:#172036;font:16px/1.7 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#4835c7;text-underline-offset:3px}a:hover{color:#2e248c}a:focus-visible{outline:3px solid #a198f4;outline-offset:4px}header{background:#fff;border-bottom:1px solid #e0e4ee;padding:32px max(24px,calc((100vw - 1160px)/2))}.brand{font-size:16px;font-weight:750;letter-spacing:.03em;color:#4835c7}h1{font-size:clamp(27px,4vw,40px);line-height:1.2;letter-spacing:-.025em;margin:14px 0}header p{margin:0;color:#5c6780;max-width:750px}.links{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.links a{display:inline-block;padding:9px 16px;border:1px solid #dcdfee;border-radius:10px;text-decoration:none;font-size:14px;font-weight:650}.links a:first-child{background:#4835c7;color:white;border-color:#4835c7}.layout{max-width:1208px;margin:auto;padding:32px 24px 80px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px}nav{position:sticky;top:28px;align-self:start;font-size:14px}nav strong{display:block;margin-bottom:12px;color:#737c91;font-size:12px;letter-spacing:.08em;text-transform:uppercase}nav a{display:block;text-decoration:none;color:#47526b;padding:10px 12px;border-radius:9px}nav a:hover{background:#eae7ff;color:#4835c7}main{min-width:0;background:white;border:1px solid #e1e5ef;border-radius:16px;padding:32px}main>p:first-child{margin-top:0}h2{font-size:24px;line-height:1.35;margin:44px 0 18px;padding-top:24px;border-top:1px solid #e8eaf2}h2:first-of-type{margin-top:30px}p,li{overflow-wrap:anywhere}pre{background:#182135;color:#f2f3ff;padding:20px;border-radius:12px;overflow-x:auto;line-height:1.6;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em}p code,li code,td code{background:#f0eefb;color:#43318f;padding:2px 5px;border-radius:4px}pre code{font-size:inherit;white-space:pre}table{border-collapse:collapse;width:100%;font-size:14px;margin:20px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5e8f0;vertical-align:top}th{background:#f6f7fb}td:first-child{white-space:nowrap;font-weight:600}ul{padding-left:22px}footer{padding:22px 0 0;margin-top:30px;border-top:1px solid #e8eaf2;color:#737c91;font-size:13px}@media(max-width:800px){.layout{display:block;padding:20px 16px 40px}nav{position:static;margin-bottom:22px}nav a{padding:7px 0}main{padding:22px 18px}header{padding:26px 22px}pre{padding:16px;font-size:12px}h2{font-size:21px}th,td{padding:10px 7px}}@media print{nav,.links{display:none}.layout{display:block;padding:0}header{padding:0 0 20px}main{border:0;padding:0}pre{white-space:pre-wrap;color:#172036;background:#f4f4f4}body{background:#fff}}
</style></head><body>
<header><div class="brand">LabLayer · Documentação</div><h1>API de rascunhos de anúncios</h1><p>Envie fotos e prepare seus anúncios na LabLayer. A aprovação e a publicação no Mercado Livre ficam sob seu controle.</p><div class="links"><a href="/?view=anuncios&amp;tab=rascunhos">Abrir rascunhos</a><a href="anuncios.md" download>Baixar documentação em Markdown</a></div></header>
<div class="layout"><nav aria-label="Índice da documentação"><strong>Nesta página</strong>${nav}</nav><main>${body}<footer>Atualizado em 29 de outubro de 2026 · LabLayer</footer></main></div>
</body></html>`;
const out = path.join(root,'public/docs/api/anuncios');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'index.html'),html);
fs.writeFileSync(path.join(out,'anuncios.md'),source);
console.log(`Generated ${path.relative(root,out)}`);
