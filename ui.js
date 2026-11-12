/* 配一套自己发的电 · 界面层（ui.js）
 * 纪律（来自 11-05 与 11-13 两次实测的坑）：
 *   1) 数字输入一律 type=text + inputmode，state.raw 存用户原文 —— 不让浏览器静默吞掉 abc；
 *   2) 用户打字时只重算输出区，绝不重建正在编辑的输入框（否则光标会跳、内容会被盖回去）；
 *   3) 「点一下就改输入」的建议：先改 state.raw，再 syncInputs()，最后重算 —— 顺序错了就会出现「点了没反应」。
 */
(function () {
  'use strict';
  var A = window.AppCore;
  var LS_KEY = 'offgrid-kit-v1-v1';
  var state = null, result = null, errMap = {}, statusMsg = '输入存在本机';

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function setText(id, t) { var e = $(id); if (e) e.textContent = (t === undefined || t === null) ? '' : String(t); }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }
  function nowText() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ══════════ 状态 ══════════ */
  function normalize(s) {
    var n = A.defaultState();
    if (s && Array.isArray(s.loads)) {
      n.loads = s.loads.slice(0, A.SPEC.maxLoads).map(function (l) {
        return {
          name: l && l.name !== undefined ? String(l.name) : '',
          w: l && l.w !== undefined ? String(l.w) : '',
          hours: l && l.hours !== undefined ? String(l.hours) : '',
          qty: l && l.qty !== undefined ? String(l.qty) : '',
          ac: !!(l && l.ac),
          simultaneous: l && l.simultaneous !== undefined ? !!l.simultaneous : true,
          surge: l && l.surge !== undefined ? String(l.surge) : '1'
        };
      });
    }
    if (s && s.sys) A.SPEC.sys.forEach(function (f) { if (s.sys[f.key] !== undefined) n.sys[f.key] = String(s.sys[f.key]); });
    if (s && s.have) A.SPEC.have.forEach(function (f) { if (s.have[f.key] !== undefined) n.have[f.key] = String(s.have[f.key]); });
    return n;
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.loads) { statusMsg = '已恢复上次的输入'; return normalize(s); } }
    } catch (e) { statusMsg = '这台设备上存不了输入（浏览器禁用了本地存储）'; }
    return A.defaultState();
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { statusMsg = '这台设备上存不了输入（浏览器禁用了本地存储）'; }
    setText('saveState', statusMsg);
  }

  /* ══════════ 输入区渲染 ══════════ */
  var SYS_HINT = {
    psh: '你那儿一天折合几个「满发小时」。站点相关，要你自己填；本页不查任何地区数据。',
    etaSys: '从组件到电池的综合损失：温度、灰尘、控制器、线损、电池往返。不含逆变器（那项单独填）。',
    etaInv: '交流负载要经过逆变器，这里填它的效率。只影响标了「交流」的行。',
    vBat: '整套电池的标称电压：12 / 24 / 48 V 都可以填。',
    dod: '允许多深放电。填 0.8 就是只打算用掉 80% 的容量。',
    days: '阴雨天不出太阳时，希望还能撑几天。填 0 就是不要电池。',
    panelW: '你打算买的那种板的单块功率。结论里的块数是按它凑整的。',
    battUnitAh: '你打算买的那种电池的单块容量。结论里的块数是按它凑整的。',
    reserve: '控制器电流留多少余量。这是显示层面的设计选择，不是标准。',
    invMargin: '逆变器额定功率比「同时开的负载」大多少倍。同样是设计选择。',
    rainFactor: '阴雨天发电相对晴天的比例。填 0.2 就是「阴雨天只发晴天的两成」。'
  };
  var HAVE_HINT = { panelW: '已有组件总功率；没有就留 0。', battAh: '已有电池总容量；没有就留 0。' };

  function fieldEl(kind, key, value, hint, spec) {
    var f = mk('div', 'f');
    var lb = mk('label', 'lb', spec.label + (spec.unit ? '（' + spec.unit + '）' : ''));
    lb.setAttribute('for', 'f_' + kind + '_' + key);
    var inp = mk('input');
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.id = 'f_' + kind + '_' + key;
    inp.value = value;
    inp.setAttribute('data-kind', kind);
    inp.setAttribute('data-key', key);
    f.appendChild(lb); f.appendChild(inp);
    if (hint) { var h = mk('div', 'hint', hint); h.id = 'h_' + kind + '_' + key; f.appendChild(h); }
    return f;
  }
  function renderSys() {
    var g = $('sysGrid');
    g.innerHTML = '';
    A.SPEC.sys.forEach(function (spec) {
      g.appendChild(fieldEl('sys', spec.key, state.sys[spec.key], SYS_HINT[spec.key], spec));
    });
    setText('sysTail', '峰值日照 ' + state.sys.psh + ' h/天 · ' + state.sys.vBat + ' V · 自持 ' + state.sys.days + ' 天');
  }
  /* 注意：这个函数原来也叫 renderHave，和下面「反推结论区」的那个重名 ——
     JS 的函数声明会互相覆盖，结果 #haveGrid 永远是空的、整个「手上已经有东西？」输入区都不渲染。
     浏览器验收（G1「参数区 11 个字段」/G3 have 投毒）才抓到；核心测试抓不到，因为内核是好的。 */
  function renderHaveInputs() {
    var g = $('haveGrid');
    g.innerHTML = '';
    A.SPEC.have.forEach(function (spec) {
      g.appendChild(fieldEl('have', spec.key, state.have[spec.key], HAVE_HINT[spec.key], spec));
    });
  }

  var LOAD_COLS = A.SPEC.load;
  function renderLoads() {
    var tb = $('loadBody');
    tb.innerHTML = '';
    state.loads.forEach(function (l, i) {
      var tr = mk('tr');
      tr.setAttribute('data-row', String(i));
      /* 名称 */
      var tdN = mk('td'); tdN.setAttribute('data-label', '名称');
      var inN = mk('input', 'name'); inN.type = 'text'; inN.autocomplete = 'off';
      inN.id = 'f_load_' + i + '_name'; inN.value = l.name;
      inN.setAttribute('data-row', String(i)); inN.setAttribute('data-key', 'name');
      tdN.appendChild(inN); tr.appendChild(tdN);
      /* 功率 / 每天 / 数量 / 启动倍率 */
      LOAD_COLS.forEach(function (spec) {
        var td = mk('td');
        td.setAttribute('data-label', spec.label + (spec.unit ? ' ' + spec.unit : ''));
        var inp = mk('input');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.spellcheck = false;
        inp.id = 'f_load_' + i + '_' + spec.key; inp.value = l[spec.key];
        inp.setAttribute('data-row', String(i)); inp.setAttribute('data-key', spec.key);
        if (spec.key === 'w' || spec.key === 'hours' || spec.key === 'qty' || spec.key === 'surge') inp.setAttribute('data-num', '1');
        td.appendChild(inp); tr.appendChild(td);
      });
      /* 供电（交流 / 直流） */
      var tdA = mk('td'); tdA.setAttribute('data-label', '供电');
      var box = mk('div', 'acdc');
      [['直流', false], ['交流', true]].forEach(function (pair) {
        var b = mk('button', l.ac === pair[1] ? 'on' : '', pair[0]);
        b.type = 'button';
        b.setAttribute('data-row', String(i)); b.setAttribute('data-act', 'ac'); b.setAttribute('data-val', pair[1] ? '1' : '0');
        box.appendChild(b);
      });
      tdA.appendChild(box); tr.appendChild(tdA);
      /* 同时开 */
      var tdS = mk('td'); tdS.setAttribute('data-label', '同时开');
      var cw = mk('div', 'chk');
      var cb = mk('input'); cb.type = 'checkbox'; cb.checked = !!l.simultaneous;
      cb.id = 'f_load_' + i + '_simultaneous';
      cb.setAttribute('data-row', String(i)); cb.setAttribute('data-key', 'simultaneous');
      cw.appendChild(cb); tdS.appendChild(cw); tr.appendChild(tdS);
      /* 一天吃多少 */
      var tdE = mk('td', 'num'); tdE.setAttribute('data-label', '一天吃多少');
      var span = mk('span', 'rowE'); span.id = 'e_row_' + i; span.textContent = '—';
      tdE.appendChild(span); tr.appendChild(tdE);
      /* 删 */
      var tdX = mk('td', 'del'); tdX.setAttribute('data-label', '删除这一行');
      var bx = mk('button', 'btn x', '删掉'); bx.type = 'button';
      bx.setAttribute('data-row', String(i)); bx.setAttribute('data-act', 'del');
      bx.title = '删掉这一行';
      bx.setAttribute('aria-label', '删掉第 ' + (i + 1) + ' 行');
      tdX.appendChild(bx); tr.appendChild(tdX);
      tb.appendChild(tr);
    });
    setText('loadCount', state.loads.length + ' 行');
  }
  function renderPresets() {
    var s = $('presetSel');
    s.innerHTML = '';
    var o0 = mk('option', '', '快速试一个场景…'); o0.value = ''; s.appendChild(o0);
    A.PRESETS.forEach(function (p) {
      var o = mk('option', '', p.name); o.value = p.id; s.appendChild(o);
    });
  }

  /* 把 state 里的值写回已有输入框（只在「程序改了状态」时调用，不在打字时调用） */
  function syncInputs() {
    A.SPEC.sys.forEach(function (f) { var e = $('f_sys_' + f.key); if (e) e.value = state.sys[f.key]; });
    A.SPEC.have.forEach(function (f) { var e = $('f_have_' + f.key); if (e) e.value = state.have[f.key]; });
    state.loads.forEach(function (l, i) {
      var e;
      e = $('f_load_' + i + '_name'); if (e) e.value = l.name;
      LOAD_COLS.forEach(function (f) { e = $('f_load_' + i + '_' + f.key); if (e) e.value = l[f.key]; });
      e = $('f_load_' + i + '_simultaneous'); if (e) e.checked = !!l.simultaneous;
      var box = document.querySelector('.acdc button[data-row="' + i + '"][data-val="' + (l.ac ? '1' : '0') + '"]');
      [].forEach.call(document.querySelectorAll('.acdc button[data-row="' + i + '"]'), function (b) { b.classList.toggle('on', b === box); });
    });
    setText('sysTail', '峰值日照 ' + state.sys.psh + ' h/天 · ' + state.sys.vBat + ' V · 自持 ' + state.sys.days + ' 天');
  }

  /* ══════════ 输出区渲染 ══════════ */
  function renderErrors() {
    var bar = $('errbar'), list = $('errList');
    list.innerHTML = '';
    var errs = result.ok ? [] : result.errors;
    errMap = {};
    errs.forEach(function (e) { if (!errMap[e.field]) errMap[e.field] = { code: e.code, message: e.message }; });
    if (errs.length) {
      var seen = {}, uniq = [];
      errs.forEach(function (e) { if (!seen[e.field]) { seen[e.field] = 1; uniq.push(e); } });
      uniq.slice(0, 12).forEach(function (e) { list.appendChild(mk('li', '', e.message)); });
      setText('errCount', uniq.length);
      setText('errMore', uniq.length > 12 ? '还有 ' + (uniq.length - 12) + ' 处没有列出来；改掉上面这些就会自动重算。' : '改掉以后会自动重算，不用点任何按钮。');
      bar.classList.add('on');
    } else {
      /* 无错时**不能**直接 return：那样上一次的 .bad 标红会一直留在输入框上
         （浏览器验收 G3「改回合法：没有输入框还留着标红」抓到的就是这个）。 */
      bar.classList.remove('on');
      setText('errCount', 0);
      setText('errMore', '');
    }
    /* 标记输入框 */
    [].forEach.call(document.querySelectorAll('input[data-kind],input[data-row][data-key]'), function (inp) {
      var kind = inp.getAttribute('data-kind');
      var field;
      if (kind) field = kind + '.' + inp.getAttribute('data-key');
      else {
        var r = inp.getAttribute('data-row'), k = inp.getAttribute('data-key');
        field = (k === 'name' || k === 'simultaneous') ? null : 'loads[' + r + '].' + k;
      }
      var bad = field && errMap[field];
      inp.classList.toggle('bad', !!bad);
      var h = field && $('h_' + kind + '_' + inp.getAttribute('data-key'));
      if (h && kind) {
        if (bad) { h.className = 'hint bad'; h.textContent = bad.message; }
        else { h.className = 'hint'; h.textContent = (kind === 'sys' ? SYS_HINT : HAVE_HINT)[inp.getAttribute('data-key')] || ''; }
      }
    });
  }

  function renderConclusion() {
    var r = result;
    if (!r.ok) {
      setText('cLead', '输入还有 ' + r.errors.length + ' 处问题，先把它们改掉 —— 现在给不出结论。');
      ['cPanel', 'cBatt', 'cCtrl', 'cInv', 'cDay', 'cGen', 'cRain', 'cYear',
        'cPanelD', 'cBattD', 'cCtrlD', 'cInvD'].forEach(function (id) { setText(id, '—'); });
      return;
    }
    var rows = r.loadRows.length;
    setText('cLead', '按你填的 ' + rows + ' 行负载，一天要用 ' + A.fmt(r.totals.E_day, 1) + ' Wh。下面是照着买的最小规格：');
    var q = function (id, v, unit, d) {
      var e = $(id);
      e.innerHTML = '';
      e.appendChild(document.createTextNode(v));
      if (unit) { var s = mk('small', '', unit); e.appendChild(s); }
      setText(id + 'D', d);
    };
    q('cPanel', A.fmt(r.panel.need, 1), 'W', r.panel.count + ' × ' + A.fmt(r.panel.unit, 0) + ' W，装机 ' + A.fmt(r.panel.installed, 0) + ' W');
    q('cBatt', A.fmt(r.battery.ahNeed, 1), 'Ah', r.battery.count + ' × ' + A.fmt(r.battery.unit, 0) + ' Ah @ ' + A.fmtV(r.input.vBat) + ' V');
    q('cCtrl', A.fmt(r.controller.amps, 1), 'A', '装机 ÷ ' + A.fmtV(r.input.vBat) + ' V，含 ' + A.fmt(r.controller.reserve * 100, 0) + '% 余量');
    q('cInv', A.fmt(r.inverter.rec, 0), 'W', '连续；峰值能力要 ≥ ' + A.fmt(r.inverter.peak, 0) + ' W');
    setText('cDay', '日耗电 ' + A.fmt(r.totals.E_day, 1) + ' Wh（直流 ' + A.fmt(r.totals.E_dc, 1) + ' ＋ 交流含损 ' + A.fmt(r.totals.E_ac / r.input.etaInv, 1) + '）');
    setText('cGen', '晴天日发电 ' + A.fmt(r.panel.genDay, 1) + ' Wh，余 ' + A.fmt(r.panel.surplus, 1) + ' Wh');
    setText('cRain', '阴雨天：' + A.rainVerdict(r).text);
    setText('cYear', '年发电约 ' + A.fmt(r.year.kwh, 1) + ' kWh（假设全年都按你填的日照）');
  }

  function renderRowEnergy() {
    state.loads.forEach(function (l, i) {
      var e = $('e_row_' + i);
      if (!e) return;
      var row = result.loadRows[i];
      if (!row || row.E_i === null || row.E_i === undefined) {
        e.className = 'rowE na';
        var bits = [];
        if (row && row.errors.length) row.errors.forEach(function (x) { bits.push(x.message); });
        e.textContent = bits.length ? '这行填得不对' : '—';
        e.title = bits.join('；');
      } else {
        e.className = 'rowE';
        e.textContent = A.fmt(row.E_i, 1) + ' Wh';
        e.title = row.ac
          ? A.fmt(row.raw_wh, 1) + ' Wh（交流侧）÷ ' + A.fmt(result.input.etaInv, 2) + ' = ' + A.fmt(row.E_i, 1) + ' Wh'
          : A.fmt(row.values.w, 1) + ' W × ' + A.fmt(row.values.hours, 2) + ' h × ' + row.values.qty + ' = ' + A.fmt(row.E_i, 1) + ' Wh';
      }
    });
    setText('loadTotal', result.ok ? A.fmt(result.totals.E_day, 1) + ' Wh' : '—');
  }

  function renderSheet() {
    var tb = $('sheetBody');
    tb.innerHTML = '';
    if (!result.ok) {
      var tr = mk('tr'); var td = mk('td', '', '输入有误，先把上面的问题改掉。');
      td.colSpan = 4; tr.appendChild(td); tb.appendChild(tr);
      setText('sheetTail', '');
      return;
    }
    var r = result;
    var rows = [
      ['组件', A.fmt(r.panel.need, 1) + ' W', r.panel.count + ' 块 × ' + A.fmt(r.panel.unit, 0) + ' W',
        '日耗电 ' + A.fmt(r.totals.E_day, 1) + ' Wh ÷ (' + A.fmt(r.input.psh, 2) + ' h/天 × ' + A.fmt(r.input.etaSys, 2) + ') = ' + A.fmt(r.panel.need, 1) + ' W，向上取整到整块 ⇒ 装机 ' + A.fmt(r.panel.installed, 0) + ' W'],
      ['电池', A.fmt(r.battery.ahNeed, 1) + ' Ah @ ' + A.fmtV(r.input.vBat) + ' V', r.battery.count + ' 块 × ' + A.fmt(r.battery.unit, 0) + ' Ah',
        '可用 ' + A.fmt(r.battery.useWh, 1) + ' Wh = 日耗电 × ' + A.fmt(r.input.days, 1) + ' 天；标称 ' + A.fmt(r.battery.nomWh, 1) + ' Wh = 可用 ÷ ' + A.fmt(r.input.dod, 2) + ' 放电深度；÷ ' + A.fmtV(r.input.vBat) + ' V = ' + A.fmt(r.battery.ahNeed, 1) + ' Ah'],
      ['控制器', A.fmt(r.controller.amps, 1) + ' A', '1 台',
        '装机 ' + A.fmt(r.panel.installed, 0) + ' W ÷ ' + A.fmtV(r.input.vBat) + ' V × (1 + ' + A.fmt(r.input.reserve, 2) + ' 余量) = ' + A.fmt(r.controller.amps, 1) + ' A（MPPT 输出侧口径）'],
      ['逆变器', A.fmt(r.inverter.rec, 0) + ' W 连续', r.inverter.cont > 0 ? '峰值 ≥ ' + A.fmt(r.inverter.peak, 0) + ' W' : '不需要',
        r.inverter.cont > 0
          ? '要同时开的交流负载 ' + A.fmt(r.inverter.cont, 0) + ' W × ' + A.fmt(r.inverter.margin, 2) + ' 余量 = ' + A.fmt(r.inverter.rec, 0) + ' W；峰值按启动倍率算 = ' + A.fmt(r.inverter.peak, 0) + ' W'
          : '清单里没有交流负载，可以不用逆变器。']
    ];
    rows.forEach(function (x) {
      var tr = mk('tr');
      [['part', '部件'], ['spec', '规格'], ['cnt', '数量'], ['why', '怎么来的']].forEach(function (p, i) {
        var td = mk('td', p[0], x[i]);
        td.setAttribute('data-label', p[1]);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    setText('sheetTail', '共 4 项');
  }

  function renderRain() {
    var box = $('rainBox');
    box.innerHTML = '';
    setText('rainPct', A.fmt(result.ok ? result.input.rainFactor * 100 : 20, 0) + '%');
    if (!result.ok) { setText('rainTail', '—'); setText('rainVerdict', '输入有误，先改掉上面的问题。'); return; }
    var r = result.rain;
    setText('rainTail', r.days + ' 天 · 阴雨天日照系数 ' + A.fmt(r.factor, 2));
    if (!r.days) {
      box.appendChild(mk('div', 'rv', '自持天数填的是 0，不需要电池，也就没有阴雨期。'));
      setText('rainVerdict', '');
      return;
    }
    r.rows.forEach(function (x) {
      var cls = 'day';
      if (r.firstEmptyDay !== null && x.d >= r.firstEmptyDay) cls += ' short';
      else if (x.q <= 0) cls += ' empty';
      var d = mk('div', cls);
      d.setAttribute('data-day', String(x.d));
      d.appendChild(mk('div', 'dt', '第 ' + x.d + ' 天'));
      var bar = mk('div', 'bar');
      var i = mk('i');
      var pct = result.battery.useWh > 0 ? Math.max(0, Math.min(1, x.q / result.battery.useWh)) * 100 : 0;
      i.style.width = (x.q <= 0 ? 0 : Math.max(2, pct)) + '%';
      bar.appendChild(i); d.appendChild(bar);
      d.appendChild(mk('div', 'qv', A.fmt(x.q, 1) + ' Wh'));
      d.setAttribute('data-q', String(x.q));
      d.title = '第 ' + x.d + ' 天：发电 ' + A.fmt(x.gen, 1) + ' Wh − 用电 ' + A.fmt(x.draw, 1) + ' Wh = 净 ' + A.fmt(x.net, 1) + ' Wh；结束时剩 ' + A.fmt(x.q, 1) + ' Wh（可用容量一共 ' + A.fmt(result.battery.useWh, 1) + ' Wh）';
      box.appendChild(d);
    });
    var v = A.rainVerdict(result);
    var p = $('rainVerdict');
    p.innerHTML = '';
    p.appendChild(mk('b', '', v.text));
    p.appendChild(document.createTextNode('　'));
    p.appendChild(mk('span', 'dd', v.detail + (result.rain.spill > 0 ? '阴雨期共弃掉 ' + A.fmt(result.rain.spill, 1) + ' Wh（充满后存不下）。' : '')));
  }

  function renderHave() {
    var out = $('haveOut');
    out.innerHTML = '';
    if (!result.ok) {
      out.className = 'verdict';
      out.appendChild(mk('div', 'vt', '输入有误'));
      out.appendChild(mk('div', 'vd', '先把上面的问题改掉。'));
      return;
    }
    var h = result.have;
    var cls = h.verdict === '都够' ? 'verdict ok' : (h.verdict === '未填' ? 'verdict' : 'verdict short');
    out.className = cls;
    out.appendChild(mk('div', 'vt', h.verdict === '未填' ? '还没填已有设备' : '判定：' + h.verdict));
    var lines = [];
    if (h.panelW > 0) {
      lines.push('已有组件 ' + A.fmt(h.panelW, 0) + ' W：一天能出 ' + A.fmt(h.E_sup, 1) + ' Wh，正好是日耗电（' + A.fmt(result.totals.E_day, 1) + ' Wh）的 ' + A.fmtPct(h.coverage) + '。');
    }
    if (h.battAh > 0) {
      lines.push('已有电池 ' + A.fmt(h.battAh, 0) + ' Ah：可用 ' + A.fmt(h.usable_wh, 1) + ' Wh，能撑 ' + A.fmt(h.d_have, 2) + ' 天（你要的是 ' + A.fmt(result.input.days, 1) + ' 天）。');
    }
    if (!lines.length) lines.push('填上已有设备的规格，这里会给出覆盖率、能撑几天、短板在哪。');
    lines.forEach(function (t) {
      var d = mk('div', 'vd', t);
      d.style.marginTop = '3px';
      out.appendChild(d);
    });
  }

  function renderAdvice() {
    var ul = $('advList');
    ul.innerHTML = '';
    if (!result.ok) { ul.appendChild(mk('li', '', '输入有误，先把上面的问题改掉。')); return; }
    if (!result.suggestions.length) {
      var li = mk('li'); li.appendChild(mk('div', 'none', '现在这一套没有明显的可改项 —— 也可以试着把某一行负载的每天小时数改大，看结论怎么动。'));
      ul.appendChild(li); return;
    }
    result.suggestions.forEach(function (s) {
      var li = mk('li');
      var txt = mk('div', 'txt');
      txt.appendChild(mk('div', 't', s.title));
      txt.appendChild(mk('div', 'w', s.why));
      li.appendChild(txt);
      var b = mk('button', 'btn sm', '就这么改');
      b.type = 'button';
      b.setAttribute('data-adv', s.id);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function renderOutputs() {
    renderErrors();
    renderConclusion();
    renderRowEnergy();
    renderSheet();
    renderRain();
    renderHave();
    renderAdvice();
  }
  function recompute() { result = A.compute(state); }
  function renderAll() { recompute(); renderSys(); renderHaveInputs(); renderLoads(); syncInputs(); renderOutputs(); }
  function render() { recompute(); renderOutputs(); }

  /* ══════════ 交互 ══════════ */
  function setRaw(kind, key, value) {
    if (kind === 'sys') state.sys[key] = String(value);
    else if (kind === 'have') state.have[key] = String(value);
  }
  function onInput(ev) {
    var t = ev.target;
    if (!t || t.tagName !== 'INPUT') return;
    var kind = t.getAttribute('data-kind');
    if (kind) { setRaw(kind, t.getAttribute('data-key'), t.value); saveState(); render(); return; }
    var row = t.getAttribute('data-row');
    if (row === null) return;
    var key = t.getAttribute('data-key');
    var i = Number(row);
    if (!state.loads[i]) return;
    if (key === 'simultaneous') state.loads[i].simultaneous = !!t.checked;
    else state.loads[i][key] = t.value;
    saveState();
    render();  /* 只重算输出区；输入框不重建，光标不会跳 */
  }
  function onClick(ev) {
    var t = ev.target;
    if (!t) return;
    var adv = t.getAttribute && t.getAttribute('data-adv');
    if (adv) {
      var s = null;
      result.suggestions.forEach(function (x) { if (x.id === adv) s = x; });
      if (!s) return;
      /* 顺序很重要：先改 state.raw，再同步输入框，最后重算 —— 反过来就会出现「点了没反应」 */
      state = A.applySuggestion(state, s);
      state.presetId = state.presetId || 'rv';
      saveState();
      syncInputs();
      render();
      toast('已按建议改掉输入，结果已重算');
      return;
    }
    var act = t.getAttribute && t.getAttribute('data-act');
    if (!act) return;
    var i = Number(t.getAttribute('data-row'));
    if (!state.loads[i]) return;
    if (act === 'ac') {
      state.loads[i].ac = t.getAttribute('data-val') === '1';
      saveState(); syncInputs(); render();
      toast('第 ' + (i + 1) + ' 行改成' + (state.loads[i].ac ? '交流' : '直流') + '，已重算');
    } else if (act === 'del') {
      if (state.loads.length <= 1) { toast('至少留一行'); return; }
      state.loads.splice(i, 1);
      saveState(); renderLoads(); render();
      toast('删掉了 1 行，剩 ' + state.loads.length + ' 行');
    }
  }

  /* ══════════ 下载 ══════════ */
  function download(name, blob) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(u); if (a.parentNode) a.parentNode.removeChild(a); }, 5000);
  }
  function exportCsv() {
    var csv = A.toCSV(state, result, { exportedAt: nowText() });
    download('offgrid-kit-csv-' + stamp() + '.csv', new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    toast('CSV 已导出（含 BOM，Excel 直接打开不乱码）');
  }
  function exportMd() {
    var md = A.toMarkdown(state, result, { exportedAt: nowText() });
    download('offgrid-kit-md-' + stamp() + '.md', new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    toast('Markdown 已导出');
  }
  function exportJson() {
    var js = A.toJSON(state, result, { exportedAt: nowText() });
    download('offgrid-kit-json-' + stamp() + '.json', new Blob([js], { type: 'application/json;charset=utf-8' }));
    toast('JSON 备份已导出');
  }

  var C = { paper: '#ffffff', ink: '#1f2933', ink2: '#52606d', ink3: '#7b8794', line: '#d9e2ec', line2: '#eef2f7', solar: '#d97706', bat: '#0e7490', ok: '#15803d', err: '#b91c1c' };
  function wrap(ctx, text, x, y, maxW, lh) {
    var line = '', yy = y;
    var words = String(text).split('');
    for (var i = 0; i < words.length; i++) {
      var test = line + words[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = words[i]; yy += lh; }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, yy); yy += lh; }
    return yy;
  }
  function drawCard() {
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
    g.fillStyle = C.solar; g.fillRect(0, 0, W, 14);
    var M = 68;
    g.textBaseline = 'top';
    g.fillStyle = C.ink;
    g.font = '600 52px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(A.SPEC.title, M, 62);
    g.fillStyle = C.ink2;
    g.font = '26px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('离网光伏配置单 · 照着买的最小规格', M, 130);
    g.fillStyle = C.ink3; g.font = '21px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('算这张卡的时间：' + nowText(), M, 168);
    g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath(); g.moveTo(M, 212); g.lineTo(W - M, 212); g.stroke();

    var y = 240;
    if (!result.ok) {
      g.fillStyle = C.err; g.font = '600 30px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText('输入有 ' + result.errors.length + ' 处问题，没有结论', M, y);
      y += 52;
      g.font = '23px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; g.fillStyle = C.ink2;
      result.errors.slice(0, 6).forEach(function (e) { y = wrap(g, '· ' + e.message, M, y, W - 2 * M, 34); });
    } else {
      var r = result;
      var quads = [
        ['组件', A.fmt(r.panel.need, 1) + ' W', r.panel.count + ' × ' + A.fmt(r.panel.unit, 0) + ' W，装机 ' + A.fmt(r.panel.installed, 0) + ' W'],
        ['电池', A.fmt(r.battery.ahNeed, 1) + ' Ah', r.battery.count + ' × ' + A.fmt(r.battery.unit, 0) + ' Ah @ ' + A.fmt(r.input.vBat, 2) + ' V'],
        ['控制器', A.fmt(r.controller.amps, 1) + ' A', '装机 ÷ ' + A.fmt(r.input.vBat, 0) + ' V，含 ' + A.fmt(r.controller.reserve * 100, 0) + '% 余量'],
        ['逆变器', A.fmt(r.inverter.rec, 0) + ' W', '连续；峰值 ≥ ' + A.fmt(r.inverter.peak, 0) + ' W']
      ];
      var cw = (W - 2 * M - 22) / 2;
      quads.forEach(function (q, i) {
        var x = M + (i % 2) * (cw + 22), yy = y + Math.floor(i / 2) * 152;
        g.fillStyle = C.line2; g.fillRect(x, yy, cw, 134);
        g.fillStyle = C.ink3; g.font = '22px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        g.fillText(q[0], x + 22, yy + 18);
        g.fillStyle = i === 0 ? C.solar : (i === 1 ? C.bat : C.ink);
        g.font = '600 46px ui-monospace,Menlo,monospace';
        g.fillText(q[1], x + 22, yy + 50);
        g.fillStyle = C.ink3; g.font = '19px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        wrap(g, q[2], x + 22, yy + 104, cw - 44, 24);
      });
      y += 152 * 2 + 14;
      g.strokeStyle = C.line; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
      y += 20;
      g.fillStyle = C.ink2; g.font = '600 25px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText('账', M, y); y += 40;
      var items = [
        ['日耗电（电池侧）', A.fmt(r.totals.E_day, 1) + ' Wh', '直流 ' + A.fmt(r.totals.E_dc, 1) + ' ＋ 交流含损 ' + A.fmt(r.totals.E_ac / r.input.etaInv, 1)],
        ['其中逆变损失', A.fmt(r.totals.E_invLoss, 1) + ' Wh', '交流侧原始用电 ' + A.fmt(r.totals.E_ac, 1) + ' Wh'],
        ['晴天日发电', A.fmt(r.panel.genDay, 1) + ' Wh', '装机 × 日照 ' + A.fmt(r.input.psh, 2) + ' h × 效率 ' + A.fmt(r.input.etaSys, 2)],
        ['晴天日余量', A.fmt(r.panel.surplus, 1) + ' Wh', '发电 − 用电'],
        ['阴雨 ' + r.rain.days + ' 天', A.rainVerdict(r).text, '阴雨天日照系数 ' + A.fmt(r.rain.factor, 2)],
        ['年发电估算', A.fmt(r.year.kwh, 1) + ' kWh', '假设全年每天都等于你填的日照']
      ];
      g.font = '21px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      items.forEach(function (it) {
        g.fillStyle = C.ink2; g.fillText(it[0], M, y);
        g.fillStyle = C.ink; g.font = '600 21px ui-monospace,Menlo,monospace';
        g.textAlign = 'right'; g.fillText(it[1], W - M, y); g.textAlign = 'left';
        g.fillStyle = C.ink3; g.font = '18px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        g.fillText(it[2], M + 210, y + 1);
        g.font = '21px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        y += 33;
      });
      y += 10;
      g.strokeStyle = C.line; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke();
      y += 20;
      g.fillStyle = C.ink2; g.font = '600 25px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText('要带的东西', M, y); y += 38;
      g.font = '20px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      r.loadRows.forEach(function (x) {
        g.fillStyle = C.ink; g.fillText(x.label, M, y);
        g.fillStyle = C.ink3; g.font = '18px ui-monospace,Menlo,monospace';
        g.fillText(A.fmt(x.values.w, 1) + ' W × ' + A.fmt(x.values.hours, 2) + ' h × ' + x.values.qty + (x.ac ? '（交流）' : ''), M + 250, y + 2);
        g.fillStyle = C.ink; g.font = '600 20px ui-monospace,Menlo,monospace';
        g.textAlign = 'right'; g.fillText(A.fmt(x.E_i, 1) + ' Wh', W - M, y); g.textAlign = 'left';
        g.font = '20px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        y += 30;
      });
    }
    g.fillStyle = C.ink3; g.font = '17px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    var fy = H - 108;
    g.strokeStyle = C.line; g.beginPath(); g.moveTo(M, fy - 22); g.lineTo(W - M, fy - 22); g.stroke();
    var note = '按日均线性模型估算，不替代专业设计；不查任何地区的真实日照数据，也不查产品参数。默认场景是虚构示例。';
    fy = wrap(g, note, M, fy, W - 2 * M, 24);
    g.fillText(A.SPEC.title + ' · ' + A.SPEC.version, M, fy + 2);
    return cv;
  }
  function exportPng() {
    var cv;
    try { cv = drawCard(); } catch (e) { toast('结果卡画不出来：' + e.message); return; }
    var done = function (blob) {
      if (!blob) { toast('结果卡导出失败（画布没有产出图片）'); return; }
      download('offgrid-kit-card-' + stamp() + '.png', blob);
      toast('结果卡已导出（1080×1350）');
    };
    if (cv.toBlob) {
      cv.toBlob(function (b) {
        if (b) { done(b); return; }
        try {
          var d = cv.toDataURL('image/png');
          var bin = atob(d.split(',')[1]), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          done(new Blob([arr], { type: 'image/png' }));
        } catch (e) { toast('结果卡导出失败：' + e.message); }
      }, 'image/png');
    } else {
      var d2 = cv.toDataURL('image/png');
      var bin2 = atob(d2.split(',')[1]), arr2 = new Uint8Array(bin2.length);
      for (var i2 = 0; i2 < bin2.length; i2++) arr2[i2] = bin2.charCodeAt(i2);
      done(new Blob([arr2], { type: 'image/png' }));
    }
  }

  /* ══════════ 初始化 ══════════ */
  function init() {
    state = loadState();
    renderPresets();
    renderAll();
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('click', onClick, true);
    $('addLoad').addEventListener('click', function () {
      if (state.loads.length >= A.SPEC.maxLoads) { toast('最多 ' + A.SPEC.maxLoads + ' 行'); return; }
      state.loads.push({ name: '新负载', w: '20', hours: '2', qty: '1', ac: false, simultaneous: true, surge: '1' });
      saveState(); renderLoads(); render();
      toast('加了一行，改完数字会自动重算');
    });
    $('resetBtn').addEventListener('click', function () {
      state = A.defaultState();
      saveState(); renderAll(); toast('已恢复默认场景');
    });
    $('presetSel').addEventListener('change', function () {
      var v = this.value;
      if (!v) return;
      state = A.defaultState(v);
      state.presetId = v;
      saveState(); renderAll(); this.value = '';
      var p = null; A.PRESETS.forEach(function (x) { if (x.id === v) p = x; });
      toast('已换成场景：' + (p ? p.name : v) + (p && p.note ? '（' + p.note + '）' : ''));
    });
    $('expCsv').addEventListener('click', exportCsv);
    $('expMd').addEventListener('click', exportMd);
    $('expJson').addEventListener('click', exportJson);
    $('expPng').addEventListener('click', exportPng);
    saveState();
  }

  /* 给验收脚本用的接口（不是给页面用的） */
  window.OffgridKitUI = {
    get state() { return state; },
    get result() { return result; },
    setRaw: function (kind, key, v) {
      setRaw(kind, key, v); saveState(); syncInputs(); render();
    },
    setLoad: function (i, key, v) {
      if (!state.loads[i]) return 'no-row';
      if (key === 'ac' || key === 'simultaneous') state.loads[i][key] = !!v; else state.loads[i][key] = String(v);
      saveState(); syncInputs(); render(); return 'ok';
    },
    setInputEl: function (id, v) {
      var e = $(id); if (!e) return 'no-el';
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    },
    applyAdvice: function (id) {
      var s = null;
      result.suggestions.forEach(function (x) { if (x.id === id) s = x; });
      if (!s) return 'no-such-advice';
      state = A.applySuggestion(state, s);
      saveState(); syncInputs(); render();
      return 'ok';
    },
    addRow: function () { $('addLoad').click(); return state.loads.length; },
    delRow: function (i) {
      var b = document.querySelector('.btn.x[data-row="' + i + '"]');
      if (!b) return 'no-btn';
      b.click(); return state.loads.length;
    },
    setAc: function (i, ac) {
      var b = document.querySelector('.acdc button[data-row="' + i + '"][data-val="' + (ac ? '1' : '0') + '"]');
      if (!b) return 'no-btn';
      b.click(); return 'ok';
    },
    loadPreset: function (id) {
      var s = $('presetSel'); s.value = id;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    },
    reset: function () { $('resetBtn').click(); return 'ok'; },
    render: function () { render(); return 'ok'; },
    summary: function () { return A.summary(result); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
