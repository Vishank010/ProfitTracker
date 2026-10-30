(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var WD = ['Ravivar', 'Somvar', 'Mangalvar', 'Budhvar', 'Guruvar', 'Shukravar', 'Shanivar'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LS_ENT = 'pk-entries', LS_PREF = 'pk-prefs';
  var state = { entries: [], sort: 'asc', filter: 'all', ready: false, error: '', focusId: null, editing: null };
  var saving = false, opener = null, lastType = 'invest', delArmed = false, delTimer = 0, toastTimer = 0;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr(off) {
    var d = new Date(); d.setDate(d.getDate() + (off || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(s) { var d = parseDate(s); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function weekday(s) { return WD[parseDate(s).getDay()]; }
  function money(n) {
    var v = Math.abs(n);
    var frac = Math.round(v * 100) % 100 !== 0;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
  }
  function signed(n) { return n > 0 ? '+' + money(n) : n < 0 ? '−' + money(n) : money(0); }

  function totals(list) {
    var inv = 0, rec = 0;
    list.forEach(function (e) {
      var p = Math.round(e.amount * 100);
      if (e.type === 'invest') inv += p; else rec += p;
    });
    return { inv: inv / 100, rec: rec / 100, net: (rec - inv) / 100 };
  }
  function cmp(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : 1;
  }
  function clean(id, x) {
    var amt = Number(x.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') || !isFinite(amt) || amt <= 0) return null;
    if (x.type !== 'invest' && x.type !== 'received') return null;
    return { id: id, date: x.date, type: x.type, amount: amt, note: String(x.note || ''), createdAt: Number(x.createdAt) || 0 };
  }

  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  /* ---------- localStorage ---------- */
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_PREF) || '{}');
      if (p.sort === 'asc' || p.sort === 'desc') state.sort = p.sort;
      if (['all', 'invest', 'received'].indexOf(p.filter) > -1) state.filter = p.filter;
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(LS_PREF, JSON.stringify({ sort: state.sort, filter: state.filter })); } catch (e) {}
  }
  function loadLocal() {
    try {
      var arr = JSON.parse(localStorage.getItem(LS_ENT) || '[]');
      state.entries = arr.map(function (x) { return clean(x.id, x); }).filter(Boolean);
    } catch (e) { state.entries = []; }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_ENT, JSON.stringify(state.entries)); state.error = ''; }
    catch (e) { state.error = 'Browser data save nahi kar pa raha. Page band karne par entries ud sakti hain.'; }
  }

  /* ---------- render ---------- */
  function renderBanner() {
    var b = $('#banner');
    var msg = state.error;
    b.hidden = !msg; b.className = 'banner err'; b.textContent = msg || '';
  }

  function renderSummary() {
    var box = $('#summary');
    box.textContent = '';
    var ready = state.ready;
    var t = totals(state.entries);
    var tone = !ready ? '' : t.net > 0 ? 'gain' : t.net < 0 ? 'loss' : '';
    box.className = 'summary ' + tone;
    var label = !ready ? (state.error ? 'Hisaab load nahi hua' : 'Hisaab load ho raha hai')
      : t.net > 0 ? 'Abhi tak ka Profit' : t.net < 0 ? 'Abhi tak ka Loss' : 'Profit / Loss';
    var top = h('div', { class: 'sum-top' }, [h('span', { class: 'sum-label', text: label })]);
    if (ready && t.inv > 0) {
      var roi = Math.round(t.net / t.inv * 100);
      top.appendChild(h('span', { class: 'pill', text: 'Investment par ' + (roi > 0 ? '+' : roi < 0 ? '−' : '') + Math.abs(roi) + '%' }));
    }
    box.appendChild(top);
    box.appendChild(h('div', { class: 'sum-big', text: ready ? signed(t.net) : '—' }));
    box.appendChild(h('div', { class: 'stats' }, [
      h('div', { class: 'stat out' }, [h('span', { text: 'Total Investment' }), h('b', { text: ready ? money(t.inv) : '—' })]),
      h('div', { class: 'stat in' }, [h('span', { text: 'Payment mila' }), h('b', { text: ready ? money(t.rec) : '—' })])
    ]));
    if (ready && t.inv > 0) {
      var ratio = t.rec / t.inv;
      var pct = Math.min(100, Math.round(ratio * 100));
      var track = h('div', { class: 'track', role: 'progressbar', 'aria-label': 'Investment wapas aaya', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, [
        h('div', { class: 'fill', style: 'width:' + pct + '%' })
      ]);
      box.appendChild(h('div', {}, [
        h('div', { class: 'recover-head' }, [
          h('span', { text: 'Investment wapas aaya' }),
          h('span', { text: ratio >= 1 ? '100%+' : pct + '%' })
        ]),
        track
      ]));
    }
  }

  function renderTools() {
    document.querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-filter') === state.filter ? 'true' : 'false');
    });
    $('#sort').textContent = state.sort === 'asc' ? '↑ Purani pehle' : '↓ Nayi pehle';
  }

  function dayEl(g) {
    var visSum = 0;
    g.items.forEach(function (e) { visSum += Math.round(e.amount * 100) * (e.type === 'received' ? 1 : -1); });
    var val = state.filter === 'all' ? g.all : visSum;
    var tone = val > 0 ? 'gain' : val < 0 ? (state.filter === 'invest' ? 'out' : 'loss') : '';
    var net = h('div', { class: 'dnet ' + tone }, [signed(val / 100)]);
    if (state.filter === 'all') net.appendChild(h('small', { text: 'Ab tak ' + signed(g.cum / 100) }));
    var rows = h('ul', { class: 'rows' });
    g.items.forEach(function (e) {
      var isIn = e.type === 'received';
      var kids = [
        h('span', { class: 'tag ' + (isIn ? 'in' : 'out'), text: isIn ? 'Payment mila' : 'Investment' }),
        h('span', { class: 'amt ' + (isIn ? 'in' : 'out'), text: (isIn ? '+' : '−') + money(e.amount) })
      ];
      if (e.note) kids.push(h('span', { class: 'note', text: e.note }));
      rows.appendChild(h('li', {}, [h('button', { type: 'button', class: 'row', 'data-id': e.id }, kids)]));
    });
    return h('section', { class: 'day', 'data-date': g.date }, [
      h('header', { class: 'day-h' }, [
        h('div', {}, [h('span', { class: 'day-date', text: fmtDate(g.date) }), h('span', { class: 'day-wd', text: weekday(g.date) })]),
        net
      ]),
      rows
    ]);
  }

  function renderList() {
    var box = $('#list');
    box.textContent = '';
    if (!state.ready) {
      if (!state.error) box.appendChild(h('div', { class: 'empty' }, [h('p', { text: 'Hisaab load ho raha hai…' })]));
      return;
    }
    if (!state.entries.length) {
      box.appendChild(h('div', { class: 'empty' }, [
        h('h2', { text: 'Pehli entry daalo' }),
        h('p', { text: 'Investment me wo paisa likho jo lagaya, Payment me wo jo aaya. Har entry ki apni date hoti hai, to purani ya aage ki date ki entry bhi bana sakte ho.' }),
        h('p', { text: 'Neeche “+ Nayi entry” dabao.' })
      ]));
      return;
    }
    var asc = state.entries.slice().sort(cmp);
    var groups = [], idx = {}, cum = 0;
    asc.forEach(function (e) {
      var g = idx[e.date];
      if (!g) { g = { date: e.date, all: 0, items: [] }; idx[e.date] = g; groups.push(g); }
      g.all += Math.round(e.amount * 100) * (e.type === 'received' ? 1 : -1);
      if (state.filter === 'all' || state.filter === e.type) g.items.push(e);
    });
    groups.forEach(function (g) { cum += g.all; g.cum = cum; });
    var vis = groups.filter(function (g) { return g.items.length; });
    if (!vis.length) {
      box.appendChild(h('div', { class: 'empty' }, [h('p', { text: 'Is filter me koi entry nahi hai.' })]));
      return;
    }
    if (state.sort === 'desc') { vis.reverse(); vis.forEach(function (g) { g.items.reverse(); }); }
    vis.forEach(function (g) { box.appendChild(dayEl(g)); });
    if (state.focusId) {
      var el = box.querySelector('[data-id="' + state.focusId + '"]');
      if (el) {
        state.focusId = null;
        requestAnimationFrame(function () {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          setTimeout(function () { el.classList.remove('flash'); }, 1800);
        });
      }
    }
  }

  function render() { renderBanner(); renderSummary(); renderTools(); renderList(); }

  /* ---------- toast ---------- */
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- sheet ---------- */
  function setType(v) { $(v === 'received' ? '#t-received' : '#t-invest').checked = true; }
  function getType() { return $('#t-received').checked ? 'received' : 'invest'; }
  function updateDateHint() {
    var v = $('#f-date').value;
    $('#date-hint').textContent = /^\d{4}-\d{2}-\d{2}$/.test(v) ? weekday(v) + ', ' + fmtDate(v) : 'Date chuno';
  }
  function resetDelete() {
    delArmed = false; clearTimeout(delTimer);
    var d = $('#del'); d.classList.remove('armed'); d.textContent = 'Delete';
  }
  function showFormErr(msg) { var e = $('#form-err'); e.textContent = msg || ''; e.hidden = !msg; }

  function openSheet(entry) {
    opener = document.activeElement;
    state.editing = entry ? entry.id : null;
    $('#sheet-title').textContent = entry ? 'Entry badlo' : 'Nayi entry';
    setType(entry ? entry.type : lastType);
    $('#f-date').value = entry ? entry.date : todayStr(0);
    $('#f-amount').value = entry ? String(entry.amount) : '';
    $('#f-note').value = entry ? entry.note : '';
    $('#save').textContent = entry ? 'Badlav save karo' : 'Save karo';
    $('#save').disabled = false;
    $('#del').hidden = !entry;
    resetDelete(); showFormErr('');
    updateDateHint();
    $('#overlay').hidden = false;
    document.documentElement.classList.add('lock');
    if (!entry) $('#f-amount').focus();
  }
  function closeSheet() {
    $('#overlay').hidden = true;
    document.documentElement.classList.remove('lock');
    state.editing = null; saving = false;
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }

  function persist(id, data) {
    var nid = id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var rec = { id: nid, date: data.date, type: data.type, amount: data.amount, note: data.note, createdAt: data.createdAt };
    var found = false;
    state.entries = state.entries.map(function (e) { if (e.id === nid) { found = true; return rec; } return e; });
    if (!found) state.entries.push(rec);
    saveLocal();
    return nid;
  }
  function removeEntry(id) {
    state.entries = state.entries.filter(function (e) { return e.id !== id; });
    saveLocal();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    if (saving) return;
    var date = $('#f-date').value;
    var raw = $('#f-amount').value.replace(/[,\s₹]/g, '');
    var amt = parseFloat(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showFormErr('Date chuno.'); return; }
    if (!/^\d*\.?\d+$/.test(raw) || !isFinite(amt) || amt <= 0) { showFormErr('Amount sahi likho, jaise 1500 ya 1499.50.'); return; }
    var existing = state.editing ? state.entries.filter(function (e) { return e.id === state.editing; })[0] : null;
    var type = getType();
    var data = {
      date: date, type: type,
      amount: Math.round(amt * 100) / 100,
      note: $('#f-note').value.trim().slice(0, 140),
      createdAt: existing ? existing.createdAt : Date.now()
    };
    saving = true; $('#save').disabled = true; $('#save').textContent = 'Save ho raha hai…'; showFormErr('');
    try {
      var id = persist(state.editing, data);
      lastType = type;
      if (state.filter !== 'all' && state.filter !== type) { state.filter = 'all'; savePrefs(); }
      state.focusId = id;
      var wasEdit = !!state.editing;
      closeSheet();
      render();
      toast(wasEdit ? 'Badlav save ho gaya' : 'Entry save ho gayi');
    } catch (e) {
      saving = false; $('#save').disabled = false;
      $('#save').textContent = state.editing ? 'Badlav save karo' : 'Save karo';
      showFormErr('Save nahi ho paya. Dobara try karo.');
    }
  }

  function onDelete() {
    if (!state.editing) return;
    if (!delArmed) {
      delArmed = true;
      var d = $('#del'); d.classList.add('armed'); d.textContent = 'Pakka delete?';
      clearTimeout(delTimer); delTimer = setTimeout(resetDelete, 4000);
      return;
    }
    var id = state.editing;
    try {
      removeEntry(id);
      closeSheet(); render(); toast('Entry delete ho gayi');
    } catch (e) {
      resetDelete(); showFormErr('Delete nahi ho paya. Dobara try karo.');
    }
  }

  /* ---------- events ---------- */
  $('#add').addEventListener('click', function () { openSheet(null); });
  $('#sheet').addEventListener('submit', onSubmit);
  $('#del').addEventListener('click', onDelete);
  $('#f-date').addEventListener('input', updateDateHint);
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });
  document.querySelectorAll('.quick button').forEach(function (b) {
    b.addEventListener('click', function () {
      $('#f-date').value = todayStr(parseInt(b.getAttribute('data-days'), 10));
      updateDateHint();
    });
  });
  $('#list').addEventListener('click', function (ev) {
    var row = ev.target.closest('.row');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var e = state.entries.filter(function (x) { return x.id === id; })[0];
    if (e) openSheet(e);
  });
  document.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () { state.filter = c.getAttribute('data-filter'); savePrefs(); render(); });
  });
  $('#sort').addEventListener('click', function () { state.sort = state.sort === 'asc' ? 'desc' : 'asc'; savePrefs(); render(); });
  document.addEventListener('keydown', function (ev) {
    if ($('#overlay').hidden) return;
    if (ev.key === 'Escape') { closeSheet(); return; }
    if (ev.key !== 'Tab') return;
    var f = Array.prototype.slice.call($('#sheet').querySelectorAll('button, input')).filter(function (el) {
      return !el.disabled && !el.hidden && el.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });

  /* ---------- start ---------- */
  loadPrefs();
  loadLocal();
  state.ready = true;
  render();
})();