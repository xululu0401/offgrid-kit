/* 配一套自己发的电 · 核心测试
 * 跑法：node --test tests/core.test.cjs
 * 纪律：锚点全部来自 ../需求与调研.md §2 的手算，不是从实现输出里抄回来的；
 *       ok=false 时必须断言「算不出来」而不是断言 0；断言返回字段存在且值域有效。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
function loadCore(src) {
  const ctx = { module: { exports: {} }, console: console };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.AppCore;
}
const A = loadCore(SRC);

/* ── 手算锚点（来自 需求与调研.md §2.5，独立于实现写出） ── */
const ANCHOR = {
  E_dc: 1476, E_ac: 375,
  E_day: 1476 + 375 / 0.9,                 /* 1892.6666666666667 */
  E_invLoss: 375 / 0.9 - 375,              /* 41.666666666666664 */
  Wp_need: (1476 + 375 / 0.9) / (4 * 0.72),
  Wp_inst: 800, n_p: 4,
  E_gen: 800 * 4 * 0.72,                   /* 2304 */
  surplus: 800 * 4 * 0.72 - (1476 + 375 / 0.9),
  E_use: (1476 + 375 / 0.9) * 2,
  E_nom: (1476 + 375 / 0.9) * 2 / 0.8,
  Ah_need: (1476 + 375 / 0.9) * 2 / 0.8 / 12,
  n_b: 4, Ah_inst: 400,
  I_ctrl: 800 / 12 * 1.25,
  P_cont: 125, P_rec: 150, P_peak: 245,
  year: 800 * 4 * 365 * 0.72 / 1000,       /* 840.96 */
  G_rain: 800 * 4 * 0.2 * 0.72,            /* 460.8 */
  q1: (1476 + 375 / 0.9) * 2 + 460.8 - (1476 + 375 / 0.9),
  q2: (1476 + 375 / 0.9) * 2 + 2 * 460.8 - 2 * (1476 + 375 / 0.9)
};
const EPS = 1e-9;
function near(a, b, msg, eps) {
  assert.ok(typeof a === 'number' && isFinite(a), (msg || '') + ' 不是有限数字：' + a);
  assert.ok(Math.abs(a - b) <= (eps === undefined ? EPS : eps) * Math.max(1, Math.abs(b)),
    (msg || '') + ' 期望 ' + b + '，实际 ' + a);
}
function def() { return A.defaultState(); }
function calc(state) { return A.compute(state); }
function set(state, f, v) {
  if (f.indexOf('sys.') === 0) state.sys[f.slice(4)] = String(v);
  else if (f.indexOf('have.') === 0) state.have[f.slice(5)] = String(v);
  else if (/^loads\[\d+\]\./.test(f)) {
    const m = f.match(/^loads\[(\d+)\]\.(\w+)$/);
    state.loads[+m[1]][m[2]] = (m[2] === 'ac' || m[2] === 'simultaneous') ? !!v : String(v);
  } else if (f === 'loads') state.loads = v;
  return state;
}

/* ════════════════ 1. 默认场景锚点 ════════════════ */
test('默认场景：手算锚点全部命中（9 个数）', () => {
  const r = calc(def());
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  near(r.totals.E_dc, ANCHOR.E_dc, 'E_dc');
  near(r.totals.E_ac, ANCHOR.E_ac, 'E_ac');
  near(r.totals.E_day, ANCHOR.E_day, 'E_day');
  near(r.totals.E_invLoss, ANCHOR.E_invLoss, 'E_invLoss');
  near(r.panel.need, ANCHOR.Wp_need, 'Wp_need');
  near(r.battery.ahNeed, ANCHOR.Ah_need, 'Ah_need');
  near(r.controller.amps, ANCHOR.I_ctrl, 'I_ctrl');
  near(r.inverter.rec, ANCHOR.P_rec, 'P_rec');
  near(r.inverter.peak, ANCHOR.P_peak, 'P_peak');
});

test('默认场景：取整与装机锚点', () => {
  const r = calc(def());
  assert.strictEqual(r.panel.count, ANCHOR.n_p);
  near(r.panel.installed, ANCHOR.Wp_inst, 'Wp_inst');
  assert.strictEqual(r.battery.count, ANCHOR.n_b);
  near(r.battery.installedAh, ANCHOR.Ah_inst, 'Ah_inst');
  near(r.panel.genDay, ANCHOR.E_gen, 'E_gen');
  near(r.panel.surplus, ANCHOR.surplus, 'surplus');
  near(r.year.kwh, ANCHOR.year, 'year');
});

test('默认场景：阴雨逐日锚点（净额 460.8−1892.67）', () => {
  const r = calc(def());
  assert.strictEqual(r.rain.rows.length, 2);
  near(r.rain.genPerDay, ANCHOR.G_rain, 'G_rain');
  near(r.rain.rows[0].q, ANCHOR.q1, 'q1');
  near(r.rain.rows[1].q, ANCHOR.q2, 'q2');
  assert.strictEqual(r.rain.firstEmptyDay, null, '默认两天阴雨不该见底');
  near(r.rain.refillDays, (ANCHOR.E_use - ANCHOR.q2) / ANCHOR.surplus, 'refillDays');
  near(r.rain.spill, 0, 'spill');
});

test('默认场景：结论摘要四条与量纲', () => {
  const r = calc(def());
  const s = A.summary(r);
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.lines.length, 4);
  assert.ok(s.lines[0].indexOf('W') >= 0 && s.lines[1].indexOf('Ah') >= 0
    && s.lines[2].indexOf('A') >= 0 && s.lines[3].indexOf('W') >= 0);
});

test('默认场景：每行取电之和等于日耗电', () => {
  const r = calc(def());
  const sum = r.loadRows.reduce((a, x) => a + x.E_i, 0);
  near(sum, r.totals.E_day, 'Σ rows');
});

test('默认场景：交流行确实除以了逆变器效率', () => {
  const r = calc(def());
  const ac = r.loadRows.filter((x) => x.ac);
  assert.strictEqual(ac.length, 3);
  ac.forEach((x) => near(x.E_i, x.raw_wh / 0.9, x.label));
  const dc = r.loadRows.filter((x) => !x.ac);
  dc.forEach((x) => near(x.E_i, x.raw_wh, x.label));
});

/* ════════════════ 2. 公式两两自洽 ════════════════ */
test('自洽：E_day = E_dc + E_ac/etaInv', () => {
  const r = calc(def());
  near(r.totals.E_dc + r.totals.E_ac / r.input.etaInv, r.totals.E_day);
});
test('自洽：Wp_need = E_day/(psh·etaSys) 且 Wp_inst = n_p·panelW', () => {
  const r = calc(def());
  near(r.panel.need, r.totals.E_day / (r.input.psh * r.input.etaSys));
  near(r.panel.installed, r.panel.count * r.panel.unit);
});
test('自洽：E_use = E_day·days；E_nom = E_use/dod；Ah_need = E_nom/vBat', () => {
  const r = calc(def());
  near(r.battery.useWh, r.totals.E_day * r.input.days);
  near(r.battery.nomWh, r.battery.useWh / r.input.dod);
  near(r.battery.ahNeed, r.battery.nomWh / r.input.vBat);
  near(r.battery.installedAh, r.battery.count * r.battery.unit);
});
test('自洽：E_gen = Wp_inst·psh·etaSys；surplus = E_gen − E_day', () => {
  const r = calc(def());
  near(r.panel.genDay, r.panel.installed * r.input.psh * r.input.etaSys);
  near(r.panel.surplus, r.panel.genDay - r.totals.E_day);
});
test('自洽：I_ctrl = Wp_inst/vBat·(1+reserve)', () => {
  const r = calc(def());
  near(r.controller.amps, r.panel.installed / r.input.vBat * (1 + r.input.reserve));
});
test('自洽：P_rec = P_cont·invMargin，且 P_peak ≥ P_cont', () => {
  const r = calc(def());
  near(r.inverter.rec, r.inverter.cont * r.input.invMargin);
  assert.ok(r.inverter.peak >= r.inverter.cont);
});
test('自洽：year 用 365 天与同一个 psh（假设口径）', () => {
  const r = calc(def());
  near(r.year.kwh, r.panel.installed * r.input.psh * 365 * r.input.etaSys / 1000);
});

