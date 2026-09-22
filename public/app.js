'use strict';

/* ============================================================
 * 剧场排练走位工具
 * 纯前端逻辑：8×6 网格、逐拍推演、碰撞/互换/越界检测、本地保存
 * ============================================================ */
(function () {
  const COLS = 8;
  const ROWS = 6;

  // r 坐标：1 为靠近观众席（舞台下方），6 为上场方向（舞台上方）
  const DIRS = {
    U: { dc: 0, dr: 1, label: '上', glyph: '△' },
    D: { dc: 0, dr: -1, label: '下', glyph: '▽' },
    L: { dc: -1, dr: 0, label: '左', glyph: '◁' },
    R: { dc: 1, dr: 0, label: '右', glyph: '▷' },
    S: { dc: 0, dr: 0, label: '原地', glyph: '·' }
  };
  const DIR_ORDER = ['U', 'D', 'L', 'R', 'S'];
  const STORAGE_KEY = 'stage-blocking:v1';

  const PALETTE = [
    '#5b8def', '#e5484d', '#3ecf8e', '#f5a623', '#a78bfa',
    '#22b8cf', '#f783ac', '#8ce99a', '#ffa94d', '#63e6be'
  ];

  let idSeq = 0;
  function uid(prefix) {
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq.toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  function cellKey(c, r) { return c + ',' + r; }
  function parseKey(key) {
    const parts = String(key).split(',');
    return { c: Number(parts[0]), r: Number(parts[1]) };
  }
  function inBounds(c, r) { return c >= 1 && c <= COLS && r >= 1 && r <= ROWS; }
  function moveAt(actor, beat) {
    const d = actor.moves[String(beat)];
    return DIRS[d] ? d : 'S';
  }

  /* ---------------- 示例走位（首次打开自动载入） ---------------- */
  function demoState() {
    return {
      beats: 4,
      nextActorNum: 5,
      actors: [
        { id: 'demo_a', name: '阿甲', start: { c: 4, r: 2 }, moves: { '1': 'L', '2': 'R', '3': 'R', '4': 'R' } },
        { id: 'demo_b', name: '阿乙', start: { c: 5, r: 2 }, moves: { '1': 'L', '2': 'L', '3': 'R', '4': 'U' } },
        { id: 'demo_c', name: '阿丙', start: { c: 4, r: 5 }, moves: { '1': 'D', '2': 'D', '3': 'D', '4': 'L' } },
        { id: 'demo_d', name: '阿丁', start: { c: 8, r: 6 }, moves: { '1': 'R', '2': 'S', '3': 'S', '4': 'U' } }
      ]
    };
  }

  function freshState() {
    return { beats: 4, nextActorNum: 1, actors: [] };
  }

  /* ---------------- 数据校验 / 规整 ---------------- */
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad state');
    let beats = Math.trunc(Number(raw.beats));
    if (!Number.isFinite(beats) || beats < 1 || beats > 100) beats = 4;

    const actors = [];
    const rawActors = Array.isArray(raw.actors) ? raw.actors : [];
    let nextActorNum = Math.trunc(Number(raw.nextActorNum)) || rawActors.length + 1;

    for (const ra of rawActors) {
      if (!ra || typeof ra !== 'object') continue;
      const name = (typeof ra.name === 'string' && ra.name.trim()) ? ra.name.trim().slice(0, 20) : '演员';
      let start = null;
      if (ra.start && typeof ra.start === 'object') {
        const c = Math.trunc(Number(ra.start.c));
        const r = Math.trunc(Number(ra.start.r));
        if (inBounds(c, r)) start = { c, r };
      }
      const moves = {};
      if (ra.moves && typeof ra.moves === 'object') {
        for (const k of Object.keys(ra.moves)) {
          const b = Math.trunc(Number(k));
          if (b >= 1 && b <= beats && DIRS[ra.moves[k]]) moves[String(b)] = ra.moves[k];
        }
      }
      actors.push({
        id: (typeof ra.id === 'string' && ra.id) ? ra.id.slice(0, 60) : uid('a'),
        name, start, moves
      });
    }
    return { beats, nextActorNum: Math.max(nextActorNum, actors.length + 1), actors };
  }

  /* ---------------- 核心推演（纯函数，供测试调用） ----------------
   * 返回:
   *  positions[b]: { actorId: "c,r" }  —— 每拍各演员所在格
   *  blocked:      [{beat, actorId, dir, from}] 被拦截的越界动作
   *  collisions:   [{beat, key, ids}] 同拍同格
   *  swaps:        [{beat, a, b, keyA, keyB}] 相邻两拍互换
   * ------------------------------------------------------------- */
  function simulate(actors, beats) {
    const positions = [];
    const blocked = [];

    // 第 0 拍：起点
    const pos0 = {};
    for (const actor of actors) {
      if (actor.start) pos0[actor.id] = cellKey(actor.start.c, actor.start.r);
    }
    positions.push(pos0);

    for (let beat = 1; beat <= beats; beat++) {
      const prev = positions[beat - 1];
      const cur = Object.assign({}, prev);
      for (const actor of actors) {
        const from = prev[actor.id];
        if (!from) continue; // 未设起点的演员不参与推演
        const dir = moveAt(actor, beat);
        if (dir === 'S') continue;
        const { c, r } = parseKey(from);
        const nc = c + DIRS[dir].dc;
        const nr = r + DIRS[dir].dr;
        if (!inBounds(nc, nr)) {
          blocked.push({ beat, actorId: actor.id, dir, from }); // 拦截：原地不动
          continue;
        }
        cur[actor.id] = cellKey(nc, nr);
      }
      positions.push(cur);
    }

    const collisions = [];
    const swaps = [];
    for (let beat = 0; beat <= beats; beat++) {
      // 同拍同格
      const occupied = new Map();
      for (const [id, key] of Object.entries(positions[beat])) {
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(id);
      }
      for (const [key, ids] of occupied) {
        if (ids.length > 1) collisions.push({ beat, key, ids: ids.slice() });
      }

      // 相邻两拍互换：A: X→Y 且 B: Y→X
      if (beat >= 1) {
        const cur = positions[beat];
        const prev = positions[beat - 1];
        for (const idA of Object.keys(cur)) {
          const keyA = cur[idA];
          const keyFromA = prev[idA];
          if (!keyFromA || keyFromA === keyA) continue;
          for (const idB of Object.keys(cur)) {
            if (idB <= idA) continue;
            if (cur[idB] === keyFromA && prev[idB] === keyA) {
              swaps.push({ beat, a: idA, b: idB, keyA, keyB: keyFromA });
            }
          }
        }
      }
    }

    return { positions, blocked, collisions, swaps };
  }

  /* ============================================================
   * 以下为浏览器 UI 层
   * ============================================================ */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { simulate, normalizeState, DIRS, DIR_ORDER, COLS, ROWS, cellKey };
    }
    return;
  }

  /* ---------------- 运行时状态 ---------------- */
  let state = freshState();
  let currentBeat = 0;
  let sim = simulate(state.actors, state.beats);
  let settingActorId = null;   // 正在设置起点的演员
  let focusKey = null;         // 当前定位的冲突 key
  let playing = false;
  let playTimer = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const actorById = (id) => state.actors.find((a) => a.id === id);
  const actorColor = (actor) => PALETTE[state.actors.indexOf(actor) % PALETTE.length];
  const beatName = (b) => (b === 0 ? '起点' : '第 ' + b + ' 拍');

  /* ---------------- 本地保存 / 读取 ---------------- */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: new Date().toISOString(), currentBeat, state
      }));
    } catch (err) { /* 隐私模式等场景下静默失败 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = normalizeState(parsed.state);
        currentBeat = Math.min(Math.max(Number(parsed.currentBeat) || 0, 0), state.beats);
        return true;
      }
    } catch (err) { /* 损坏数据：回退示例 */ }
    state = demoState();
    currentBeat = 0;
    return false;
  }

  function resim() { sim = simulate(state.actors, state.beats); }

  function commit(gotoBeat) {
    resim();
    save();
    if (gotoBeat !== undefined && gotoBeat !== currentBeat) currentBeat = gotoBeat;
    if (currentBeat > state.beats) currentBeat = state.beats;
    renderAll();
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || '');
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  /* ---------------- 舞台构建（格子只建一次） ---------------- */
  function buildStage() {
    const colLabels = document.querySelector('.col-labels');
    const rowLabels = document.querySelector('.row-labels');
    colLabels.innerHTML = '<span class="cl"></span>' +
      Array.from({ length: COLS }, (_, i) => '<span class="cl">' + (i + 1) + '</span>').join('');
    // 视觉最上方是第 6 行（远离观众），最下方是第 1 行
    rowLabels.innerHTML = Array.from({ length: ROWS }, (_, vr) =>
      '<span class="rl">' + (ROWS - vr) + '</span>').join('');

    const grid = $('stageGrid');
    grid.innerHTML = '<svg class="swap-arrows" aria-hidden="true"></svg>';
    for (let vr = 0; vr < ROWS; vr++) {
      for (let vc = 0; vc < COLS; vc++) {
        const c = vc + 1;
        const r = ROWS - vr;
        const cell = document.createElement('div');
        cell.className = 'cell' + ((vr + vc) % 2 ? ' dark' : '');
        cell.dataset.key = cellKey(c, r);
        cell.innerHTML = '<span class="coord">' + c + '-' + r + '</span>';
        grid.appendChild(cell);
      }
    }
  }

  /* ---------------- 舞台渲染 ---------------- */
  function renderStage() {
    const grid = $('stageGrid');
    grid.querySelectorAll('.cell').forEach((cell) => {
      cell.classList.remove('collision', 'swap-cell', 'blocked-cell', 'focus-cell');
      cell.querySelectorAll('.chip, .ban').forEach((n) => n.remove());
    });
    const svg = grid.querySelector('.swap-arrows');
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + (COLS * 10) + ' ' + (ROWS * 10));

    const pos = sim.positions[currentBeat] || {};

    // 按格分组演员（同格时错开显示）
    const groups = new Map();
    for (const actor of state.actors) {
      const key = pos[actor.id];
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(actor);
    }
    for (const [key, actors] of groups) {
      const cell = grid.querySelector('.cell[data-key="' + key + '"]');
      if (!cell) continue;
      actors.forEach((actor, idx) => {
        const chip = document.createElement('span');
        chip.className = 'chip c' + idx;
        chip.style.backgroundColor = actorColor(actor);
        chip.textContent = actor.name.slice(0, 2);
        chip.title = actor.name + ' @ (' + key + ')';
        if (focusKey) {
          const cf = findConflict(focusKey);
          if (cf && cf.actorIds.includes(actor.id)) chip.classList.add('attention');
        }
        cell.appendChild(chip);
      });
    }

    const swapsHere = sim.swaps.filter((s) => s.beat === currentBeat);
    swapsHere.forEach((s) => {
      const a = parseKey(s.keyA);
      const b = parseKey(s.keyB);
      const focused = focusKey === swapKey(s);
      const color = focused ? '#6ea8fe' : '#f5a623';
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const u = 10;
      const x1 = (a.c - 0.5) * u, y1 = (ROWS - a.r + 0.5) * u;
      const x2 = (b.c - 0.5) * u, y2 = (ROWS - b.r + 0.5) * u;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const inset = Math.min(2.4, len / 4);
      const ux = dx / len, uy = dy / len;
      line.setAttribute('x1', x1 + ux * inset);
      line.setAttribute('y1', y1 + uy * inset);
      line.setAttribute('x2', x2 - ux * inset);
      line.setAttribute('y2', y2 - uy * inset);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '0.9');
      line.setAttribute('stroke-dasharray', '1.6 1.2');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      line.setAttribute('marker-start', 'url(#' + (focused ? 'ahBlueStart' : 'ahStart') + ')');
      line.setAttribute('marker-end', 'url(#' + (focused ? 'ahBlueEnd' : 'ahEnd') + ')');
      svg.appendChild(line);
      grid.querySelector('.cell[data-key="' + s.keyA + '"]')?.classList.add('swap-cell');
      grid.querySelector('.cell[data-key="' + s.keyB + '"]')?.classList.add('swap-cell');
    });
    if (swapsHere.length) {
      const ns = 'http://www.w3.org/2000/svg';
      const defs = document.createElementNS(ns, 'defs');
      defs.innerHTML =
        '<marker id="ahEnd" markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto">' +
        '<path d="M0,0 L4,2 L0,4 z" fill="#f5a623"/></marker>' +
        '<marker id="ahStart" markerWidth="4" markerHeight="4" refX="1.4" refY="2" orient="auto">' +
        '<path d="M4,0 L0,2 L4,4 z" fill="#f5a623"/></marker>' +
        '<marker id="ahBlueEnd" markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto">' +
        '<path d="M0,0 L4,2 L0,4 z" fill="#6ea8fe"/></marker>' +
        '<marker id="ahBlueStart" markerWidth="4" markerHeight="4" refX="1.4" refY="2" orient="auto">' +
        '<path d="M4,0 L0,2 L4,4 z" fill="#6ea8fe"/></marker>';
      svg.insertBefore(defs, svg.firstChild);
    }

    sim.collisions.filter((c) => c.beat === currentBeat).forEach((c) => {
      grid.querySelector('.cell[data-key="' + c.key + '"]')?.classList.add('collision');
    });
    sim.blocked.filter((b) => b.beat === currentBeat).forEach((b) => {
      const key = pos[b.actorId];
      const cell = key && grid.querySelector('.cell[data-key="' + key + '"]');
      if (cell) {
        cell.classList.add('blocked-cell');
        const ban = document.createElement('span');
        ban.className = 'ban';
        ban.textContent = '⛔';
        ban.title = (actorById(b.actorId)?.name || '') + ' 向' + DIRS[b.dir].label + '越界被拦截';
        cell.appendChild(ban);
      }
    });

    if (focusKey) {
      const cf = findConflict(focusKey);
      if (cf && cf.beat === currentBeat) {
        cf.cellKeys.forEach((key) => {
          grid.querySelector('.cell[data-key="' + key + '"]')?.classList.add('focus-cell');
        });
      }
    }

    $('stage').classList.toggle('start-mode', settingActorId !== null);
  }

  /* ---------------- 冲突汇总 ---------------- */
  function collisionKey(c) { return 'col-' + c.beat + '-' + c.key; }
  function swapKey(s) { return 'swp-' + s.beat + '-' + [s.a, s.b].sort().join('-'); }
  function blockedKey(b) { return 'blk-' + b.beat + '-' + b.actorId; }

  function allConflicts() {
    const items = [];
    sim.collisions.forEach((c) => {
      items.push({
        key: collisionKey(c), kind: 'collision', beat: c.beat,
        actorIds: c.ids, cellKeys: [c.key],
        text: c.ids.map((id) => actorById(id)?.name || '?').join('、') + ' 同在 (' + c.key + ')'
      });
    });
    sim.swaps.forEach((s) => {
      items.push({
        key: swapKey(s), kind: 'swap', beat: s.beat,
        actorIds: [s.a, s.b], cellKeys: [s.keyA, s.keyB],
        text: (actorById(s.a)?.name || '?') + ' ⇄ ' + (actorById(s.b)?.name || '?') + ' 互换格子'
      });
    });
    sim.blocked.forEach((b) => {
      items.push({
        key: blockedKey(b), kind: 'blocked', beat: b.beat,
        actorIds: [b.actorId], cellKeys: [b.from],
        text: (actorById(b.actorId)?.name || '?') + ' 向「' + DIRS[b.dir].label + '」移动越界'
      });
    });
    const rank = { collision: 0, swap: 1, blocked: 2 };
    items.sort((x, y) => (x.beat - y.beat) || rank[x.kind] - rank[y.kind]);
    return items;
  }
  function findConflict(key) { return allConflicts().find((cf) => cf.key === key) || null; }

  /* ---------------- 演员列表渲染 ---------------- */
  function renderActors() {
    const ul = $('actorList');
    if (!state.actors.length) {
      ul.innerHTML = '<li class="empty-hint">还没有演员，点击右上角「添加演员」开始。</li>';
      return;
    }
    ul.innerHTML = '';
    state.actors.forEach((actor) => {
      const li = document.createElement('li');
      li.className = 'actor-row';
      const pos = sim.positions[currentBeat]?.[actor.id];
      const posHtml = actor.start
        ? '<span class="actor-pos">(' + (pos || actor.start.c + ',' + actor.start.r) + ')</span>'
        : '<span class="actor-pos unset">未设起点</span>';
      li.innerHTML =
        '<span class="actor-dot" style="background:' + actorColor(actor) + '"></span>' +
        '<input class="actor-name-input" value="" maxlength="20" aria-label="演员名">' +
        posHtml +
        '<button type="button" class="row-btn set-btn" title="设置起点" aria-label="设置起点">◎</button>' +
        '<button type="button" class="row-btn del-btn" title="删除演员" aria-label="删除演员">✕</button>';
      li.querySelector('.actor-name-input').value = actor.name;
      if (settingActorId === actor.id) li.querySelector('.set-btn').classList.add('active');

      li.querySelector('.actor-name-input').addEventListener('change', (e) => {
        const v = e.target.value.trim();
        actor.name = v || actor.name;
        commit();
      });
      li.querySelector('.set-btn').addEventListener('click', () => toggleStartSetting(actor.id));
      li.querySelector('.del-btn').addEventListener('click', () => {
        if (!confirm('确定删除演员「' + actor.name + '」及其全部走位吗？')) return;
        state.actors = state.actors.filter((a) => a.id !== actor.id);
        if (settingActorId === actor.id) settingActorId = null;
        toast('已删除 ' + actor.name, 'ok');
        commit();
      });
      ul.appendChild(li);
    });
  }

  /* ---------------- 冲突列表渲染 ---------------- */
  function renderConflicts() {
    const box = $('conflictList');
    const items = allConflicts();
    const badge = $('conflictBadge');
    badge.textContent = String(items.length);
    badge.classList.toggle('hidden', items.length === 0);

    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="empty-hint">当前走位无冲突 🎉</div>';
      return;
    }
    const icon = { collision: '🔴', swap: '🔁', blocked: '⛔' };
    items.forEach((cf) => {
      const div = document.createElement('div');
      div.className = 'conflict-item ' + cf.kind + '-item' + (focusKey === cf.key ? ' focused' : '');
      div.dataset.cf = cf.key;
      div.innerHTML =
        '<span class="ci-icon">' + icon[cf.kind] + '</span>' +
        '<span class="ci-text"></span>' +
        '<span class="ci-beat">' + beatName(cf.beat) + '</span>';
      div.querySelector('.ci-text').textContent = cf.text;
      div.title = '点击定位到' + beatName(cf.beat) + ' · (' + cf.cellKeys.join(')、(') + ')';
      div.addEventListener('click', () => focusConflict(cf.key));
      box.appendChild(div);
    });
  }

  /* ---------------- 走位表渲染 ---------------- */
  function renderTable() {
    const head = $('tableHead');
    const body = $('tableBody');

    let head1 = '<tr><th class="th-actor" rowspan="2">演员 / 拍</th>';
    let head2 = '<tr>';
    for (let b = 0; b <= state.beats; b++) {
      if (b === 0) {
        head1 += '<th class="th-beat" data-beat="0">起点</th>';
        head2 += '<th>坐标</th>';
      } else {
        head1 += '<th class="th-beat' + (b === currentBeat ? ' current' : '') + '" data-beat="' + b + '">第 ' + b + ' 拍</th>';
        head2 += '<th>动作</th>';
      }
    }
    head1 += '<th class="th-add" rowspan="2"><button type="button" class="btn btn-sm" id="thAddBeat">＋</button></th>';
    head.innerHTML = head1 + '</tr>' + head2 + '</tr>';

    body.innerHTML = '';
    state.actors.forEach((actor) => {
      const tr = document.createElement('tr');
      let html = '<td class="actor-cell"><span class="ac-dot" style="background:' + actorColor(actor) + '"></span>' +
        escapeHtml(actor.name) + '</td>';
      html += '<td>' + (actor.start ? '(' + actor.start.c + ', ' + actor.start.r + ')' :
        '<span class="unset">—</span>') + '</td>';
      for (let b = 1; b <= state.beats; b++) {
        const cur = currentBeat === b ? ' current' : '';
        if (!actor.start) {
          html += '<td class="move-cell no-start' + cur + '" data-aid="' + actor.id + '" data-beat="' + b + '">—</td>';
          continue;
        }
        const dir = moveAt(actor, b);
        const isBlocked = sim.blocked.some((x) => x.beat === b && x.actorId === actor.id);
        html += '<td class="move-cell' + cur + (isBlocked ? ' blocked' : '') +
          '" data-aid="' + actor.id + '" data-beat="' + b + '">' +
          '<select class="move-select" data-aid="' + actor.id + '" data-beat="' + b +
          '" title="第 ' + b + ' 拍动作">' +
          DIR_ORDER.map((d) => '<option value="' + d + '"' + (d === dir ? ' selected' : '') + '>' +
            DIRS[d].glyph + ' ' + DIRS[d].label + '</option>').join('') +
          '</select></td>';
      }
      html += '<td class="row-spacer"></td>';
      tr.innerHTML = html;
      body.appendChild(tr);
    });

    body.querySelectorAll('.move-select').forEach((sel) => {
      sel.addEventListener('change', onMoveChange);
    });
    head.querySelectorAll('.th-beat').forEach((th) => {
      th.addEventListener('click', () => gotoBeat(Number(th.dataset.beat)));
    });
    $('thAddBeat')?.addEventListener('click', addBeat);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  /* ---------------- 顶部控件渲染 ---------------- */
  function renderToolbar() {
    $('beatLabel').textContent = beatName(currentBeat);
    $('beatCounter').textContent = '共 ' + state.beats + ' 拍';
    const slider = $('beatSlider');
    slider.max = String(state.beats);
    slider.value = String(currentBeat);
    slider.disabled = settingActorId !== null;
    $('prevBeat').disabled = currentBeat === 0 || settingActorId !== null;
    $('nextBeat').disabled = currentBeat === state.beats || settingActorId !== null;
    $('playBtn').classList.toggle('active', playing);
    $('editStartBtn').classList.toggle('active', settingActorId !== null);
    $('editStartBtn').textContent = settingActorId
      ? '✚ 退出起点模式（' + (actorById(settingActorId)?.name || '') + '）'
      : '✚ 设置起点模式';
    const banner = $('startBanner');
    banner.classList.toggle('hidden', settingActorId === null);
    if (settingActorId) $('startActorName').textContent = actorById(settingActorId)?.name || '';
  }

  function renderAll() {
    renderStage();
    renderActors();
    renderConflicts();
    renderTable();
    renderToolbar();
  }

  /* ---------------- 动作编辑（越界拦截） ---------------- */
  function onMoveChange(e) {
    const actor = actorById(e.target.dataset.aid);
    const beat = Number(e.target.dataset.beat);
    const dir = e.target.value;
    if (!actor) return;

    actor.moves[String(beat)] = dir;
    const trial = simulate(state.actors, state.beats);
    const hit = trial.blocked.find((b) => b.beat === beat && b.actorId === actor.id && b.dir === dir);
    if (hit) {
      // 立即拦截：不保存该动作
      delete actor.moves[String(beat)];
      const { c, r } = parseKey(hit.from);
      toast('⛔ 第 ' + beat + ' 拍：' + actor.name + ' 向「' + DIRS[dir].label +
        '」会从 (' + c + ',' + r + ') 走出舞台，动作已拦截', 'error');
      resim();
      renderTable();
      return;
    }
    commit();
    const downstream = trial.blocked.filter((b) => b.actorId === actor.id).length;
    if (downstream > 0) toast('已保存，但该演员后续有 ' + downstream + ' 个越界动作被标记', 'error');
  }

  /* ---------------- 起点设置 ---------------- */
  function toggleStartSetting(id) {
    settingActorId = settingActorId === id ? null : id;
    if (settingActorId && currentBeat !== 0) currentBeat = 0;
    stopPlay();
    commit();
  }

  function onStageClick(e) {
    if (!settingActorId) return;
    const cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    const actor = actorById(settingActorId);
    if (!actor) { settingActorId = null; renderAll(); return; }
    const { c, r } = parseKey(cellEl.dataset.key);
    if (actor.start && actor.start.c === c && actor.start.r === r) {
      actor.start = null;
      toast('已取消 ' + actor.name + ' 的起点');
    } else {
      actor.start = { c, r };
      const trial = simulate(state.actors, state.beats);
      const blockedN = trial.blocked.filter((b) => b.actorId === actor.id).length;
      toast('已将 ' + actor.name + ' 起点设为 (' + c + ', ' + r + ')' +
        (blockedN ? '；有 ' + blockedN + ' 个越界动作被拦截' : ''), blockedN ? 'error' : 'ok');
    }
    commit();
  }

  /* ---------------- 拍 / 播放 ---------------- */
  function gotoBeat(b) {
    const next = Math.min(Math.max(b, 0), state.beats);
    if (next === currentBeat) return;
    currentBeat = next;
    focusKey = null;
    stopPlay();
    save();
    renderAll();
  }
  function stopPlay() {
    playing = false;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
  }
  function togglePlay() {
    if (settingActorId) return;
    if (playing) { stopPlay(); renderToolbar(); return; }
    if (currentBeat === state.beats) currentBeat = 0;
    playing = true;
    renderToolbar();
    playTimer = setInterval(() => {
      if (currentBeat >= state.beats) { stopPlay(); renderToolbar(); return; }
      currentBeat += 1;
      focusKey = null;
      save();
      renderAll();
    }, 800);
  }

  /* ---------------- 演员 / 拍增删 ---------------- */
  function addActor() {
    const actor = {
      id: uid('a'),
      name: '演员' + state.nextActorNum++,
      start: null,
      moves: {}
    };
    state.actors.push(actor);
    settingActorId = actor.id;
    currentBeat = 0;
    stopPlay();
    commit();
    toast('已添加 ' + actor.name + '，请在舞台上点击格子设置起点');
  }

  function addBeat() {
    if (state.beats >= 100) { toast('最多支持 100 拍', 'error'); return; }
    state.beats += 1;
    commit(state.beats);
  }

  function removeBeat() {
    if (state.beats <= 1) { toast('至少保留 1 拍', 'error'); return; }
    const dead = state.beats;
    state.beats -= 1;
    state.actors.forEach((a) => delete a.moves[String(dead)]);
    if (currentBeat > state.beats) currentBeat = state.beats;
    commit();
  }

  /* ---------------- 冲突定位 ---------------- */
  function focusConflict(key) {
    const cf = findConflict(key);
    if (!cf) return;
    stopPlay();
    settingActorId = null;
    currentBeat = cf.beat;
    focusKey = key;
    save();
    renderAll();

    // 走位表对应格闪烁
    cf.actorIds.forEach((id) => {
      if (cf.beat === 0) return;
      const td = document.querySelector('.move-cell[data-aid="' + id + '"][data-beat="' + cf.beat + '"]');
      if (td) {
        td.classList.remove('flash');
        void td.offsetWidth; // 重置动画
        td.classList.add('flash');
        setTimeout(() => td.classList.remove('flash'), 1100);
      }
    });
    const item = document.querySelector('.conflict-item[data-cf="' + key + '"]');
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('stage').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function focusNextConflict() {
    const items = allConflicts();
    if (!items.length) { toast('当前没有冲突'); return; }
    let target = items.find((cf) => cf.beat > currentBeat) ||
      items.find((cf) => cf.beat === currentBeat && cf.key > (focusKey || '')) ||
      items[0];
    focusConflict(target.key);
  }

  /* ---------------- 导入 / 导出 / 清空 ---------------- */
  function exportJson() {
    const payload = {
      app: 'stage-blocking-tool', version: 1,
      savedAt: new Date().toISOString(),
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = 'stage-blocking-' + stamp + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state = normalizeState(parsed.state || parsed);
        currentBeat = 0;
        focusKey = null;
        stopPlay();
        commit();
        toast('导入成功：' + state.actors.length + ' 位演员，' + state.beats + ' 拍', 'ok');
      } catch (err) {
        toast('导入失败：文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm('确定清空全部演员与走位表吗？此操作只影响本浏览器的本地存档。')) return;
    state = freshState();
    currentBeat = 0;
    focusKey = null;
    settingActorId = null;
    stopPlay();
    commit();
    toast('已清空，可重新开始排练', 'ok');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('stageGrid').addEventListener('click', onStageClick);
    $('addActorBtn').addEventListener('click', addActor);
    $('addBeatBtn').addEventListener('click', addBeat);
    $('removeBeatBtn').addEventListener('click', removeBeat);
    $('prevBeat').addEventListener('click', () => gotoBeat(currentBeat - 1));
    $('nextBeat').addEventListener('click', () => gotoBeat(currentBeat + 1));
    $('playBtn').addEventListener('click', togglePlay);
    $('editStartBtn').addEventListener('click', () => {
      if (settingActorId) toggleStartSetting(settingActorId);
      else if (state.actors[0]) toggleStartSetting(state.actors[0].id);
      else toast('请先添加演员');
    });
    $('focusNextBtn').addEventListener('click', focusNextConflict);
    $('beatSlider').addEventListener('input', (e) => gotoBeat(Number(e.target.value)));
    $('exportBtn').addEventListener('click', exportJson);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });
    $('resetBtn').addEventListener('click', resetAll);

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'Escape' && settingActorId) {
        settingActorId = null;
        commit();
      } else if (e.key === 'ArrowLeft') {
        gotoBeat(currentBeat - 1);
      } else if (e.key === 'ArrowRight') {
        gotoBeat(currentBeat + 1);
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    load();
    resim();
    buildStage();
    bindEvents();
    renderAll();
    save(); // 首次访问载入的示例数据也立即落盘，刷新后即为同一份可继续编辑
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
