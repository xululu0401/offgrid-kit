/* 配一套自己发的电 · 纯计算内核（core.js）
 * 口径全部来自 ../需求与调研.md §2，任何改动都要同步那份文字。
 * 这个文件不碰 DOM，可以在 node 里直接 require 做测试。
 */
(function (global) {
  'use strict';

  /* ══════════════════ 1. 规格表（唯一的范围真相） ══════════════════ */
  var SPEC = {
    version: '1.0.0',
    title: '配一套自己发的电',
    sys: [
      { key: 'psh', label: '峰值日照小时', unit: 'h/天', min: 0, minIncl: false, max: 12, maxIncl: true, dp: 2 },
      { key: 'etaSys', label: '系统综合效率', unit: '', min: 0, minIncl: false, max: 1, maxIncl: true, dp: 2 },
      { key: 'etaInv', label: '逆变器效率', unit: '', min: 0, minIncl: false, max: 1, maxIncl: true, dp: 2 },
      { key: 'vBat', label: '电池标称电压', unit: 'V', min: 0, minIncl: false, max: 1000, maxIncl: true, dp: 2 },
      { key: 'dod', label: '放电深度', unit: '', min: 0, minIncl: false, max: 1, maxIncl: true, dp: 2 },
      { key: 'days', label: '阴雨自持天数', unit: '天', min: 0, minIncl: true, max: 30, maxIncl: true, dp: 1 },
      { key: 'panelW', label: '单块组件', unit: 'W', min: 0, minIncl: false, max: 5000, maxIncl: true, dp: 0 },
      { key: 'battUnitAh', label: '单块电池', unit: 'Ah', min: 0, minIncl: false, max: 5000, maxIncl: true, dp: 0 },
      { key: 'reserve', label: '控制器电流余量', unit: '', min: 0, minIncl: true, max: 2, maxIncl: true, dp: 2 },
      { key: 'invMargin', label: '逆变器功率余量', unit: '倍', min: 1, minIncl: true, max: 3, maxIncl: true, dp: 2 },
      { key: 'rainFactor', label: '阴雨天日照系数', unit: '', min: 0, minIncl: true, max: 1, maxIncl: true, dp: 2 }
    ],
    load: [
      { key: 'w', label: '功率', unit: 'W', min: 0, minIncl: false, max: 20000, maxIncl: true, dp: 1 },
      { key: 'hours', label: '每天用', unit: 'h', min: 0, minIncl: false, max: 24, maxIncl: true, dp: 2 },
      { key: 'qty', label: '数量', unit: '个', min: 1, minIncl: true, max: 50, maxIncl: true, dp: 0, integer: true },
      { key: 'surge', label: '启动倍率', unit: '倍', min: 1, minIncl: true, max: 8, maxIncl: true, dp: 2 }
    ],
    have: [
      { key: 'panelW', label: '已有组件', unit: 'W', min: 0, minIncl: true, max: 100000, maxIncl: true, dp: 0 },
      { key: 'battAh', label: '已有电池', unit: 'Ah', min: 0, minIncl: true, max: 100000, maxIncl: true, dp: 0 }
    ],
    maxLoads: 40
  };
  var SYS_SPEC = {}, LOAD_SPEC = {}, HAVE_SPEC = {};
  SPEC.sys.forEach(function (s) { SYS_SPEC[s.key] = s; });
  SPEC.load.forEach(function (s) { LOAD_SPEC[s.key] = s; });
  SPEC.have.forEach(function (s) { HAVE_SPEC[s.key] = s; });
  var SYS_ORDER = SPEC.sys.map(function (s) { return s.key; });
  var LOAD_ORDER = SPEC.load.map(function (s) { return s.key; });

  /* ══════════════════ 2. 数值工具 ══════════════════ */
  /* 十进制文本；不接受科学计数法/十六进制/千分位逗号 —— 宁可报「不是数字」，也不静默吞掉 */
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

  function parseField(raw, spec) {
    var t = (raw === null || raw === undefined) ? '' : String(raw).trim();
    if (t === '') return { value: null, code: 'empty', message: spec.label + '还没填' };
    if (!NUM_RE.test(t)) return { value: null, code: 'not-number', message: spec.label + '不是数字：「' + t + '」' };
    var v = Number(t);
    if (!isFinite(v)) return { value: null, code: 'not-number', message: spec.label + '不是有限的数字：「' + t + '」' };
    if (spec.integer && Math.floor(v) !== v) {
      return { value: null, code: 'not-integer', message: spec.label + '要填整数：「' + t + '」' };
    }
    if (v < spec.min || (!spec.minIncl && v === spec.min)) {
      return { value: null, code: 'too-small', message: spec.label + '要' + (spec.minIncl ? '不小于' : '大于') + ' ' + spec.min + '（现在是 ' + t + '）' };
    }
    if (v > spec.max || (!spec.maxIncl && v === spec.max)) {
      return { value: null, code: 'too-large', message: spec.label + '要' + (spec.maxIncl ? '不大于' : '小于') + ' ' + spec.max + '（现在是 ' + t + '）' };
    }
    return { value: v, code: null, message: '' };
  }

  function roundHalfAway(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }
  function roundDp(x, dp) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    var f = Math.pow(10, dp);
    return roundHalfAway(x * f) / f;
  }
  /* 向上取整带容差：658.9999999999999 该是 659 而不是 660，但 657.2/200=3.286 必须是 4 */
  function ceilSafe(x) {
    if (!isFinite(x)) return x;
    var r = Math.round(x);
    if (Math.abs(x - r) <= 1e-9 * Math.max(1, Math.abs(x))) return r;
    return Math.ceil(x);
  }
  function fmt(x, dp) {
    if (x === null || x === undefined || typeof x !== 'number' || !isFinite(x)) return '—';
    var d = (dp === undefined) ? 1 : dp;
    return roundDp(x, d).toFixed(d);
  }
  function fmtInt(x) { return fmt(x, 0); }
  /* 天数：整数就不带小数（「2 天」而不是「2.0 天」），小数保留 1 位（「2.5 天」） */
  function fmtDays(d) {
    if (typeof d !== 'number' || !isFinite(d)) return '—';
    return (Math.abs(d - Math.round(d)) < 1e-9) ? String(Math.round(d)) : fmt(d, 1);
  }
  /* 电压：整数就不带小数（「12 V」而不是「12.00 V」） */
  function fmtV(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    return (Math.abs(x - Math.round(x)) < 1e-9) ? String(Math.round(x)) : fmt(x, 2);
  }
  function fmtPct(x, dp) { return (x === null ? '—' : fmt(x * 100, dp === undefined ? 1 : dp) + '%'); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function ratio(a, b) { return (isNum(a) && isNum(b) && b !== 0) ? a / b : null; }

  /* ══════════════════ 3. 默认状态 / 预置场景 ══════════════════ */
  function load(name, w, hours, qty, ac, simultaneous, surge) {
    return {
      name: name, w: String(w), hours: String(hours), qty: String(qty),
      ac: !!ac, simultaneous: simultaneous === undefined ? true : !!simultaneous,
      surge: String(surge === undefined ? 1 : surge)
    };
  }
  var SYS_DEFAULT = {
    psh: '4.0', etaSys: '0.72', etaInv: '0.90', vBat: '12', dod: '0.80', days: '2',
    panelW: '200', battUnitAh: '100', reserve: '0.25', invMargin: '1.2', rainFactor: '0.20'
  };
  function sysOf(over) {
    var o = {}; SYS_ORDER.forEach(function (k) { o[k] = SYS_DEFAULT[k]; });
    Object.keys(over || {}).forEach(function (k) { o[k] = String(over[k]); });
    return o;
  }

  var PRESETS = [
    {
      id: 'rv', name: '房车 / 床车（12 V 默认样例）',
      note: '虚构示例：一台车载冰箱加灯、风扇、笔记本和两个短时大功率交流电器。',
      state: {
        loads: [
          load('车载冰箱', 45, 24, 1, false, true, 1),
          load('LED 灯', 8, 5, 3, false, true, 1),
          load('排风扇', 12, 8, 1, false, true, 1),
          load('笔记本（DC-DC）', 45, 4, 1, false, true, 1),
          load('手机充电', 65, 3, 1, true, true, 1),
          load('电饭煲', 300, 0.5, 1, true, false, 1),
          load('水泵', 60, 0.5, 1, true, true, 3)
        ],
        sys: sysOf({})
      }
    },
    {
      id: 'camera', name: '院子里的摄像头 + 路由（无人值守）',
      note: '虚构示例：两个小功率负载 24 小时不断电，自持天数拉到 3 天。',
      state: {
        loads: [
          load('摄像头', 5, 24, 1, false, true, 1),
          load('4G 路由', 8, 24, 1, false, true, 1)
        ],
        sys: sysOf({ psh: '3.5', days: '3', panelW: '100', battUnitAh: '50', rainFactor: '0.15' })
      }
    },
    {
      id: 'cabin', name: '离网小屋（24 V，带冰箱和电视）',
      note: '虚构示例：24 V 系统，负载更大、同时用电更多，用来看电压换档的效果。',
      state: {
        loads: [
          load('直流冰箱', 60, 10, 1, false, true, 2),
          load('LED 灯', 9, 6, 6, false, true, 1),
          load('电视盒子', 25, 4, 1, true, true, 1),
          load('小电视', 90, 4, 1, true, true, 1),
          load('水泵', 400, 0.3, 1, true, true, 3)
        ],
        sys: sysOf({ vBat: '24', dod: '0.8', days: '2', panelW: '400', battUnitAh: '200', psh: '4.5' })
      }
    },
    {
      id: 'camp', name: '周末露营（小负载、只要够用）',
      note: '虚构示例：手机、灯、小音箱，看看最小配置要多少。',
      state: {
        loads: [
          load('手机充电', 20, 2, 2, true, true, 1),
          load('露营灯', 5, 6, 2, false, true, 1),
          load('小音箱', 15, 3, 1, true, true, 1)
        ],
        sys: sysOf({ psh: '3.0', days: '1', panelW: '100', battUnitAh: '50' })
      }
    },
    {
      id: 'have', name: '我手上已经有一块 100 W 板和 100 Ah 电池',
      note: '虚构示例：只改「手上已有」两个数，看反推怎么回答「这块板到底能带什么」。',
      state: {
        loads: [
          load('车载冰箱', 45, 24, 1, false, true, 1),
          load('LED 灯', 8, 5, 2, false, true, 1),
          load('手机充电', 20, 2, 2, true, true, 1)
        ],
        sys: sysOf({}),
        have: { panelW: '100', battAh: '100' }
      }
    }
  ];

  function defaultState(presetId) {
    var p = PRESETS[0];
    if (presetId) {
      for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === presetId) p = PRESETS[i];
    }
    return cloneState(p.state);
  }
  function cloneState(s) {
    return {
      loads: (s.loads || []).map(function (l) {
        return {
          name: l.name || '', w: String(l.w), hours: String(l.hours), qty: String(l.qty),
          ac: !!l.ac, simultaneous: l.simultaneous === undefined ? true : !!l.simultaneous, surge: String(l.surge)
        };
      }),
      sys: sysOf(s.sys || {}),
      have: { panelW: String((s.have || {}).panelW === undefined ? '0' : s.have.panelW), battAh: String((s.have || {}).battAh === undefined ? '0' : s.have.battAh) },
      presetId: s.presetId || 'rv'
    };
  }

  /* ══════════════════ 4. 计算 ══════════════════ */
  function labelOf(l, i) { return (l.name && String(l.name).trim()) || ('负载 ' + (i + 1)); }

  function compute(state) {
    var errors = [];
    var warnings = [];
    var loads = (state && state.loads) || [];
    var sysRaw = (state && state.sys) || {};
    var haveRaw = (state && state.have) || {};

    if (loads.length === 0) {
      errors.push({ field: 'loads', code: 'empty-list', message: '负载清单是空的，至少加一行' });
    }
    if (loads.length > SPEC.maxLoads) {
      errors.push({ field: 'loads', code: 'too-many', message: '最多 ' + SPEC.maxLoads + ' 行负载（现在 ' + loads.length + ' 行）' });
    }

    /* ── 逐行解析与行内取电 ── */
    var rows = loads.map(function (l, i) {
      var row = {
        index: i, label: labelOf(l, i), ok: true, errors: [],
        ac: !!l.ac, simultaneous: l.simultaneous === undefined ? true : !!l.simultaneous,
        values: {}, E_i: null, deficit_wh: null,
        P_cont_contrib: 0, P_peak_contrib: 0
      };
      LOAD_ORDER.forEach(function (k) {
        var r = parseField(l[k], LOAD_SPEC[k]);
        row.values[k] = r.value;
        if (r.code) {
          row.ok = false;
          row.errors.push({ field: 'loads[' + i + '].' + k, code: r.code, message: r.message, raw: String(l[k] === undefined ? '' : l[k]) });
        }
      });
      if (row.ok) {
        var p = row.values.w, h = row.values.hours, q = row.values.qty, g = row.values.surge;
        row.raw_wh = p * h * q;
        row.E_i = row.ac ? row.raw_wh : row.raw_wh; /* 交流行还要除以逆变器效率，下面统一算 */
        row.P_cont_contrib = (row.ac && row.simultaneous) ? p * q : 0;
        row.P_peak_contrib = (row.ac && row.simultaneous) ? p * q * g : 0;
      }
      return row;
    });
    rows.forEach(function (r) { if (!r.ok) errors = errors.concat(r.errors); });

    /* ── 系统参数解析 ── */
    var sysV = {};
    SYS_ORDER.forEach(function (k) {
      var r = parseField(sysRaw[k], SYS_SPEC[k]);
      sysV[k] = r.value;
      if (r.code) {
        errors.push({ field: 'sys.' + k, code: r.code, message: r.message, raw: String(sysRaw[k] === undefined ? '' : sysRaw[k]) });
      }
    });

    /* ── 手上已有（永远不阻塞计算；超范围只按越界处理，不产生 ok=false） ── */
    var haveV = {}, haveProblems = [];
    Object.keys(HAVE_SPEC).forEach(function (k) {
      var r = parseField(haveRaw[k], HAVE_SPEC[k]);
      if (r.code) { haveProblems.push({ field: 'have.' + k, code: r.code, message: r.message, raw: String(haveRaw[k] === undefined ? '' : haveRaw[k]) }); haveV[k] = 0; }
      else haveV[k] = r.value;
    });
    haveProblems.forEach(function (p) { warnings.push(p); });

    var ok = errors.length === 0;

    /* ── ok=false：所有推导量一律 null（界面必须能区分「0」和「算不出来」） ── */
    if (!ok) {
      rows.forEach(function (r) { r.E_i = null; });
      return {
        ok: false, errors: errors, warnings: warnings, loadRows: rows,
        totals: null, panel: null, battery: null, controller: null, inverter: null,
        rain: null, year: null, have: null, suggestions: [], derivations: {}
      };
    }

    var psh = sysV.psh, etaSys = sysV.etaSys, etaInv = sysV.etaInv, vBat = sysV.vBat,
      dod = sysV.dod, days = sysV.days, panelW = sysV.panelW, battUnitAh = sysV.battUnitAh,
      reserve = sysV.reserve, invMargin = sysV.invMargin, rainFactor = sysV.rainFactor;

    /* ── 能量收支 ── */
    var E_dc = 0, E_ac = 0, E_day = 0;
    rows.forEach(function (r) {
      var p = r.values.w, h = r.values.hours, q = r.values.qty;
      var rawWh = p * h * q;
      r.raw_wh = rawWh;
      if (r.ac) { E_ac += rawWh; r.E_i = rawWh / etaInv; }
      else { E_dc += rawWh; r.E_i = rawWh; }
      E_day += r.E_i;
    });
    var E_invLoss = E_ac / etaInv - E_ac;

    var Wp_need = E_day / (psh * etaSys);
    var n_p = ceilSafe(Wp_need / panelW);
    var Wp_inst = n_p * panelW;
    var E_gen = Wp_inst * psh * etaSys;
    var surplus = E_gen - E_day;

    var E_use = E_day * days;
    var E_nom = E_use / dod;
    var Ah_need = E_nom / vBat;
    var n_b = ceilSafe(Ah_need / battUnitAh);
    var Ah_inst = n_b * battUnitAh;

    var I_ctrl = Wp_inst / vBat * (1 + reserve);

    var P_cont = 0, P_peak = 0;
    rows.forEach(function (r) { P_cont += r.P_cont_contrib; P_peak += r.P_peak_contrib; });
    var P_rec = P_cont * invMargin;

    var E_year_kwh = Wp_inst * psh * 365 * etaSys / 1000;

    /* ── 阴雨期逐日递推 ──
       两个不同的信号，不要混成一个（本轮自查找出来的）：只报「见底」会把「正好用完」说成「没见底」：
         firstEmptyDay     = 最小的 d，使 q_{d−1} + net_d < 0 —— 这天负载被饿着了（真的不够）
         firstExhaustedDay = 最小的 d，使这天结束时 q_d ≤ 0 —— 电池用光了（含「正好用完」）
       小数天（例如 2.5 天）按比例分摊到最后一个半天：那天发电和用电都乘同一个比例，
       这样「总用电量 = E_day × days = E_use」恒成立，不会出现「容量按 2.5 天配、循环却跑 3 个整天」的口径错位。
       装机向上取整保证 E_gen ≥ E_day，因此 surplus 不会小于 0（测试里钉着这条推论）。 */
    var G_rain = Wp_inst * psh * rainFactor * etaSys;
    var rainRows = [];
    var q = E_use, firstEmptyDay = null, firstExhaustedDay = null, spill = 0;
    var fullDays = Math.floor(days + 1e-9);
    var frac = days - fullDays;
    var nDays = fullDays + (frac > 1e-9 ? 1 : 0);
    /* 余额比较必须带容差：E_use 与「逐日用电之和」在数学上相等，但浮点下会差 1e-13，
       不加容差就会出现「2.5 天里最后半个半天被判成不够用」这种纯噪声导致的结论翻转
       （对拍方也独立提了同一件事）。容差口径与 ceilSafe 一致：相对 1e-9。 */
    var tol = 1e-9 * Math.max(1, E_use);
    for (var d = 1; d <= nDays; d++) {
      var share = (d <= fullDays) ? 1 : frac;
      var drawD = E_day * share;
      var genD = G_rain * share;
      var net = genD - drawD;
      var raw = q + net;
      var qEnd;
      if (raw < -tol) { if (firstEmptyDay === null) firstEmptyDay = d; qEnd = 0; }
      else if (raw > E_use + tol) { spill += raw - E_use; qEnd = E_use; }
      else qEnd = Math.min(Math.max(raw, 0), E_use);
      if (qEnd <= 0 && firstExhaustedDay === null) firstExhaustedDay = d;
      rainRows.push({ d: d, share: share, gen: genD, draw: drawD, net: net, q: qEnd });
      q = qEnd;
    }
    var refillDays = (surplus > 0) ? (E_use - q) / surplus : null;

    /* ── 反推：手上已有的东西能带什么 ── */
    var hp = haveV.panelW, hb = haveV.battAh;
    var E_sup = hp * psh * etaSys;
    var coverage = ratio(E_sup, E_day);
    var d_have = ratio(hb * vBat * dod, E_day);
    var haveAny = (hp > 0) || (hb > 0);
    var haveObj = {
      panelW: hp, battAh: hb, E_sup: hp > 0 ? E_sup : null,
      coverage: hp > 0 ? coverage : null, d_have: hb > 0 ? d_have : null,
      usable_wh: hb > 0 ? hb * vBat * dod : null,
      verdict: '未填'
    };
    if (haveAny) {
      var panelOk = hp > 0 ? coverage >= 1 : null;
      var battOk = hb > 0 ? d_have >= days : null;
      if (panelOk === false) haveObj.verdict = '组件不够';
      else if (battOk === false) haveObj.verdict = '电池不够';
      else haveObj.verdict = '都够';
    }

    /* ── 可解释：每条推导量的算式（带用户自己的数） ── */
    var derivations = {
      E_day: '日耗电 = Σ 每行 功率 × 每天小时 × 数量（交流行再 ÷ 逆变器效率 ' + fmt(etaInv, 2) + '）= ' + fmt(E_dc, 1) + ' + ' + fmt(E_ac, 1) + ' ÷ ' + fmt(etaInv, 2) + ' = ' + fmt(E_day, 1) + ' Wh',
      E_invLoss: '逆变损失 = 交流侧用电 × (1 ÷ 逆变器效率 − 1) = ' + fmt(E_ac, 1) + ' × (1 ÷ ' + fmt(etaInv, 2) + ' − 1) = ' + fmt(E_invLoss, 1) + ' Wh',
      Wp_need: '组件需求 = 日耗电 ÷ (峰值日照小时 × 系统综合效率) = ' + fmt(E_day, 1) + ' ÷ (' + fmt(psh, 2) + ' × ' + fmt(etaSys, 2) + ') = ' + fmt(Wp_need, 1) + ' W',
      n_p: '组件块数 = 向上取整(' + fmt(Wp_need, 1) + ' ÷ ' + fmt(panelW, 0) + ') = ' + n_p + ' 块，装机 ' + fmt(Wp_inst, 0) + ' W',
      E_gen: '晴天日发电 = 装机 × 峰值日照小时 × 系统综合效率 = ' + fmt(Wp_inst, 0) + ' × ' + fmt(psh, 2) + ' × ' + fmt(etaSys, 2) + ' = ' + fmt(E_gen, 1) + ' Wh',
      E_use: '电池可用电量 = 日耗电 × 自持天数 = ' + fmt(E_day, 1) + ' × ' + fmt(days, 1) + ' = ' + fmt(E_use, 1) + ' Wh',
      E_nom: '电池标称电量 = 可用电量 ÷ 放电深度 = ' + fmt(E_use, 1) + ' ÷ ' + fmt(dod, 2) + ' = ' + fmt(E_nom, 1) + ' Wh',
      Ah_need: '电池容量 = 标称电量 ÷ 电压 = ' + fmt(E_nom, 1) + ' ÷ ' + fmtV(vBat) + ' = ' + fmt(Ah_need, 1) + ' Ah，凑成 ' + n_b + ' 块 × ' + fmt(battUnitAh, 0) + ' Ah = ' + fmt(Ah_inst, 0) + ' Ah',
      I_ctrl: '控制器电流 = 装机 ÷ 电压 × (1 + 余量) = ' + fmt(Wp_inst, 0) + ' ÷ ' + fmtV(vBat) + ' × (1 + ' + fmt(reserve, 2) + ') = ' + fmt(I_ctrl, 1) + ' A',
      P_rec: '逆变器连续功率 = Σ 要同时开的交流负载 = ' + fmt(P_cont, 0) + ' W，乘余量 ' + fmt(invMargin, 2) + ' 倍 = ' + fmt(P_rec, 0) + ' W；峰值 = Σ 功率 × 数量 × 启动倍率 = ' + fmt(P_peak, 0) + ' W'
    };

    /* ── 建议（每条都能真的作用到输入） ── */
    var suggestions = buildSuggestions({
      state: state, rows: rows, sysV: sysV, E_day: E_day, E_dc: E_dc, E_ac: E_ac,
      Wp_need: Wp_need, n_p: n_p, Wp_inst: Wp_inst, I_ctrl: I_ctrl, P_cont: P_cont, P_peak: P_peak,
      Ah_need: Ah_need, n_b: n_b, have: haveObj, days: days, vBat: vBat, panelW: panelW,
      battUnitAh: battUnitAh, psh: psh, etaSys: etaSys, etaInv: etaInv, dod: dod, surplus: surplus
    });

    return {
      ok: true, errors: [], warnings: warnings, loadRows: rows,
      input: {
        psh: psh, etaSys: etaSys, etaInv: etaInv, vBat: vBat, dod: dod, days: days,
        panelW: panelW, battUnitAh: battUnitAh, reserve: reserve, invMargin: invMargin, rainFactor: rainFactor
      },
      totals: {
        E_day: E_day, E_dc: E_dc, E_ac: E_ac, E_invLoss: E_invLoss,
        raw_ac: E_ac, dc_share: ratio(E_dc, E_day), ac_share: ratio(E_ac / etaInv, E_day)
      },
      panel: {
        need: Wp_need, unit: panelW, count: n_p, installed: Wp_inst,
        genDay: E_gen, surplus: surplus, ceilGap: Wp_inst - Wp_need,
        coverRatio: ratio(E_gen, E_day)
      },
      battery: {
        useWh: E_use, nomWh: E_nom, ahNeed: Ah_need, unit: battUnitAh,
        count: n_b, installedAh: Ah_inst, installedWh: Ah_inst * vBat,
        ceilGap: Ah_inst - Ah_need, usableWh: Ah_inst * vBat * dod
      },
      controller: { amps: I_ctrl, reserve: reserve, mppt: true, perPanel: panelW / vBat * (1 + reserve) },
      inverter: { cont: P_cont, rec: P_rec, peak: P_peak, margin: invMargin },
      rain: {
        rows: rainRows, firstEmptyDay: firstEmptyDay, firstExhaustedDay: firstExhaustedDay,
        refillDays: refillDays, spill: spill, factor: rainFactor, genPerDay: G_rain, days: days,
        endQ: rainRows.length ? rainRows[rainRows.length - 1].q : E_use
      },
      year: { kwh: E_year_kwh },
      have: haveObj,
      suggestions: suggestions,
      derivations: derivations
    };
  }

  function buildSuggestions(ctx) {
    var out = [];
    var rows = ctx.rows, sysV = ctx.sysV;

    /* 1) 自持天数 +1 */
    if (ctx.days < 30) {
      var addAh = ctx.E_day / sysV.vBat / sysV.dod;
      out.push({
        id: 'days+1', path: 'sys.days', kind: 'sys', value: String(ctx.days + 1),
        title: '自持天数改成 ' + fmtDays(ctx.days + 1) + ' 天',
        why: '阴雨天多备一天，电池要多 ' + fmt(addAh, 1) + ' Ah，现在配的是 ' + fmt(ctx.Ah_need, 1) + ' Ah。'
      });
    }
    /* 2) 12 V → 24 V（控制器电流或逆变器功率吃紧时） */
    if (ctx.vBat === 12 && (ctx.I_ctrl > 60 || ctx.P_cont > 1000)) {
      out.push({
        id: 'vbat24', path: 'sys.vBat', kind: 'sys', value: '24',
        title: '把系统电压换成 24 V',
        why: '同样的功率，24 V 下控制器电流从 ' + fmt(ctx.I_ctrl, 1) + ' A 降到 ' + fmt(ctx.Wp_inst / 24 * (1 + sysV.reserve), 1) + ' A，电池 Ah 数也减半（Wh 不变）。'
      });
    }
    /* 3) 换更大的单块组件（块数能降下来才提） */
    var unitCands = [100, 150, 200, 250, 300, 400, 450, 500, 550, 600, 700];
    for (var u = 0; u < unitCands.length; u++) {
      var cand = unitCands[u];
      if (cand <= ctx.panelW) continue;
      var cn = ceilSafe(ctx.Wp_need / cand);
      if (cn < ctx.n_p) {
        out.push({
          id: 'panelUnit', path: 'sys.panelW', kind: 'sys', value: String(cand),
          title: '单块组件换成 ' + cand + ' W',
          why: '装机要到 ' + fmt(ctx.Wp_need, 1) + ' W：' + ctx.n_p + ' 块 × ' + fmt(ctx.panelW, 0) + ' W 是 ' + fmt(ctx.Wp_inst, 0) + ' W；换成 ' + cand + ' W 只要 ' + cn + ' 块 = ' + fmt(cn * cand, 0) + ' W。'
        });
        break;
      }
    }
    /* 4) 把某个同时开的交流负载标成不同时开（降逆变器连续功率） */
    var acSim = rows.filter(function (r) { return r.ok && r.ac && r.simultaneous && r.P_cont_contrib > 0; });
    if (acSim.length >= 2) {
      acSim.sort(function (a, b) { return b.P_cont_contrib - a.P_cont_contrib; });
      var big = acSim[0];
      var newCont = ctx.P_cont - big.P_cont_contrib;
      out.push({
        id: 'unsim', kind: 'load', loadIndex: big.index, field: 'simultaneous', value: false,
        title: '把「' + big.label + '」标成不同时开',
        why: '逆变器连续功率从 ' + fmt(ctx.P_cont, 0) + ' W 降到 ' + fmt(newCont, 0) + ' W（建议额定随之从 ' + fmt(ctx.P_cont * sysV.invMargin, 0) + ' W 降到 ' + fmt(newCont * sysV.invMargin, 0) + ' W）。'
      });
    }
    /* 5) 把耗时较长的交流负载假设成直流（省掉逆变损失） */
    var acLong = rows.filter(function (r) { return r.ok && r.ac && r.values.hours >= 2 && r.values.w <= 300; });
    if (acLong.length) {
      acLong.sort(function (a, b) { return b.raw_wh - a.raw_wh; });
      var r5 = acLong[0];
      var saveWh = r5.raw_wh / sysV.etaInv - r5.raw_wh;
      out.push({
        id: 'ac2dc', kind: 'load', loadIndex: r5.index, field: 'ac', value: false,
        title: '假设「' + r5.label + '」能改直流供电',
        why: '这行每天有 ' + fmt(saveWh, 1) + ' Wh 花在逆变损失上（' + fmt(r5.E_i, 1) + ' → ' + fmt(r5.raw_wh, 1) + ' Wh）。能不能改直流取决于设备本身，这里只是把差别算给你看。'
      });
    }
    /* 6) 已有设备不够时的下一步 */
    if (ctx.have.verdict === '组件不够') {
      out.push({
        id: 'havePanel', path: 'sys.panelW', kind: 'sys', value: String(Math.max(100, Math.ceil((ctx.E_day / (ctx.psh * ctx.etaSys)) / 10) * 10)),
        title: '已有组件不够：把「单块组件」按需求填成 ' + Math.max(100, Math.ceil((ctx.E_day / (ctx.psh * ctx.etaSys)) / 10) * 10) + ' W',
        why: '你手上是 ' + fmt(ctx.have.panelW, 0) + ' W，一天只能出 ' + fmt(ctx.have.E_sup, 1) + ' Wh，而负载要 ' + fmt(ctx.E_day, 1) + ' Wh。'
      });
    } else if (ctx.have.verdict === '电池不够') {
      var needAh = ctx.E_day * ctx.days / sysV.dod / sysV.vBat;
      out.push({
        id: 'haveBatt', path: 'have.battAh', kind: 'have', value: String(Math.ceil(needAh / 10) * 10),
        title: '已有电池不够：要撑 ' + fmtDays(ctx.days) + ' 天得有 ' + fmt(needAh, 1) + ' Ah',
        why: '你手上是 ' + fmt(ctx.have.battAh, 0) + ' Ah，只够撑 ' + fmt(ctx.have.d_have, 2) + ' 天。'
      });
    } else if (ctx.have.verdict === '都够' && ctx.surplus > 0) {
      out.push({
        id: 'haveMore', kind: 'load', loadIndex: 0, field: 'hours', value: String(Number(rows[0].values.hours) + 1),
        title: '手上这套够用：把「' + rows[0].label + '」每天多用 1 小时试试看',
        why: '晴天发电 ' + fmt(ctx.Wp_inst * ctx.psh * ctx.etaSys, 1) + ' Wh 比用电多 ' + fmt(ctx.surplus, 1) + ' Wh，还有余量可以加负载。'
      });
    }
    return out;
  }

  /* ══════════════════ 5. 导出（纯字符串，便于测试） ══════════════════ */
  /* 阴雨期结论的唯一去处：页面、CSV、Markdown 都调它，避免三处各写一套说法 */
  function rainVerdict(r) {
    if (!r || !r.ok) return { code: 'na', text: '—', detail: '输入有误，没有结果。' };
    var rain = r.rain;
    if (rain.days === 0) return { code: 'none', text: '不用电池', detail: '自持天数填的是 0，没有阴雨期。' };
    if (rain.firstEmptyDay !== null) {
      return {
        code: 'short', text: '第 ' + rain.firstEmptyDay + ' 天就不够用',
        detail: '第 ' + rain.firstEmptyDay + ' 天结束时电量撑不住当天的用电，负载会被饿着。'
      };
    }
    if (rain.firstExhaustedDay !== null) {
      return {
        code: 'exact', text: '第 ' + rain.firstExhaustedDay + ' 天正好用完',
        detail: '撑满了 ' + fmtDays(rain.days) + ' 天，最后一天结束时电池正好放到 0，一点余量都没有。'
      };
    }
    return {
      code: 'ok', text: '撑过 ' + fmtDays(rain.days) + ' 天还剩 ' + fmt(rain.endQ, 1) + ' Wh',
      detail: '阴雨期结束还剩 ' + fmtPct(ratio(rain.endQ, r.battery.useWh)) + ' 的可用电量。'
    };
  }
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(state, r, meta) {
    var L = [];
    L.push(['项目', '值', '单位', '说明'].map(csvCell).join(','));
    var m = meta || {};
    L.push(['作品', SPEC.title, '', ''].map(csvCell).join(','));
    L.push(['导出时间', m.exportedAt || '', '', '本行为导出时刻'].map(csvCell).join(','));
    if (!r.ok) {
      L.push(['状态', '输入有误，没有结果', '', r.errors.map(function (e) { return e.message; }).join('；')].map(csvCell).join(','));
      return L.join('\n') + '\n';
    }
    L.push(['日耗电', fmt(r.totals.E_day, 1), 'Wh', '母线侧：交流负载已除以逆变器效率'].map(csvCell).join(','));
    L.push(['其中直流用电', fmt(r.totals.E_dc, 1), 'Wh', ''].map(csvCell).join(','));
    L.push(['其中交流用电', fmt(r.totals.E_ac, 1), 'Wh', '交流侧原始值'].map(csvCell).join(','));
    L.push(['其中逆变损失', fmt(r.totals.E_invLoss, 1), 'Wh', ''].map(csvCell).join(','));
    L.push(['组件需求', fmt(r.panel.need, 1), 'W', '日耗电 ÷ (日照 × 系统效率)'].map(csvCell).join(','));
    L.push(['组件块数', r.panel.count, '块', '单块 ' + fmt(r.panel.unit, 0) + ' W'].map(csvCell).join(','));
    L.push(['组件装机', fmt(r.panel.installed, 0), 'W', ''].map(csvCell).join(','));
    L.push(['晴天日发电', fmt(r.panel.genDay, 1), 'Wh', ''].map(csvCell).join(','));
    L.push(['晴天日余量', fmt(r.panel.surplus, 1), 'Wh', '发电 − 用电'].map(csvCell).join(','));
    L.push(['电池可用电量', fmt(r.battery.useWh, 1), 'Wh', '日耗电 × 自持天数'].map(csvCell).join(','));
    L.push(['电池标称电量', fmt(r.battery.nomWh, 1), 'Wh', '可用 ÷ 放电深度'].map(csvCell).join(','));
    L.push(['电池容量需求', fmt(r.battery.ahNeed, 1), 'Ah', ''].map(csvCell).join(','));
    L.push(['电池块数', r.battery.count, '块', '单块 ' + fmt(r.battery.unit, 0) + ' Ah'].map(csvCell).join(','));
    L.push(['电池装机', fmt(r.battery.installedAh, 0), 'Ah', '@ ' + fmtV(r.input.vBat) + ' V'].map(csvCell).join(','));
    L.push(['控制器电流', fmt(r.controller.amps, 1), 'A', '装机 ÷ 电压 × (1 + 余量 ' + fmt(r.controller.reserve, 2) + ')'].map(csvCell).join(','));
    L.push(['逆变器连续功率', fmt(r.inverter.rec, 0), 'W', '同时开的交流负载 ' + fmt(r.inverter.cont, 0) + ' W × ' + fmt(r.inverter.margin, 2)].map(csvCell).join(','));
    L.push(['逆变器峰值需求', fmt(r.inverter.peak, 0), 'W', ''].map(csvCell).join(','));
    var rv = rainVerdict(r);
    L.push(['阴雨期', rv.text, '天', rv.detail + '共 ' + fmtDays(r.rain.days) + ' 天，阴雨天日照系数 ' + fmt(r.rain.factor, 2)].map(csvCell).join(','));
    L.push(['阴雨期结束余量', fmt(r.rain.endQ, 1), 'Wh', '可用电量一共 ' + fmt(r.battery.useWh, 1) + ' Wh'].map(csvCell).join(','));
    L.push(['阴雨期弃电', fmt(r.rain.spill, 1), 'Wh', '充满后存不下的部分'].map(csvCell).join(','));
    L.push(['晴天回充天数', r.rain.refillDays === null ? '—' : fmt(r.rain.refillDays, 2), '天', '余量不为正时为 —'].map(csvCell).join(','));
    L.push(['年发电量估算', fmt(r.year.kwh, 1), 'kWh', '假设全年每天都等于你填的日照'].map(csvCell).join(','));
    if (r.have.verdict !== '未填') {
      L.push(['已有设备判定', r.have.verdict, '', '组件 ' + fmt(r.have.panelW, 0) + ' W / 电池 ' + fmt(r.have.battAh, 0) + ' Ah'].map(csvCell).join(','));
      if (isNum(r.have.coverage)) L.push(['已有组件覆盖率', fmtPct(r.have.coverage), '', '可供电量 ' + fmt(r.have.E_sup, 1) + ' Wh ÷ 日耗电 ' + fmt(r.totals.E_day, 1) + ' Wh'].map(csvCell).join(','));
      if (isNum(r.have.d_have)) L.push(['已有电池自持', fmt(r.have.d_have, 2), '天', '可用 ' + fmt(r.have.usable_wh, 1) + ' Wh ÷ 日耗电'].map(csvCell).join(','));
    }
    L.push('', '');
    L.push(['负载清单', '功率 W', '每天 h', '数量', '供电', '同时开', '启动倍率', '这行一天吃多少 Wh'].map(csvCell).join(','));
    r.loadRows.forEach(function (x) {
      L.push([x.label, fmt(x.values.w, 1), fmt(x.values.hours, 2), x.values.qty, x.ac ? '交流' : '直流',
        x.simultaneous ? '是' : '否', fmt(x.values.surge, 2), fmt(x.E_i, 1)].map(csvCell).join(','));
    });
    return L.join('\n') + '\n';
  }

  function toMarkdown(state, r, meta) {
    var L = [];
    L.push('# ' + SPEC.title + ' · 配置单');
    L.push('');
    if (meta && meta.exportedAt) L.push('导出时间：' + meta.exportedAt);
    L.push('');
    if (!r.ok) {
      L.push('**输入有误，没有结果。**');
      r.errors.forEach(function (e) { L.push('- ' + e.message); });
      return L.join('\n') + '\n';
    }
    L.push('## 结论');
    L.push('');
    L.push('| 部件 | 规格 | 说明 |');
    L.push('|---|---|---|');
    L.push('| 组件 | ≥ ' + fmt(r.panel.need, 1) + ' W | 照 ' + r.panel.count + ' 块 × ' + fmt(r.panel.unit, 0) + ' W 买，装机 ' + fmt(r.panel.installed, 0) + ' W |');
    L.push('| 电池 | ≥ ' + fmt(r.battery.ahNeed, 1) + ' Ah @ ' + fmtV(r.input.vBat) + ' V | 照 ' + r.battery.count + ' 块 × ' + fmt(r.battery.unit, 0) + ' Ah 买，装机 ' + fmt(r.battery.installedAh, 0) + ' Ah |');
    L.push('| 控制器 | ≥ ' + fmt(r.controller.amps, 1) + ' A | 装机 ÷ 电压，已含 ' + fmtPct(r.controller.reserve, 0) + ' 余量 |');
    L.push('| 逆变器 | ≥ ' + fmt(r.inverter.rec, 0) + ' W 连续 | 峰值能力要 ≥ ' + fmt(r.inverter.peak, 0) + ' W |');
    L.push('');
    L.push('## 账');
    L.push('');
    L.push('| 项目 | 值 |');
    L.push('|---|---|');
    L.push('| 日耗电（母线侧） | ' + fmt(r.totals.E_day, 1) + ' Wh |');
    L.push('| 　直流部分 | ' + fmt(r.totals.E_dc, 1) + ' Wh |');
    L.push('| 　交流部分（含逆变损失 ' + fmt(r.totals.E_invLoss, 1) + ' Wh） | ' + fmt(r.totals.E_ac / r.input.etaInv, 1) + ' Wh |');
    L.push('| 晴天日发电 | ' + fmt(r.panel.genDay, 1) + ' Wh |');
    L.push('| 晴天日余量 | ' + fmt(r.panel.surplus, 1) + ' Wh |');
    L.push('| 阴雨 ' + fmtDays(r.rain.days) + ' 天结果 | ' + rainVerdict(r).text + ' |');
    L.push('| 年发电量估算 | ' + fmt(r.year.kwh, 1) + ' kWh（假设全年每天都等于你填的日照） |');
    L.push('');
    L.push('## 负载清单');
    L.push('');
    L.push('| 负载 | 功率 W | 每天 h | 数量 | 供电 | 同时开 | 这行一天吃多少 Wh |');
    L.push('|---|---|---|---|---|---|---|');
    r.loadRows.forEach(function (x) {
      L.push('| ' + x.label + ' | ' + fmt(x.values.w, 1) + ' | ' + fmt(x.values.hours, 2) + ' | ' + x.values.qty + ' | '
        + (x.ac ? '交流' : '直流') + ' | ' + (x.simultaneous ? '是' : '否') + ' | ' + fmt(x.E_i, 1) + ' |');
    });
    L.push('');
    L.push('## 阴雨天那几天');
    L.push('');
    L.push('| 第几天 | 当天发电 Wh | 当天用电 Wh | 净额 Wh | 这天结束时电池还剩 Wh |');
    L.push('|---|---|---|---|---|');
    r.rain.rows.forEach(function (x) {
      L.push('| ' + x.d + ' | ' + fmt(x.gen, 1) + ' | ' + fmt(x.draw, 1) + ' | ' + fmt(x.net, 1) + ' | ' + fmt(x.q, 1) + ' |');
    });
    if (!r.rain.rows.length) L.push('| — | — | — | — | 自持天数填的是 0，没有阴雨期 |');
    L.push('');
    if (r.have.verdict !== '未填') {
      L.push('## 手上已有的东西');
      L.push('');
      L.push('- 判定：**' + r.have.verdict + '**');
      if (isNum(r.have.coverage)) L.push('- 已有组件 ' + fmt(r.have.panelW, 0) + ' W → 一天能出 ' + fmt(r.have.E_sup, 1) + ' Wh，正好是日耗电的 ' + fmtPct(r.have.coverage));
      if (isNum(r.have.d_have)) L.push('- 已有电池 ' + fmt(r.have.battAh, 0) + ' Ah → 可用 ' + fmt(r.have.usable_wh, 1) + ' Wh，能撑 ' + fmt(r.have.d_have, 2) + ' 天');
      L.push('');
    }
    L.push('> 口径：能量都在电池母线侧；系统综合效率 ' + fmt(r.input.etaSys, 2) + '（不含逆变器，逆变器按 ' + fmt(r.input.etaInv, 2) + ' 单独算）；峰值日照小时 ' + fmt(r.input.psh, 2) + ' h/天由使用者填写。');
    L.push('> 这是按日均线性模型的估算，不替代专业设计；不查任何地区的真实日照数据。');
    return L.join('\n') + '\n';
  }

  function toJSON(state, r, meta) {
    return JSON.stringify({
      app: SPEC.title, version: SPEC.version,
      exportedAt: (meta && meta.exportedAt) || '',
      input: state, result: r
    }, null, 2) + '\n';
  }

  function summary(r) {
    if (!r.ok) return { ok: false, lines: ['输入有误：' + r.errors.length + ' 处'], errors: r.errors };
    return {
      ok: true,
      lines: [
        '组件 ≥ ' + fmt(r.panel.need, 1) + ' W（' + r.panel.count + ' × ' + fmt(r.panel.unit, 0) + ' W）',
        '电池 ≥ ' + fmt(r.battery.ahNeed, 1) + ' Ah @ ' + fmt(r.input.vBat, 2) + ' V（' + r.battery.count + ' × ' + fmt(r.battery.unit, 0) + ' Ah）',
        '控制器 ≥ ' + fmt(r.controller.amps, 1) + ' A',
        '逆变器 ≥ ' + fmt(r.inverter.rec, 0) + ' W 连续 / 峰值 ≥ ' + fmt(r.inverter.peak, 0) + ' W'
      ]
    };
  }

  /* ── 建议应用到状态上（UI 与测试共用同一份实现，不各写一遍） ── */
  function applySuggestion(state, s) {
    var next = cloneState(state);
    if (!s) return next;
    if (s.kind === 'sys') { next.sys[s.path.replace(/^sys\./, '')] = String(s.value); }
    else if (s.kind === 'have') { next.have[s.path.replace(/^have\./, '')] = String(s.value); }
    else if (s.kind === 'load') {
      var i = s.loadIndex;
      if (next.loads[i]) {
        if (s.field === 'ac' || s.field === 'simultaneous') next.loads[i][s.field] = !!s.value;
        else next.loads[i][s.field] = String(s.value);
      }
    }
    return next;
  }

  var API = {
    SPEC: SPEC, PRESETS: PRESETS, defaultState: defaultState, cloneState: cloneState,
    compute: compute, parseField: parseField, applySuggestion: applySuggestion,
    fmt: fmt, fmtInt: fmtInt, fmtV: fmtV, fmtDays: fmtDays, fmtPct: fmtPct, roundDp: roundDp, ceilSafe: ceilSafe,
    rainVerdict: rainVerdict,
    toCSV: toCSV, toMarkdown: toMarkdown, toJSON: toJSON, summary: summary,
    labelOf: labelOf
  };
  global.AppCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