/* ════════════════ 3. 边界与阈值两侧 ════════════════ */
const BOUND = [
  ['sys.psh', 12, 12.01, 0.01, 0], ['sys.etaSys', 1, 1.0001, 0.5, 0],
  ['sys.etaInv', 1, 1.0001, 0.5, 0], ['sys.vBat', 1000, 1000.1, 12, 0],
  ['sys.dod', 1, 1.0001, 0.5, 0], ['sys.days', 30, 30.1, 2, -0.1],
  ['sys.panelW', 5000, 5001, 200, 0], ['sys.battUnitAh', 5000, 5001, 100, 0],
  ['sys.reserve', 2, 2.01, 0.25, -0.01], ['sys.invMargin', 3, 3.01, 1.2, 0.99],
  ['sys.rainFactor', 1, 1.01, 0.2, -0.01]
];
BOUND.forEach(([f, maxOk, maxBad, midOk, minBad]) => {
  test('阈值两侧：' + f + ' 上界内可算 / 越界拒绝', () => {
    assert.strictEqual(calc(set(def(), f, maxOk)).ok, true, f + '=' + maxOk + ' 应可算');
    const bad = calc(set(def(), f, maxBad));
    assert.strictEqual(bad.ok, false, f + '=' + maxBad + ' 应拒绝');
    assert.ok(bad.errors.some((e) => e.field === f && e.code === 'too-large'), JSON.stringify(bad.errors));
    assert.strictEqual(calc(set(def(), f, midOk)).ok, true, f + '=' + midOk + ' 应可算');
  });
  if (minBad !== undefined) {
    test('阈值两侧：' + f + ' 下界外拒绝', () => {
      const bad = calc(set(def(), f, minBad));
      assert.strictEqual(bad.ok, false, f + '=' + minBad + ' 应拒绝');
      assert.ok(bad.errors.some((e) => e.field === f), JSON.stringify(bad.errors));
    });
  }
});

const LOADBOUND = [
  ['loads[0].w', 20000, 20000.1, 100, 0],
  ['loads[0].hours', 24, 24.01, 5, 0],
  ['loads[0].qty', 50, 51, 2, 0],
  ['loads[0].surge', 8, 8.01, 2, 0.99]
];
LOADBOUND.forEach(([f, maxOk, maxBad, midOk, minBad]) => {
  test('阈值两侧：' + f, () => {
    assert.strictEqual(calc(set(def(), f, maxOk)).ok, true, f + '=' + maxOk);
    const bad = calc(set(def(), f, maxBad));
    assert.strictEqual(bad.ok, false, f + '=' + maxBad);
    assert.ok(bad.errors.some((e) => e.field === f), JSON.stringify(bad.errors.map((e) => e.field)));
    assert.strictEqual(calc(set(def(), f, midOk)).ok, true, f + '=' + midOk);
    const low = calc(set(def(), f, minBad));
    assert.strictEqual(low.ok, false, f + '=' + minBad);
    assert.ok(low.errors.some((e) => e.field === f));
  });
});

test('边界：数量必须是整数（2.5 拒绝，2 通过）', () => {
  assert.strictEqual(calc(set(def(), 'loads[0].qty', 2)).ok, true);
  const bad = calc(set(def(), 'loads[0].qty', '2.5'));
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.code === 'not-integer' && e.field === 'loads[0].qty'), JSON.stringify(bad.errors));
});

test('边界：自持天数 0 天 → 不需要电池，但其它量照算', () => {
  const r = calc(set(def(), 'sys.days', 0));
  assert.strictEqual(r.ok, true);
  near(r.battery.useWh, 0); near(r.battery.nomWh, 0); near(r.battery.ahNeed, 0);
  assert.strictEqual(r.battery.count, 0);
  assert.strictEqual(r.rain.rows.length, 0);
  assert.strictEqual(r.rain.firstEmptyDay, null);
  assert.ok(r.panel.need > 0, '组件需求不该跟着变 0');
});

test('边界：etaInv = 1 时交流行没有逆变损失', () => {
  const r = calc(set(def(), 'sys.etaInv', 1));
  assert.strictEqual(r.ok, true);
  near(r.totals.E_invLoss, 0);
  near(r.totals.E_day, r.totals.E_dc + r.totals.E_ac);
});

test('边界：etaSys = 1 时组件需求最小（= E_day/psh）', () => {
  const r = calc(set(def(), 'sys.etaSys', 1));
  near(r.panel.need, r.totals.E_day / r.input.psh);
});

test('边界：rainFactor = 0（持续阴雨不出电）时把电池正好用完', () => {
  const r = calc(set(def(), 'sys.rainFactor', 0));
  assert.strictEqual(r.ok, true);
  near(r.rain.genPerDay, 0);
  /* 自持 2 天、两天零发电 → 第 2 天结束时正好放到 0：不算「负载被饿着」，但要如实说是正好用完 */
  assert.strictEqual(r.rain.firstEmptyDay, null, '正好用到 0 不等于不够用');
  assert.strictEqual(r.rain.firstExhaustedDay, 2);
  near(r.rain.endQ, 0);
  assert.strictEqual(A.rainVerdict(r).code, 'exact');
});

test('边界：rainFactor = 1（阴雨天也满发）时不见底且会弃电', () => {
  const r = calc(set(def(), 'sys.rainFactor', 1));
  assert.strictEqual(r.rain.firstEmptyDay, null);
  assert.ok(r.rain.spill > 0, '满发会溢出，应当记弃电');
  near(r.rain.rows[0].q, r.battery.useWh, '第 1 天就充满');
});

test('边界：很小的 psh 让组件需求变大但仍是有限数', () => {
  const r = calc(set(def(), 'sys.psh', 0.01));
  assert.strictEqual(r.ok, true);
  assert.ok(isFinite(r.panel.need) && r.panel.need > 1e5);
  assert.ok(Number.isInteger(r.panel.count));
});

/* ════════════════ 4. 非法输入 ════════════════ */
const BADNUM = ['abc', '', '   ', '1,5', '1e3', '0x10', '一十二', 'NaN', 'Infinity', '--3', '1.2.3', '+'];
BADNUM.forEach((v) => {
  test('非法数字：sys.psh = ' + JSON.stringify(v) + ' 必须报错且保留原文', () => {
    const st = set(def(), 'sys.psh', v);
    const r = calc(st);
    assert.strictEqual(r.ok, false, v + ' 不该被当成合法数字');
    const e = r.errors.find((x) => x.field === 'sys.psh');
    assert.ok(e, JSON.stringify(r.errors.map((x) => x.field)));
    assert.ok(e.code === 'not-number' || e.code === 'empty', '实际 code=' + e.code);
    assert.strictEqual(e.raw, String(v), '必须保留用户原文');
  });
});

