#!/usr/bin/env node
/* 封面：1200×1200。取值全部来自同一次引擎运行，并落盘 evidence/封面取值.json。
   用法：node make-cover.cjs
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const PROFILE = '/Users/xululu/.agent-browser/zhihu-profile';
const SESSION = 'codex62-cover';
const OUT = path.join(__dirname, 'cover.png');
const RAW = path.join(__dirname, '..', 'evidence', '封面-原始截图.png');
const HTML = path.join(__dirname, '..', 'evidence', '封面临时.html');
const PY = process.env.PY62 || '/Users/xululu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
const A = require('./core.js');

const st = A.defaultState();
const r = A.compute(st);
if (!r.ok) throw new Error('默认场景算不出来：' + JSON.stringify(r.errors));
const vals = {
  E_day: r.totals.E_day, E_dc: r.totals.E_dc, E_ac: r.totals.E_ac, E_invLoss: r.totals.E_invLoss,
  Wp_need: r.panel.need, n_p: r.panel.count, panelW: r.panel.unit, Wp_inst: r.panel.installed,
  E_gen: r.panel.genDay, surplus: r.panel.surplus,
  Ah_need: r.battery.ahNeed, n_b: r.battery.count, battUnitAh: r.battery.unit, Ah_inst: r.battery.installedAh,
  I_ctrl: r.controller.amps, P_rec: r.inverter.rec, P_peak: r.inverter.peak,
  endQ: r.rain.endQ, days: r.input.days, rainFactor: r.input.rainFactor,
  vBat: r.input.vBat, etaSys: r.input.etaSys, psh: r.input.psh,
  loads: r.loadRows.map(function (x) { return { name: x.label, w: x.values.w, hours: x.values.hours, qty: x.values.qty, ac: x.ac, E: x.E_i }; })
};
const f1 = (x) => A.fmt(x, 1), f0 = (x) => A.fmt(x, 0);
fs.writeFileSync(path.join(__dirname, '..', 'evidence', '封面取值.json'), JSON.stringify({
  note: '封面上的每一个数字都来自这一次 AppCore.compute(AppCore.defaultState()) 的运行结果；默认场景本身是虚构示例。',
  input_summary: { 负载行数: st.loads.length, 峰值日照小时: r.input.psh, 系统综合效率: r.input.etaSys, 电池电压: r.input.vBat, 自持天数: r.input.days, 阴雨天日照系数: r.input.rainFactor },
  result: vals
}, null, 1) + '\n');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:1200px;background:#f4f7fa;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2933;overflow:hidden}
  .card{position:absolute;inset:26px;background:#fff;border:1px solid #d9e2ec;border-top:9px solid #d97706;border-radius:12px;padding:38px 48px;display:flex;flex-direction:column}
  .kicker{font-size:19px;letter-spacing:8px;color:#7b8794}
  h1{font-size:64px;letter-spacing:3px;margin:10px 0 8px;line-height:1.1}
  .sub{font-size:23px;color:#52606d;line-height:1.45;max-width:1000px}
  .rule{height:1px;background:#d9e2ec;margin:22px 0 20px}
  .quad{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .q{background:#eef2f7;border-radius:10px;padding:13px 20px 15px}
  .q .k{font-size:17px;color:#7b8794;margin-bottom:4px}
  .q .v{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:43px;line-height:1.05}
  .q.p .v{color:#d97706} .q.b .v{color:#0e7490} .q.c .v,.q.i .v{color:#1f2933}
  .q .v small{font-size:19px;font-weight:400;color:#7b8794;margin-left:4px}
  .q .d{font-size:16px;color:#52606d;margin-top:5px}
  .facts{margin-top:16px;display:flex;flex-wrap:wrap;gap:8px 22px;font-size:18px;color:#52606d}
  .facts b{font-family:ui-monospace,Menlo,monospace;color:#1f2933}
  .loads{margin-top:16px;border-top:1px solid #d9e2ec;padding-top:13px;flex:1;display:flex;flex-direction:column;min-height:0}
  .loads .h{font-size:17px;color:#7b8794;margin-bottom:7px}
  .loads table{width:100%;height:100%;border-collapse:collapse;font-size:17.5px}
  .loads td{padding:0;color:#1f2933;vertical-align:middle}
  .loads td.n{color:#52606d;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
  .loads td.e{text-align:right;font-family:ui-monospace,Menlo,monospace;font-weight:600;white-space:nowrap}
  .loads tr+tr td{border-top:1px solid #eef2f7}
  .foot{margin-top:18px;border-top:1px solid #d9e2ec;padding-top:13px;
    font-size:17px;color:#7b8794;line-height:1.55}
</style></head><body>
<div class="card">
  <div class="kicker">离 网 光 伏 配 置 单</div>
  <h1>配一套自己发的电</h1>
  <p class="sub">列出要带的电器，算出<b>组件 / 电池 / 控制器 / 逆变器</b>该买多大，再推演阴雨天能撑几天。</p>
  <div class="rule"></div>
  <div class="quad">
    <div class="q p"><div class="k">组件</div><div class="v">${f1(vals.Wp_need)}<small>W</small></div><div class="d">${vals.n_p} 块 × ${f0(vals.panelW)} W，装机 ${f0(vals.Wp_inst)} W</div></div>
    <div class="q b"><div class="k">电池</div><div class="v">${f1(vals.Ah_need)}<small>Ah</small></div><div class="d">${vals.n_b} 块 × ${f0(vals.battUnitAh)} Ah @ ${f0(vals.vBat)} V</div></div>
    <div class="q c"><div class="k">控制器</div><div class="v">${f1(vals.I_ctrl)}<small>A</small></div><div class="d">装机 ÷ ${f0(vals.vBat)} V，含 25% 余量</div></div>
    <div class="q i"><div class="k">逆变器</div><div class="v">${f0(vals.P_rec)}<small>W</small></div><div class="d">连续；峰值 ≥ ${f0(vals.P_peak)} W</div></div>
  </div>
  <div class="facts">
    <span>一天用 <b>${f1(vals.E_day)}</b> Wh</span>
    <span>晴天发 <b>${f1(vals.E_gen)}</b> Wh</span>
    <span>余 <b>${f1(vals.surplus)}</b> Wh</span>
    <span>阴雨 <b>${f0(vals.days)}</b> 天还剩 <b>${f1(vals.endQ)}</b> Wh</span>
  </div>
  <div class="loads">
    <div class="h">要带的东西（默认场景的 ${vals.loads.length} 行负载，虚构示例）</div>
    <table>
      ${vals.loads.map((l) => '<tr><td>' + l.name + '</td><td class="n">' + f1(l.w) + ' W × ' + A.fmt(l.hours, 2) + ' h × ' + l.qty + (l.ac ? '（交流）' : '') + '</td><td class="e">' + f1(l.E) + ' Wh</td></tr>').join('')}
    </table>
  </div>
  <div class="foot">不联网 · 不查任何地区的日照数据 · 不查产品参数、不推荐品牌<br>默认场景是虚构示例，不是实测数据</div>
</div>
</body></html>`;
fs.writeFileSync(HTML, html);

(async function () {
  try { execFileSync(AB, ['close', '--all'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { /* ignore */ }
  await new Promise((r2) => setTimeout(r2, 700));
  execFileSync(AB, ['--profile', PROFILE, '--session', SESSION, 'open', 'file://' + HTML], { encoding: 'utf8', timeout: 180000 });
  await new Promise((r2) => setTimeout(r2, 1200));
  execFileSync(AB, ['--session', SESSION, 'set', 'viewport', '1200', '1200'], { encoding: 'utf8', timeout: 60000 });
  await new Promise((r2) => setTimeout(r2, 500));
  const dims = execFileSync(AB, ['--session', SESSION, 'eval', 'JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight})'], { encoding: 'utf8' }).trim().split('\n').pop();
  console.log('画布尺寸：' + dims);
  execFileSync(AB, ['--session', SESSION, 'screenshot', RAW], { encoding: 'utf8', timeout: 180000 });
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(RAW)})
print("原始截图", im.size)
im = im.convert("RGB")
if im.size != (1200,1200):
    im = im.crop((0,0,min(1200,im.width),min(1200,im.height)))
im.save(${JSON.stringify(OUT)}, "PNG")
print("封面", im.size, ${JSON.stringify(OUT)})
`;
  console.log(execFileSync(PY, ['-c', py], { encoding: 'utf8' }).trim());
  execFileSync(AB, ['--session', SESSION, 'close'], { encoding: 'utf8', timeout: 60000 });
  console.log('取数已落盘 evidence/封面取值.json');
})().catch((e) => { console.error(e.stack); process.exit(1); });