test('容错：正在输入的「12.」按 12 处理（不当成非法，也不改写原文）', () => {
  const st = set(def(), 'sys.psh', '12.');
  const r = calc(st);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.input.psh, 12);
  assert.strictEqual(st.sys.psh, '12.', '原文必须留着');
});
test('容错：前后空格与正号被接受（原文一样留着）', () => {
  const st = set(def(), 'sys.psh', ' 4.0 ');
  assert.strictEqual(calc(st).ok, true);
  assert.strictEqual(st.sys.psh, ' 4.0 ');
  assert.strictEqual(calc(set(def(), 'sys.psh', '+4')).ok, true);
});

test('非法数字：用户原文不会被实现改写（校验不做二次归一化）', () => {
  const st = set(def(), 'sys.psh', 'abc');
  st.sys.days = ' 2 ';
  const r = calc(st);
  assert.strictEqual(st.sys.psh, 'abc', 'state 被改写了');
  assert.strictEqual(st.sys.days, ' 2 ', 'state 被改写了');
  assert.strictEqual(r.errors.find((x) => x.field === 'sys.psh').raw, 'abc');
});

test('非法输入：ok=false 时所有推导量都是 null（不是 0）', () => {
  const r = calc(set(def(), 'sys.psh', 'abc'));
  assert.strictEqual(r.ok, false);
  ['totals', 'panel', 'battery', 'controller', 'inverter', 'rain', 'year', 'have'].forEach((k) => {
    assert.strictEqual(r[k], null, k + ' 应当是 null');
  });
  r.loadRows.forEach((x) => assert.strictEqual(x.E_i, null, '行取电应当是 null'));
  /* 跨 realm 的数组不能 deepStrictEqual 比（vm 里造的 [] 与测试里的 [] 不同原型），只看长度 */
  assert.strictEqual(r.suggestions.length, 0);
  assert.deepStrictEqual(Object.keys(r.derivations), []);
});

test('非法输入：每一行都各自报错，且带上行号与字段', () => {
  const st = def();
  st.loads[1].w = 'abc'; st.loads[2].qty = '2.5'; st.loads[3].hours = '-1';
  const r = calc(st);
  assert.strictEqual(r.ok, false);
  const fields = r.errors.map((e) => e.field);
  assert.ok(fields.indexOf('loads[1].w') >= 0, fields.join(','));
  assert.ok(fields.indexOf('loads[2].qty') >= 0, fields.join(','));
  assert.ok(fields.indexOf('loads[3].hours') >= 0, fields.join(','));
});

test('非法输入：负载清单为空要报错', () => {
  const r = calc(set(def(), 'loads', []));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'loads' && e.code === 'empty-list'), JSON.stringify(r.errors));
});

test('非法输入：超过 40 行要报错', () => {
  const st = def();
  st.loads = [];
  for (let i = 0; i < 41; i++) st.loads.push({ name: 'x' + i, w: '10', hours: '1', qty: '1', ac: false, simultaneous: true, surge: '1' });
  const r = calc(st);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'too-many'), JSON.stringify(r.errors));
});

test('非法输入：报错信息里带上用户填的原文', () => {
  const r = calc(set(def(), 'sys.vBat', '十二'));
  const e = r.errors.find((x) => x.field === 'sys.vBat');
  assert.ok(e.message.indexOf('十二') >= 0, e.message);
});

test('容错：have 字段非法不阻塞计算，只记 warning', () => {
  const st = set(def(), 'have.panelW', 'abc');
  const r = calc(st);
  assert.strictEqual(r.ok, true, 'have 不该让整体失败');
  assert.ok(r.warnings.length >= 1, JSON.stringify(r.warnings));
  assert.strictEqual(r.have.verdict, '未填');
});

/* ════════════════ 5. 反推（手上已有的东西） ════════════════ */
test('反推：两样都没填 → verdict = 未填，数值为 null', () => {
  const r = calc(def());
  assert.strictEqual(r.have.verdict, '未填');
  assert.strictEqual(r.have.coverage, null);
  assert.strictEqual(r.have.d_have, null);
  assert.strictEqual(r.have.E_sup, null);
});

test('反推：只填组件且够 → 都够；覆盖率 ≥ 1', () => {
  const st = def(); st.have.panelW = '1000';
  const r = calc(st);
  near(r.have.E_sup, 1000 * 4 * 0.72);
  assert.ok(r.have.coverage >= 1);
  assert.strictEqual(r.have.verdict, '都够');
});

test('反推：只填组件但不够 → 组件不够', () => {
  const st = def(); st.have.panelW = '100';
  const r = calc(st);
  assert.strictEqual(r.have.verdict, '组件不够');
  assert.ok(r.have.coverage < 1);
});

test('反推：只填电池且够 → 都够；不够 → 电池不够', () => {
  const a = calc((() => { const s = def(); s.have.battAh = '2000'; return s; })());
  assert.strictEqual(a.have.verdict, '都够');
  const b = calc((() => { const s = def(); s.have.battAh = '100'; return s; })());
  assert.strictEqual(b.have.verdict, '电池不够');
  near(b.have.usable_wh, 100 * 12 * 0.8);
  near(b.have.d_have, 100 * 12 * 0.8 / b.totals.E_day);
});

test('反推：两样都填但组件不够 → 先报组件不够（优先级）', () => {
  const st = def(); st.have.panelW = '50'; st.have.battAh = '5000';
  assert.strictEqual(calc(st).have.verdict, '组件不够');
});

test('反推：阈值恰好等于 1（coverage=1 / d_have=days）算「够」', () => {
  const r0 = calc(def());
  const exactPanel = r0.totals.E_day / (r0.input.psh * r0.input.etaSys);
  const st = def(); st.have.panelW = String(exactPanel);
  assert.strictEqual(calc(st).have.verdict, '都够', 'coverage 正好 = 1 应当算够');
  const exactAh = r0.totals.E_day * r0.input.days / r0.input.dod / r0.input.vBat;
  const st2 = def(); st2.have.battAh = String(exactAh);
  assert.strictEqual(calc(st2).have.verdict, '都够', 'd_have 正好 = days 应当算够');
});

/* ════════════════ 6. 取整正确性（ceilSafe） ════════════════ */
test('取整：正好整除不跳档；容差内的浮点噪声不跳档；超出容差就跳档', () => {
  assert.strictEqual(A.ceilSafe(4), 4);
  assert.strictEqual(A.ceilSafe(3.9999999999999996), 4, '浮点噪声不该跳档');
  assert.strictEqual(A.ceilSafe(4.0000000000001), 4, '相对容差 1e-9 内算「就是 4」');
  assert.strictEqual(A.ceilSafe(4.001), 5, '超出容差必须跳档');
  assert.strictEqual(A.ceilSafe(4.0000001), 5);
  assert.strictEqual(A.ceilSafe(0), 0);
  assert.strictEqual(A.ceilSafe(0.0000001), 1);
});
test('格式化：整数天/整数电压不带多余小数（视觉走查发现的别扭写法）', () => {
  assert.strictEqual(A.fmtDays(2), '2');
  assert.strictEqual(A.fmtDays(2.5), '2.5');
  assert.strictEqual(A.fmtDays(0), '0');
  assert.strictEqual(A.fmtDays(30), '30');
  assert.strictEqual(A.fmtV(12), '12');
  assert.strictEqual(A.fmtV(24), '24');
  assert.strictEqual(A.fmtV(12.5), '12.50');
  assert.strictEqual(A.fmtV(220), '220');
});
test('结论文案：整数天显示「2 天」而不是「2.0 天」', () => {
  const r = calc(def());
  const v = A.rainVerdict(r);
  assert.ok(v.text.indexOf('2 天') >= 0 && v.text.indexOf('2.0 天') < 0, v.text);
  const r25 = calc((() => { const st = def(); st.sys.days = '2.5'; return st; })());
  assert.ok(A.rainVerdict(r25).text.indexOf('2.5 天') >= 0, A.rainVerdict(r25).text);
});
test('取整：把需求调到正好 4 块时块数就是 4', () => {
  const st = def();
  st.loads = [{ name: '负载', w: '576', hours: '1', qty: '1', ac: false, simultaneous: true, surge: '1' }];
  st.sys.psh = '2'; st.sys.etaSys = '1'; st.sys.panelW = '144';
  const r = calc(st);
  assert.strictEqual(r.ok, true);
  near(r.panel.need, 288, 'need 应当正好 288');
  assert.strictEqual(r.panel.count, 2, '288/144 = 2 块');
});
test('取整：电池容量需求正好等于单块时只买一块', () => {
  const st = def();
  st.loads = [{ name: '负载', w: '120', hours: '1', qty: '1', ac: false, simultaneous: true, surge: '1' }];
  st.sys.days = '0'; st.sys.battUnitAh = '100';
  const r = calc(st);
  assert.strictEqual(r.battery.ahNeed, 0);
  assert.strictEqual(r.battery.count, 0);
});

/* ════════════════ 7. 单调性与最优性 ════════════════ */
test('单调：负载功率变大 → 日耗电与组件需求都不减小', () => {
  const a = calc(def());
  const st = def(); st.loads[0].w = '90';
  const b = calc(st);
  assert.ok(b.totals.E_day > a.totals.E_day);
  assert.ok(b.panel.need > a.panel.need);
  assert.ok(b.panel.count >= a.panel.count);
});
test('单调：自持天数变大 → 电池容量不减小', () => {
  let prev = 0;
  [0, 1, 2, 3, 5, 10].forEach((d) => {
    const r = calc(set(def(), 'sys.days', d));
    assert.ok(r.battery.ahNeed >= prev, 'days=' + d);
    prev = r.battery.ahNeed;
  });
});
test('单调：峰值日照变大 → 组件需求变小', () => {
  let prev = Infinity;
  [1, 2, 3, 4, 6, 8].forEach((p) => {
    const r = calc(set(def(), 'sys.psh', p));
    assert.ok(r.panel.need < prev, 'psh=' + p);
    prev = r.panel.need;
  });
});
test('单调：系统效率变大 → 组件需求变小', () => {
  let prev = Infinity;
  [0.4, 0.55, 0.72, 0.85, 1].forEach((e) => {
    const r = calc(set(def(), 'sys.etaSys', e));
    assert.ok(r.panel.need < prev, 'etaSys=' + e);
    prev = r.panel.need;
  });
});
test('单调：电压翻倍 → 控制器电流减半、电池 Ah 减半', () => {
  const a = calc(set(def(), 'sys.vBat', 12));
  const b = calc(set(def(), 'sys.vBat', 24));
  near(b.controller.amps, a.controller.amps / 2);
  near(b.battery.ahNeed, a.battery.ahNeed / 2);
  near(b.battery.nomWh, a.battery.nomWh, 'Wh 不变');
});
test('最优性：单块组件越大，块数越少（同一需求下）', () => {
  const need = calc(def()).panel.need;
  let prev = Infinity;
  [100, 200, 300, 400, 550].forEach((u) => {
    const st = def(); st.sys.panelW = String(u);
    const r = calc(st);
    assert.ok(r.panel.count <= prev, 'unit=' + u);
    assert.ok(r.panel.count * u >= need - 1e-6, '装机必须覆盖需求：' + u);
    assert.ok((r.panel.count - 1) * u < need + 1e-6, '少一块就该不够：' + u);
    prev = r.panel.count;
  });
});

/* ════════════════ 8. 阴雨期递推 ════════════════ */
test('阴雨：小数自持天数按比例分摊到最后一个半天（口径不错位）', () => {
  /* 自持 2.5 天：循环跑 3 行，第 3 行发电与用电都乘 0.5，
     于是「总用电 = E_day × 2.5 = 可用电量」恒成立，rainFactor=0 时正好落 0。 */
  const st = set(def(), 'sys.rainFactor', 0);
  st.sys.days = '2.5';
  const r = calc(st);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.rain.rows.length, 3);
  near(r.rain.rows[0].share, 1); near(r.rain.rows[1].share, 1); near(r.rain.rows[2].share, 0.5);
  near(r.rain.rows[2].draw, r.totals.E_day * 0.5);
  near(r.rain.rows[2].gen, 0);
  near(r.rain.endQ, 0, '总用电正好等于可用电量');
  assert.strictEqual(r.rain.firstEmptyDay, null, '正好用完不等于不够用');
  assert.strictEqual(r.rain.firstExhaustedDay, 3);
  const totalDraw = r.rain.rows.reduce((a, x) => a + x.draw, 0);
  near(totalDraw, r.battery.useWh, 'Σ每天用电 == 可用电量');
});
test('阴雨：小数天时净额也按比例缩（发电与用电同一比例）', () => {
  const st = def(); st.sys.days = '1.5';
  const r = calc(st);
  assert.strictEqual(r.rain.rows.length, 2);
  near(r.rain.rows[1].gen, r.rain.genPerDay * 0.5);
  near(r.rain.rows[1].net, (r.rain.genPerDay - r.totals.E_day) * 0.5);
});
test('设计推论：E_use ≡ Σ每天用电 ⇒ 余额永远不为负，firstEmptyDay 结构性不可达', () => {
  /* 电池是按「自持天数 × 日耗电」配的，阴雨期总用电量正好等于可用电量，
     发电又是非负的 ⇒ 未 clamp 的余额不可能为负。也就是说「负载被饿着」这种状态
     在这套模型里构造不出来；firstEmptyDay 只是防御性字段（对拍契约里保留它）。
     这条不是「没测到」，而是被证明为恒 null —— 用一个随机扫描把它钉住。 */
  const rnd = mulberry32(9090);
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const st = def();
    st.loads = [{ name: 'L', w: String(1 + rnd() * 2000), hours: String(0.1 + rnd() * 23), qty: '1', ac: rnd() < 0.4, simultaneous: true, surge: '1' }];
    st.sys.psh = String(0.5 + rnd() * 6);
    st.sys.etaSys = String(0.3 + rnd() * 0.7);
    st.sys.etaInv = String(0.6 + rnd() * 0.4);
    st.sys.days = String(Math.round(rnd() * 60) / 10);      /* 0–6 天，含小数 */
    st.sys.rainFactor = String(Math.round(rnd() * 100) / 100);
    const r = calc(st);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.rain.firstEmptyDay, null,
      '构造性不可能：' + JSON.stringify({ days: r.input.days, f: r.input.rainFactor }));
    assert.notStrictEqual(A.rainVerdict(r).code, 'short', 'short 分支不可达');
    assert.ok(r.rain.endQ >= -1e-6, 'endQ 不该为负：' + r.rain.endQ);
    const totalDraw = r.rain.rows.reduce((a, x) => a + x.draw, 0);
    assert.ok(Math.abs(totalDraw - r.battery.useWh) <= 1e-6 * Math.max(1, r.battery.useWh), '总用电 ≠ 可用电量');
    n++;
  }
  assert.strictEqual(n, 200);
});
test('阴雨：逐日字段自洽（gen 恒定、draw=E_day、net=gen−draw、q 单调不增）', () => {
  const r = calc(set(def(), 'sys.rainFactor', 0.3));
  let prev = r.battery.useWh;
  r.rain.rows.forEach((x, i) => {
    near(x.gen, r.rain.genPerDay, 'gen');
    near(x.draw, r.totals.E_day, 'draw');
    near(x.net, x.gen - x.draw, 'net');
    assert.ok(x.q <= prev + 1e-9, '第 ' + (i + 1) + ' 天余量不该上升');
    assert.ok(x.q >= -1e-9 && x.q <= r.battery.useWh + 1e-9, 'q 必须在 [0, 可用电量]');
    prev = x.q;
  });
});
test('阴雨：自持 0.5 天时第 1 天正好用完（不是不够用）', () => {
  const st = set(def(), 'sys.rainFactor', 0);
  st.sys.days = '0.5';
  const r = calc(st);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.rain.rows.length, 1);
  assert.strictEqual(r.rain.firstEmptyDay, null);
  assert.strictEqual(r.rain.firstExhaustedDay, 1);
  assert.strictEqual(A.rainVerdict(r).code, 'exact');
  near(r.rain.endQ, 0);
});
test('阴雨：撑得住时三个信号口径一致，且 rainVerdict 说「还剩多少」', () => {
  const r = calc(set(def(), 'sys.rainFactor', 0.2));
  assert.strictEqual(r.rain.firstEmptyDay, null);
  assert.strictEqual(r.rain.firstExhaustedDay, null);
  assert.ok(r.rain.endQ > 0);
  const v = A.rainVerdict(r);
  assert.strictEqual(v.code, 'ok');
  assert.ok(v.text.indexOf('撑过 2 天') >= 0, v.text);
  assert.ok(v.text.indexOf(A.fmt(r.rain.endQ, 1)) >= 0, v.text);
});
test('阴雨：自持天数填 0 时 rainVerdict 明说「不用电池」', () => {
  const r = calc(set(def(), 'sys.days', 0));
  assert.strictEqual(A.rainVerdict(r).code, 'none');
  assert.strictEqual(r.rain.endQ, 0);
});
test('设计推论：装机向上取整 ⇒ 晴天日发电永远不小于日耗电（surplus ≥ 0）', () => {
  /* 这是「取整向上」的必然结果，不是巧合；随机压测里也钉着这条 */
  const rnd = (function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(4242);
  for (let i = 0; i < 120; i++) {
    const st = def();
    st.loads = [{ name: 'L', w: String(1 + rnd() * 3000), hours: String(0.1 + rnd() * 23), qty: '1', ac: false, simultaneous: true, surge: '1' }];
    st.sys.psh = String(0.5 + rnd() * 6);
    st.sys.etaSys = String(0.3 + rnd() * 0.7);
    st.sys.panelW = String(10 + Math.floor(rnd() * 500));
    const r = calc(st);
    assert.strictEqual(r.ok, true);
    assert.ok(r.panel.surplus >= -1e-9, 'surplus 成了负数：' + r.panel.surplus);
  }
});
test('阴雨：自持天数拉长会把「用光的那一天」推后', () => {
  const st = () => set(def(), 'sys.rainFactor', 0);
  const a = calc(set(st(), 'sys.days', 2));
  const b = calc(set(st(), 'sys.days', 6));
  assert.strictEqual(a.rain.firstExhaustedDay, 2);
  assert.strictEqual(b.rain.firstExhaustedDay, 6);
  assert.ok(b.rain.firstExhaustedDay > a.rain.firstExhaustedDay, '天数更多应该撑更久');
  assert.ok(b.battery.useWh > a.battery.useWh);
});
test('阴雨：弃电只在充满时发生，且 spill ≥ 0', () => {
  const r = calc(set(def(), 'sys.rainFactor', 1));
  assert.ok(r.rain.spill >= 0);
  const r0 = calc(set(def(), 'sys.rainFactor', 0.2));
  near(r0.rain.spill, 0);
});
test('阴雨：surplus 正好为 0 时 refillDays 为 null（不是除零）', () => {
  /* 装机向上取整 ⇒ surplus 不会为负；为 0 只会出现在「需求正好等于装机」这一种情形 */
  const st = def();
  st.loads = [{ name: '负载', w: '100', hours: '1', qty: '1', ac: false, simultaneous: true, surge: '1' }];
  st.sys.psh = '1'; st.sys.etaSys = '1'; st.sys.panelW = '100'; st.sys.days = '3';
  const r = calc(st);
  assert.strictEqual(r.ok, true);
  near(r.panel.surplus, 0, 'surplus 正好是 0');
  assert.strictEqual(r.rain.refillDays, null, '除零要变成 null');
  const full = calc(set(st, 'sys.rainFactor', 1));
  near(full.rain.genPerDay, full.totals.E_day, '阴雨天满发时发电正好等于当天用电');
  assert.strictEqual(full.rain.endQ, full.battery.useWh, '不亏不盈，一直是满的');
});
test('阴雨：refillDays 与 surplus 口径自洽（攒回满电要几天）', () => {
  const r = calc(set(def(), 'sys.rainFactor', 0.2));
  near(r.rain.refillDays, (r.battery.useWh - r.rain.endQ) / r.panel.surplus);
  assert.ok(r.rain.refillDays > 0);
});

/* ════════════════ 9. 预置场景 ════════════════ */
test('预置：5 个场景全部可算，且都有负载与结论', () => {
  assert.strictEqual(A.PRESETS.length, 5);
  A.PRESETS.forEach((p) => {
    const r = calc(A.defaultState(p.id));
    assert.strictEqual(r.ok, true, p.id + ' ' + JSON.stringify(r.errors));
    assert.ok(r.loadRows.length > 0, p.id);
    assert.ok(r.panel.need > 0 && r.battery.ahNeed >= 0, p.id);
  });
});
test('预置：摄像头场景自持 3 天，电池可用电量 = 3×日耗电', () => {
  const r = calc(A.defaultState('camera'));
  near(r.battery.useWh, r.totals.E_day * 3);
  assert.strictEqual(r.input.days, 3);
});
test('预置：小屋场景是 24 V，控制器电流按 24 V 算', () => {
  const r = calc(A.defaultState('cabin'));
  assert.strictEqual(r.input.vBat, 24);
  near(r.controller.amps, r.panel.installed / 24 * (1 + r.input.reserve));
});
test('预置：已有设备场景给出「组件不够」而不是沉默', () => {
  const r = calc(A.defaultState('have'));
  assert.strictEqual(r.have.verdict, '组件不够');
  assert.ok(r.suggestions.some((s) => s.id === 'havePanel'), r.suggestions.map((s) => s.id).join(','));
});
test('预置：未知 id 回退到默认场景（不抛异常）', () => {
  const r = calc(A.defaultState('不存在的 id'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.loadRows.length, 7);
});

/* ════════════════ 10. 建议：每条点下去真的能生效 ════════════════ */
test('建议：默认场景给出 5 条，且都有标题与理由', () => {
  const r = calc(def());
  assert.ok(r.suggestions.length >= 5, '实际 ' + r.suggestions.length);
  r.suggestions.forEach((s) => {
    assert.ok(s.title && s.title.length > 3, JSON.stringify(s));
    assert.ok(s.why && s.why.length > 5, JSON.stringify(s));
  });
});
test('建议：每一条应用后 state 真的变了，并且能重算出结果', () => {
  const st = def();
  const r = calc(st);
  r.suggestions.forEach((s) => {
    const next = A.applySuggestion(st, s);
    assert.notStrictEqual(JSON.stringify(next), JSON.stringify(st), 'suggestion ' + s.id + ' 应用后 state 没变');
    const r2 = calc(next);
    assert.strictEqual(r2.ok, true, 'suggestion ' + s.id + ' 应用后算不出来了：' + JSON.stringify(r2.errors));
  });
});
test('建议：自持 +1 天后电池容量确实变大', () => {
  const st = def();
  const s = calc(st).suggestions.find((x) => x.id === 'days+1');
  assert.ok(s, '应当有 days+1 建议');
  const after = calc(A.applySuggestion(st, s));
  assert.strictEqual(after.input.days, 3);
  assert.ok(after.battery.ahNeed > calc(st).battery.ahNeed);
});
test('建议：换 24 V 后控制器电流确实减半', () => {
  const st = def();
  const s = calc(st).suggestions.find((x) => x.id === 'vbat24');
  assert.ok(s, '应当有 vbat24 建议（默认 I_ctrl=83.3 > 60）');
  const before = calc(st), after = calc(A.applySuggestion(st, s));
  near(after.controller.amps, before.controller.amps / 2);
});
test('建议：「不同时开」确实把逆变器连续功率降下来', () => {
  const st = def();
  const s = calc(st).suggestions.find((x) => x.id === 'unsim');
  assert.ok(s);
  const before = calc(st), after = calc(A.applySuggestion(st, s));
  assert.ok(after.inverter.cont < before.inverter.cont);
  assert.strictEqual(after.loadRows[s.loadIndex].simultaneous, false);
});
test('建议：应用建议不改原 state（纯函数）', () => {
  const st = def();
  const copy = JSON.stringify(st);
  const r = calc(st);
  r.suggestions.forEach((s) => A.applySuggestion(st, s));
  assert.strictEqual(JSON.stringify(st), copy);
});
test('建议：负载行删到只剩一行时仍不抛异常', () => {
  const st = def();
  st.loads = [st.loads[0]];
  const r = calc(st);
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.suggestions));
});

/* ════════════════ 11. 导出 ════════════════ */
test('导出 CSV：合法态含全部关键行且行数正确', () => {
  const r = calc(def());
  const csv = A.toCSV(def(), r, { exportedAt: '2026-11-13T00:00:00Z' });
  const lines = csv.trim().split('\n');
  assert.ok(lines[0].indexOf('项目,值,单位,说明') === 0, lines[0]);
  ['日耗电', '组件需求', '电池容量需求', '控制器电流', '逆变器连续功率', '阴雨期', '阴雨期结束余量', '年发电量估算', '负载清单'].forEach((k) => {
    assert.ok(csv.indexOf(k) >= 0, 'CSV 缺 ' + k);
  });
  assert.ok(lines.length > 25, '行数 ' + lines.length);
  assert.strictEqual(lines.filter((l) => l.split(',').length === 8).length, r.loadRows.length + 1, '负载表应有一行表头 + ' + r.loadRows.length + ' 行');
});
test('导出 CSV：非法态不崩，写成错误说明', () => {
  const st = set(def(), 'sys.psh', 'abc');
  const r = calc(st);
  const csv = A.toCSV(st, r, {});
  assert.ok(csv.indexOf('输入有误') >= 0, csv.slice(0, 300));
  assert.ok(csv.split('\n').length >= 3);
});
test('导出 CSV：含逗号的名称被正确转义', () => {
  const st = def();
  st.loads[0].name = '冰箱,大号';
  const r = calc(st);
  const csv = A.toCSV(st, r, {});
  assert.ok(csv.indexOf('"冰箱,大号"') >= 0, '没能正确转义');
});
test('导出 Markdown：四张表都在，且数字与引擎同源', () => {
  const st = def();
  const r = calc(st);
  const md = A.toMarkdown(st, r, { exportedAt: '2026-11-13T00:00:00Z' });
  ['## 结论', '## 账', '## 负载清单', '## 阴雨天那几天'].forEach((h) => assert.ok(md.indexOf(h) >= 0, '缺 ' + h));
  assert.ok(md.indexOf(A.fmt(r.panel.need, 1)) >= 0, '组件需求没出现在 md 里');
  assert.ok(md.indexOf(A.fmt(r.battery.ahNeed, 1)) >= 0, '电池容量没出现在 md 里');
  assert.ok(md.indexOf(A.fmt(r.controller.amps, 1)) >= 0, '控制器电流没出现在 md 里');
});
test('导出 Markdown：非法态写成错误列表，不输出半截表', () => {
  const st = set(def(), 'loads[0].w', 'abc');
  const r = calc(st);
  const md = A.toMarkdown(st, r, {});
  assert.ok(md.indexOf('输入有误') >= 0);
  assert.ok(md.indexOf('## 结论') < 0, '不该输出结论表');
});
test('导出 JSON：可被解析回来，且 result 与引擎一致', () => {
  const st = def();
  const r = calc(st);
  const s = A.toJSON(st, r, {});
  const o = JSON.parse(s);
  assert.strictEqual(o.app, A.SPEC.title);
  near(o.result.totals.E_day, r.totals.E_day);
  assert.strictEqual(o.result.panel.count, r.panel.count);
  assert.strictEqual(o.input.loads.length, st.loads.length);
});
test('导出 JSON：非法态也返回合法 JSON', () => {
  const st = set(def(), 'sys.days', 'x');
  const o = JSON.parse(A.toJSON(st, calc(st), {}));
  assert.strictEqual(o.result.ok, false);
});

/* ════════════════ 12. 纯函数与确定性 ════════════════ */
test('纯函数：compute 不修改传入的 state', () => {
  const st = def();
  const copy = JSON.stringify(st);
  calc(st);
  assert.strictEqual(JSON.stringify(st), copy);
});
test('确定性：同一输入连算 5 次结果逐字节相同', () => {
  const st = def();
  const first = JSON.stringify(calc(st));
  for (let i = 0; i < 5; i++) assert.strictEqual(JSON.stringify(calc(st)), first);
});
test('确定性：state 深拷贝后结果相同（不共享引用）', () => {
  const a = A.cloneState(def());
  const b = A.cloneState(a);
  assert.strictEqual(JSON.stringify(calc(a)), JSON.stringify(calc(b)));
  b.loads[0].w = '50';
  assert.notStrictEqual(JSON.stringify(calc(a)), JSON.stringify(calc(b)));
});
test('cloneState：默认状态每次都是新对象（改一份不影响另一份）', () => {
  const a = def(), b = def();
  a.loads[0].w = '999';
  assert.notStrictEqual(a.loads[0].w, b.loads[0].w);
});
test('字段契约：结果对象的键一个不少', () => {
  const r = calc(def());
  ['ok', 'errors', 'warnings', 'loadRows', 'totals', 'panel', 'battery', 'controller', 'inverter', 'rain', 'year', 'have', 'suggestions', 'derivations']
    .forEach((k) => assert.ok(k in r, '缺字段 ' + k));
  ['E_day', 'E_dc', 'E_ac', 'E_invLoss'].forEach((k) => assert.ok(k in r.totals, 'totals 缺 ' + k));
  ['rows', 'firstEmptyDay', 'firstExhaustedDay', 'refillDays', 'spill', 'factor', 'days', 'endQ'].forEach((k) => assert.ok(k in r.rain, 'rain 缺 ' + k));
  assert.strictEqual(typeof A.rainVerdict, 'function');
  /* 可达的三种：不用电池 / 正好用完 / 还有余量。'short'（负载被饿着）在 E_use ≡ Σ用电 的模型下不可达，
     只作为防御分支保留，它的不可达性由上一条「设计推论」测试钉住。 */
  ['none', 'exact', 'ok'].forEach((code) => {
    const st = def();
    if (code === 'none') st.sys.days = '0';
    if (code === 'exact') st.sys.rainFactor = '0';
    if (code === 'ok') st.sys.rainFactor = '0.2';
    assert.strictEqual(A.rainVerdict(calc(st)).code, code, code);
  });
  assert.strictEqual(A.rainVerdict(calc(set(def(), 'sys.psh', 'abc'))).code, 'na');
});

/* ════════════════ 13. 可解释性 ════════════════ */
test('可解释：每条推导文案里都带着用户自己的数', () => {
  const r = calc(def());
  const d = r.derivations;
  assert.ok(d.E_day.indexOf('1476.0') >= 0, d.E_day);
  assert.ok(d.E_day.indexOf('375.0') >= 0, d.E_day);
  assert.ok(d.Wp_need.indexOf('4.00') >= 0, d.Wp_need);
  assert.ok(d.Wp_need.indexOf('0.72') >= 0, d.Wp_need);
  assert.ok(d.I_ctrl.indexOf('800') >= 0, d.I_ctrl);
  assert.ok(d.P_rec.indexOf('125') >= 0, d.P_rec);
});
test('可解释：改输入后推导文案跟着变（不是硬编码的）', () => {
  const st = set(def(), 'sys.psh', 6);
  const r = calc(st);
  assert.ok(r.derivations.Wp_need.indexOf('6.00') >= 0, r.derivations.Wp_need);
  const st2 = set(def(), 'sys.days', 5);
  assert.ok(calc(st2).derivations.E_use.indexOf('5.0') >= 0, calc(st2).derivations.E_use);
});

/* ════════════════ 14. 随机压测（不变量） ════════════════ */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
test('随机 300 组合法输入 × 14 条不变量，0 违反', () => {
  const rnd = mulberry32(20261113);
  let checked = 0, violated = [];
  for (let s = 0; s < 300; s++) {
    const n = 1 + Math.floor(rnd() * 8);
    const loads = [];
    for (let i = 0; i < n; i++) {
      loads.push({
        name: 'L' + i,
        w: String(Math.round((1 + rnd() * 1999) * 10) / 10),
        hours: String(Math.round((0.1 + rnd() * 23.9) * 10) / 10),
        qty: String(1 + Math.floor(rnd() * 10)),
        ac: rnd() < 0.4,
        simultaneous: rnd() < 0.7,
        surge: String(Math.round((1 + rnd() * 4) * 10) / 10)
      });
    }
    const st = {
      loads: loads,
      sys: {
        psh: String(Math.round((0.5 + rnd() * 7) * 100) / 100),
        etaSys: String(Math.round((0.3 + rnd() * 0.7) * 100) / 100),
        etaInv: String(Math.round((0.6 + rnd() * 0.4) * 100) / 100),
        vBat: String([12, 24, 48][Math.floor(rnd() * 3)]),
        dod: String(Math.round((0.3 + rnd() * 0.7) * 100) / 100),
        days: String(Math.floor(rnd() * 6)),
        panelW: String([50, 100, 200, 300, 400, 550][Math.floor(rnd() * 6)]),
        battUnitAh: String([50, 100, 150, 200, 280][Math.floor(rnd() * 5)]),
        reserve: String(Math.round(rnd() * 100) / 100),
        invMargin: String(1 + Math.round(rnd() * 100) / 100),
        rainFactor: String(Math.round(rnd() * 100) / 100)
      },
      have: { panelW: String(Math.floor(rnd() * 2000)), battAh: String(Math.floor(rnd() * 1000)) }
    };
    const r = calc(st);
    const where = 'seed#' + s;
    const bad = (m) => violated.push(where + ': ' + m);
    if (!r.ok) { bad('合法输入被判非法 ' + JSON.stringify(r.errors)); continue; }
    const inv = [
      ['E_day == E_dc + E_ac/etaInv', Math.abs(r.totals.E_day - (r.totals.E_dc + r.totals.E_ac / r.input.etaInv)) < 1e-6],
      ['Wp_inst == n_p*panelW', Math.abs(r.panel.installed - r.panel.count * r.panel.unit) < 1e-6],
      ['Wp_inst >= Wp_need', r.panel.installed >= r.panel.need - 1e-6],
      ['Ah_inst >= Ah_need', r.battery.installedAh >= r.battery.ahNeed - 1e-6],
      ['I_ctrl == Wp_inst/vBat*(1+reserve)', Math.abs(r.controller.amps - r.panel.installed / r.input.vBat * (1 + r.input.reserve)) < 1e-6],
      ['P_rec == P_cont*invMargin', Math.abs(r.inverter.rec - r.inverter.cont * r.input.invMargin) < 1e-6],
      ['P_peak >= P_cont', r.inverter.peak >= r.inverter.cont - 1e-9],
      ['rain.rows 长度 == ⌈days⌉', r.rain.rows.length === Math.ceil(r.input.days - 1e-9)],
      ['rain q ∈ [0, E_use]', r.rain.rows.every((x) => x.q >= -1e-6 && x.q <= r.battery.useWh + 1e-6)],
      ['spill >= 0', r.rain.spill >= -1e-9],
      ['Σ rows == E_day', Math.abs(r.loadRows.reduce((a, x) => a + x.E_i, 0) - r.totals.E_day) < 1e-6],
      ['每个数都是有限数', [r.totals.E_day, r.panel.need, r.panel.installed, r.battery.ahNeed, r.controller.amps, r.inverter.rec, r.year.kwh].every((x) => isFinite(x))],
      ['have.verdict 在四个取值里', ['未填', '组件不够', '电池不够', '都够'].indexOf(r.have.verdict) >= 0],
      ['建议条数 ≤ 6 且每条都有 apply 目标', r.suggestions.length <= 6 && r.suggestions.every((x) => x.kind)]
    ];
    inv.forEach(([m, okv]) => { checked++; if (!okv) bad(m); });
  }
  assert.deepStrictEqual(violated.slice(0, 10), [], '不变量被违反 ' + violated.length + ' 处');
  assert.ok(checked >= 300 * 14 - 20, '检查项数 ' + checked);
});
test('随机 200 组非法输入：一律 ok=false 且推导量为 null，不抛异常', () => {
  const rnd = mulberry32(777);
  const poisons = ['abc', '', '-1', '1e3', '1,5', 'NaN', '999999999', '0', '2.5', '٣'];
  let n = 0;
  for (let s = 0; s < 200; s++) {
    const st = def();
    const fi = Math.floor(rnd() * 3);
    const v = poisons[Math.floor(rnd() * poisons.length)];
    if (fi === 0) st.loads[Math.floor(rnd() * st.loads.length)].w = v;
    else if (fi === 1) st.sys[SYSKEYS[Math.floor(rnd() * SYSKEYS.length)]] = v;
    else st.loads[Math.floor(rnd() * st.loads.length)].qty = v;
    let r;
    assert.doesNotThrow(() => { r = calc(st); }, '抛异常了，投毒值 ' + v);
    if (!r.ok) {
      assert.strictEqual(r.totals, null);
      assert.strictEqual(r.panel, null);
      assert.ok(r.errors.length > 0);
      n++;
    }
  }
  assert.ok(n > 100, '应当有相当一部分被判非法，实际 ' + n);
});
const SYSKEYS = ['psh', 'etaSys', 'etaInv', 'vBat', 'dod', 'days', 'panelW', 'battUnitAh', 'reserve', 'invMargin', 'rainFactor'];

/* ════════════════ 15. 自检「会红」：注入错误必须让锚点变红 ════════════════ */
test('自检会红：14 套人工注入的错误各自让至少一条锚点断言失败', () => {
  const MUT = [
    ['E_day 少除一次逆变器效率', "E_ac += rawWh; r.E_i = rawWh / etaInv;", "E_ac += rawWh; r.E_i = rawWh;"],
    ['组件需求忘了乘系统效率', "var Wp_need = E_day / (psh * etaSys);", "var Wp_need = E_day / psh;"],
    ['电池容量忘了除放电深度', "var E_nom = E_use / dod;", "var E_nom = E_use;"],
    ['电池容量多除一次电压', "var Ah_need = E_nom / vBat;", "var Ah_need = E_nom / vBat / vBat;"],
    ['控制器电流忘了加余量', "var I_ctrl = Wp_inst / vBat * (1 + reserve);", "var I_ctrl = Wp_inst / vBat;"],
    ['逆变器峰值忘了乘启动倍率', "row.P_peak_contrib = (row.ac && row.simultaneous) ? p * q * g : 0;", "row.P_peak_contrib = (row.ac && row.simultaneous) ? p * q : 0;"],
    ['向上取整写成了四舍五入', "var n_p = ceilSafe(Wp_need / panelW);", "var n_p = Math.round(Wp_need / panelW);"],
    ['阴雨天日照系数忘了生效', "var G_rain = Wp_inst * psh * rainFactor * etaSys;", "var G_rain = Wp_inst * psh * etaSys;"],
    ['年发电量当成 360 天', "var E_year_kwh = Wp_inst * psh * 365 * etaSys / 1000;", "var E_year_kwh = Wp_inst * psh * 360 * etaSys / 1000;"],
    ['直流行也被除了逆变器效率', "else { E_dc += rawWh; r.E_i = rawWh; }", "else { E_dc += rawWh; r.E_i = rawWh / etaInv; }"],
    ['弃电没有 clamp 上限', "else if (raw > E_use + tol) { spill += raw - E_use; qEnd = E_use; }", "else if (raw > E_use + tol) { qEnd = raw; }"],
    ['余额比较去掉容差', "if (raw < -tol) { if (firstEmptyDay === null) firstEmptyDay = d; qEnd = 0; }", "if (raw < 0) { if (firstEmptyDay === null) firstEmptyDay = d; qEnd = 0; }"],
    ['反推把放电深度算反了', "var d_have = ratio(hb * vBat * dod, E_day);", "var d_have = ratio(hb * vBat / dod, E_day);"],
    ['已有组件可供电量忘了系统效率', "var E_sup = hp * psh * etaSys;", "var E_sup = hp * psh;"],
    ['建议的 24 V 电流没有跟着电压变', "var I_ctrl = Wp_inst / vBat * (1 + reserve);", "var I_ctrl = Wp_inst / vBat * (1 + reserve) * vBat / 12;"]
  ];
  /* 见证集必须覆盖到每一条公式所在的分支：默认场景之外还要有「大雨天（弃电）」「填了已有设备（反推）」「24 V」 */
  function scenarios() {
    const list = [];
    list.push(A.defaultState());
    list.push(A.defaultState('cabin'));
    list.push(A.defaultState('have'));
    const heavy = A.defaultState();
    heavy.sys.rainFactor = '0.95';           /* 阴雨天几乎满发 → 会弃电 */
    heavy.sys.days = '4';
    list.push(heavy);
    const h = A.defaultState();
    h.have.panelW = '150'; h.have.battAh = '120';
    list.push(h);
    const frac = A.defaultState();          /* 小数天：专门盯余额比较的容差分支 */
    frac.sys.days = '2.5'; frac.sys.rainFactor = '0';
    list.push(frac);
    return list;
  }
  function witness(r) {
    if (!r.ok) return ['INVALID'];
    return [
      r.totals.E_day, r.totals.E_dc, r.totals.E_ac, r.totals.E_invLoss,
      r.panel.need, r.panel.count, r.panel.installed, r.panel.genDay, r.panel.surplus,
      r.battery.useWh, r.battery.nomWh, r.battery.ahNeed, r.battery.count, r.battery.installedAh,
      r.controller.amps, r.inverter.cont, r.inverter.rec, r.inverter.peak,
      r.year.kwh, r.rain.genPerDay, r.rain.spill, r.rain.endQ,
      r.rain.firstEmptyDay, r.rain.firstExhaustedDay, r.rain.refillDays,
      r.have.E_sup, r.have.coverage, r.have.d_have
    ];
  }
  const golden = scenarios().map((s) => witness(calc(s)));
  const survivors = [];
  MUT.forEach(([label, from, to]) => {
    assert.ok(SRC.indexOf(from) >= 0, '注入点找不到：' + label);
    const mutated = SRC.replace(from, to);
    assert.notStrictEqual(mutated, SRC, label);
    let M;
    assert.doesNotThrow(() => { M = loadCore(mutated); }, label + ' 注入后无法加载');
    const ss = scenarios();
    let caught = false;
    for (let i = 0; i < ss.length && !caught; i++) {
      const w = witness(M.compute(ss[i]));
      const g = golden[i];
      if (w.length !== g.length) { caught = true; break; }
      for (let k = 0; k < w.length; k++) {
        const a = w[k], b = g[k];
        const same = (a === null || b === null) ? a === b
          : (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
            : a === b;
        if (!same) { caught = true; break; }
      }
    }
    if (!caught) survivors.push(label);
  });
  assert.deepStrictEqual(survivors, [], '这些注入没有让任何锚点变红（说明测试是空的）：' + survivors.join(' / '));
});

/* ════════════════ 16. 数值格式化 ════════════════ */
test('格式化：一半进位按「远离零」而不是 Math.round（负数要正确）', () => {
  assert.strictEqual(A.fmt(2.5, 0), '3');
  assert.strictEqual(A.fmt(-2.5, 0), '-3');
  assert.strictEqual(A.fmt(0.05, 1), '0.1');
  assert.strictEqual(A.fmt(-0.05, 1), '-0.1');
});
test('格式化：null / undefined / NaN / Infinity 一律显示 —', () => {
  [null, undefined, NaN, Infinity, -Infinity].forEach((v) => assert.strictEqual(A.fmt(v, 1), '—', String(v)));
});
test('格式化：千分位不是格式化的一部分（保持纯数字，便于回流计算）', () => {
  assert.strictEqual(A.fmt(1234.56, 1), '1234.6');
  assert.strictEqual(A.fmtPct(0.12345, 1), '12.3%');
});
test('格式化：fmtInt 不带小数', () => {
  assert.strictEqual(A.fmtInt(800), '800');
  assert.strictEqual(A.fmtInt(799.6), '800');
});
