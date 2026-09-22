// 零依赖冒烟测试：直接验证核心推演逻辑
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { simulate, normalizeState, buildReport, normalizeReport, DIRS, cellKey } = require('../public/app.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  ✓ ' + msg); }
  else { failed += 1; console.error('  ✗ ' + msg); }
}

console.log('1) 基本移动（上/下/左/右/原地）');
{
  const actors = [{
    id: 'a', name: 'A', start: { c: 4, r: 3 },
    moves: { '1': 'U', '2': 'R', '3': 'D', '4': 'L', '5': 'S' }
  }];
  const r = simulate(actors, 5);
  assert(r.positions[1].a === cellKey(4, 4), '上：r+1 → (4,4)');
  assert(r.positions[2].a === cellKey(5, 4), '右：c+1 → (5,4)');
  assert(r.positions[3].a === cellKey(5, 3), '下：r-1 → (5,3)');
  assert(r.positions[4].a === cellKey(4, 3), '左：c-1 → (4,3)');
  assert(r.positions[5].a === cellKey(4, 3), '原地：保持 (4,3)');
  assert(r.blocked.length === 0 && r.collisions.length === 0 && r.swaps.length === 0, '无冲突');
}

console.log('2) 越界拦截：原地不动并记录 blocked');
{
  const actors = [{
    id: 'a', name: 'A', start: { c: 8, r: 1 },
    moves: { '1': 'R', '2': 'D', '3': 'L' }
  }];
  const r = simulate(actors, 3);
  assert(r.blocked.length === 2, '记录 2 次越界');
  assert(r.blocked[0].beat === 1 && r.blocked[0].dir === 'R', '第 1 拍向右越界');
  assert(r.blocked[1].beat === 2 && r.blocked[1].dir === 'D', '第 2 拍向下越界');
  assert(r.positions[1].a === cellKey(8, 1), '拦截后原地 (8,1)');
  assert(r.positions[2].a === cellKey(8, 1), '再次拦截仍在 (8,1)');
  assert(r.positions[3].a === cellKey(7, 1), '第 3 拍向左成功 → (7,1)');
}

console.log('3) 同拍同格碰撞');
{
  const actors = [
    { id: 'a', name: 'A', start: { c: 2, r: 2 }, moves: { '1': 'R' } },
    { id: 'b', name: 'B', start: { c: 4, r: 2 }, moves: { '1': 'L' } }
  ];
  const r = simulate(actors, 1);
  assert(r.collisions.length === 1, '1 起碰撞');
  assert(r.collisions[0].beat === 1, '碰撞发生在第 1 拍');
  assert(r.collisions[0].key === cellKey(3, 2), '碰撞格 (3,2)');
  assert(r.collisions[0].ids.includes('a') && r.collisions[0].ids.includes('b'), '双方均在冲突记录中');
}

console.log('4) 相邻两拍互换格子（不算碰撞）');
{
  const actors = [
    { id: 'a', name: 'A', start: { c: 3, r: 2 }, moves: { '1': 'R' } },
    { id: 'b', name: 'B', start: { c: 4, r: 2 }, moves: { '1': 'L' } }
  ];
  const r = simulate(actors, 1);
  assert(r.swaps.length === 1, '识别 1 次互换');
  assert(r.swaps[0].beat === 1, '互换发生在第 1 拍');
  assert(r.swaps[0].keyA === cellKey(4, 2) && r.swaps[0].keyB === cellKey(3, 2), '互换两个格子正确');
  assert(r.collisions.length === 0, '互换不计为同拍碰撞');
}

console.log('5) 起点同格也算碰撞（第 0 拍）');
{
  const actors = [
    { id: 'a', name: 'A', start: { c: 1, r: 1 }, moves: {} },
    { id: 'b', name: 'B', start: { c: 1, r: 1 }, moves: {} }
  ];
  const r = simulate(actors, 1);
  assert(r.collisions.some((c) => c.beat === 0), '第 0 拍起点碰撞被标出');
}

console.log('6) 未设起点的演员不参与推演');
{
  const actors = [
    { id: 'a', name: 'A', start: null, moves: { '1': 'U' } },
    { id: 'b', name: 'B', start: { c: 1, r: 1 }, moves: {} }
  ];
  const r = simulate(actors, 1);
  assert(r.positions[1].a === undefined && r.positions[1].b === cellKey(1, 1), '无起点演员被忽略');
  assert(r.blocked.length === 0, '无越界记录');
}

console.log('7) 数据规整 normalizeState');
{
  const s = normalizeState({
    beats: 200, // 超限 → 4
    actors: [
      { name: '', start: { c: 99, r: 2 }, moves: { '1': 'X', '9': 'U' } },
      { name: '乙', start: { c: '2', r: '3' }, moves: { '1': 'up' } }
    ]
  });
  assert(s.beats === 4, '非法拍数回退为 4');
  assert(s.actors[0].start === null, '越界起点被清除');
  assert(Object.keys(s.actors[0].moves).length === 0, '非法/超范围动作被清除');
  assert(s.actors[0].name === '演员', '空名称回退');
  assert(s.actors[1].start.c === 2 && s.actors[1].start.r === 3, '数字字符串起点被接受');
}

console.log('8) buildReport 只读快照：逐拍坐标/动作与冲突汇总');
{
  const demo = {
    beats: 2,
    nextActorNum: 5,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 3, r: 2 }, moves: { '1': 'R', '2': 'S' } },
      { id: 'b', name: '阿乙', start: { c: 4, r: 2 }, moves: { '1': 'L', '2': 'L' } },
      { id: 'd', name: '阿丁', start: { c: 8, r: 6 }, moves: { '1': 'R', '2': 'U' } }
    ]
  };
  const rpt = buildReport({ state: demo, title: '彩排一' });

  assert(rpt.app === 'stage-blocking-report' && rpt.version === 1, '带应用标识与版本号');
  assert(rpt.title === '彩排一', '标题被采用');
  assert(rpt.fromBeat === 0 && rpt.toBeat === 2, '默认范围 0..2');
  assert(rpt.actorIds.length === 3, '默认包含全部 3 位演员');

  // 逐拍记录：3 个拍次，每拍每人一行
  assert(rpt.beats.length === 3, '逐拍记录含起点 + 2 拍');
  const beat0 = rpt.beats.find((x) => x.beat === 0);
  const rowA0 = beat0.rows.find((x) => x.actorId === 'a');
  assert(rowA0.coord === '3-2' && rowA0.move === null, '起点拍：坐标 3-2，move 为 null');

  const beat1 = rpt.beats.find((x) => x.beat === 1);
  const rowA1 = beat1.rows.find((x) => x.actorId === 'a');
  assert(rowA1.coord === '4-2' && rowA1.move === 'R', '第 1 拍：阿甲右移到 4-2，动作 R');
  assert(rowA1.marks.includes('swap'), '阿甲第 1 拍被标记为互换');
  const rowD1 = beat1.rows.find((x) => x.actorId === 'd');
  assert(rowD1.blocked === true, '阿丁第 1 拍向右越界被拦截');
  assert(rowD1.coord === '8-6', '越界后坐标仍为 8-6（原地）');

  // 第 2 拍阿乙到 3-2，阿甲在 4-2 —— 无冲突
  const beat2 = rpt.beats.find((x) => x.beat === 2);
  assert(beat2.collisionCount === 0 && beat2.swapCount === 0 && beat2.blockedCount === 1,
    '第 2 拍仅 1 起越界');
  const rowB2 = beat2.rows.find((x) => x.actorId === 'b');
  assert(rowB2.coord === '2-2' && rowB2.move === 'L', '第 2 拍：阿乙再左移到 2-2');

  // 冲突汇总：1 互换（beat 1）+ 2 越界（d 在 1、2 拍），排序按拍/类型
  assert(rpt.counts.total === 3, '冲突总数 3');
  assert(rpt.counts.swap === 1 && rpt.counts.blocked === 2 && rpt.counts.collision === 0,
    '互换 1、越界 2、同格 0');
  const kinds = rpt.conflicts.map((c) => c.beat + ':' + c.kind);
  assert(kinds[0] === '1:swap' && kinds[1] === '1:blocked' && kinds[2] === '2:blocked',
    '冲突按拍次、类型排序');
  const swapCf = rpt.conflicts[0];
  assert(swapCf.key.indexOf('swp-1-') === 0, '互换条目带跳转键');
  assert(swapCf.key === 'swp-1-a-b', '互换键按演员 id 排序（与实时 UI 一致）');
  assert(swapCf.cells.length === 2, '互换条目记录两个格子');
  assert(typeof swapCf.text === 'string' && swapCf.text.length > 0, '冲突条目含描述文本');
  const blkCf = rpt.conflicts.find((c) => c.kind === 'blocked');
  assert(blkCf.key === 'blk-1-d', '越界键为 blk-拍-演员id（与实时 UI 一致）');

  // source 为生成时快照
  assert(rpt.source.actors.length === 3 && rpt.source.beats === 2, '内嵌生成时走位快照');
}

console.log('9) 报告范围与演员筛选');
{
  const demo = {
    beats: 3,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 1, r: 1 }, moves: { '1': 'U', '2': 'U', '3': 'U' } },
      { id: 'b', name: '阿乙', start: { c: 2, r: 1 }, moves: { '1': 'U', '2': 'U', '3': 'U' } },
      { id: 'c', name: '阿丙', start: null, moves: { '1': 'U' } }
    ]
  };
  const rpt = buildReport({ state: demo, actorIds: ['a', 'c', '不存在'], fromBeat: 1, toBeat: 2 });
  assert(rpt.actorIds.length === 2, '演员筛选：保留存在的 2 位（忽略未知 id）');
  assert(rpt.fromBeat === 1 && rpt.toBeat === 2, '拍次范围生效');
  assert(rpt.beats.every((b) => b.beat >= 1 && b.beat <= 2), '逐拍记录只含所选范围');
  const rowC = rpt.beats[0].rows.find((x) => x.actorId === 'c');
  assert(rowC.coord === null && rowC.move === 'U' && !rowC.blocked,
    '无起点演员：坐标为 null、动作仍列出、不参与推演');

  // 筛选口径一致：同格中未被选择的演员不进入报告，已选者也不再被标同格
  const collide = {
    beats: 1,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 2, r: 2 }, moves: { '1': 'R' } },
      { id: 'b', name: '阿乙', start: { c: 4, r: 2 }, moves: { '1': 'L' } }
    ]
  };
  const onlyA = buildReport({ state: collide, actorIds: ['a'], fromBeat: 1, toBeat: 1 });
  assert(onlyA.actors.length === 1, '只选阿甲：报告仅 1 人');
  assert(onlyA.counts.collision === 1, '只选阿甲：仍记录与阿乙的同格冲突');
  assert(onlyA.conflicts[0].actors.join('、') === '阿甲、阿乙', '冲突保留全部当事人姓名');
  assert(onlyA.beats[0].rows[0].marks.includes('collision'), '只选阿甲：阿甲行标记同格');
  assert(onlyA.beats[0].collisionCount === 1, '只选阿甲：本拍同格计数为 1');
  assert(onlyA.conflicts[0].key === 'col-1-' + cellKey(3, 2), '跳转键仍按格子生成');

  // from > to 自动交换；空选择回退为全部
  const rpt2 = buildReport({ state: demo, actorIds: [], fromBeat: 2, toBeat: 1 });
  assert(rpt2.fromBeat === 1 && rpt2.toBeat === 2, '起止拍反转时自动交换');
  assert(rpt2.actorIds.length === 3, '空演员选择回退为全部');
}

console.log('10) 同格冲突进入报告');
{
  const demo = {
    beats: 1,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 2, r: 2 }, moves: { '1': 'R' } },
      { id: 'b', name: '阿乙', start: { c: 4, r: 2 }, moves: { '1': 'L' } }
    ]
  };
  const rpt = buildReport({ state: demo });
  const col = rpt.conflicts.filter((c) => c.kind === 'collision');
  assert(col.length === 1 && col[0].beat === 1, '同格冲突 1 起，在第 1 拍');
  assert(col[0].cells[0] === '3-2', '冲突格显示为 3-2');
  assert(col[0].key === 'col-1-' + cellKey(3, 2), '同格跳转键与实时 UI 一致（col-拍-c,r）');
  assert(col[0].actors.join('、') === '阿甲、阿乙', '冲突双方姓名齐全');
  const row = rpt.beats.find((b) => b.beat === 1).rows[0];
  assert(row.marks.includes('collision'), '逐拍行带同格标记');
}

console.log('11) 快照隔离：生成后修改走位不影响报告');
{
  const demo = {
    beats: 1,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 1, r: 1 }, moves: { '1': 'U' } },
      { id: 'b', name: '阿乙', start: { c: 2, r: 1 }, moves: { '1': 'U' } }
    ]
  };
  const live = normalizeState(demo);
  const rpt = buildReport({ state: live });
  const snap = JSON.stringify(rpt);

  // 生成后大幅修改走位
  live.actors[0].start = { c: 8, r: 6 };
  live.actors[0].moves[1] = 'D';
  live.actors[1].name = '改名演员';
  live.beats = 2;

  assert(JSON.stringify(rpt) === snap, '走位变化后报告对象完全不变');
  assert(rpt.source.actors[0].start.c === 1, '内嵌快照仍是生成时的起点');
  assert(rpt.source.actors[1].name === '阿乙', '内嵌快照姓名不变');
  assert(rpt.source.beats === 1, '内嵌快照拍数不变');

  // normalizeReport 往返后内容保持一致（存档读取路径）
  const again = normalizeReport(JSON.parse(JSON.stringify(rpt)));
  assert(again !== null && again.id === rpt.id && again.title === rpt.title, '规整后保留 id/标题');
  assert(again.beats.length === rpt.beats.length, '规整后逐拍记录数量一致');
  assert(again.conflicts.length === rpt.conflicts.length, '规整后冲突数量一致');
  assert(again.source && again.source.actors.length === 2, '规整后保留内嵌快照');
}

console.log('12) normalizeReport 丢弃坏数据');
{
  assert(normalizeReport(null) === null, 'null 被拒');
  assert(normalizeReport({ app: 'other' }) === null, '非本应用数据被拒');
  assert(normalizeReport({ app: 'stage-blocking-report', fromBeat: 2, toBeat: 1 }) === null,
    '范围非法被拒');
  assert(normalizeReport({
    app: 'stage-blocking-report', fromBeat: 0, toBeat: 1, actors: []
  }) === null, '无演员被拒');

  const good = buildReport({ state: { beats: 1, actors: [
    { id: 'a', name: '甲', start: { c: 1, r: 1 }, moves: { '1': 'U' } }
  ] } });
  const raw = JSON.parse(JSON.stringify(good));
  raw.conflicts.push({ kind: 'weird', beat: 0, actorIds: ['a'] }); // 坏类型
  raw.conflicts.push({ kind: 'collision', beat: 9, actorIds: ['a'] }); // 超范围
  raw.beats[0].rows.push({ actorId: 'ghost', coord: '9-9' }); // 未知演员
  raw.beats[0].rows[0].coord = 'badcoord'; // 坏坐标
  const fixed = normalizeReport(raw);
  assert(fixed.conflicts.length === good.conflicts.length, '非法冲突条目被丢弃');
  const keptRow = fixed.beats[0].rows.find((x) => x.actorId === 'a');
  assert(keptRow.coord === null, '坏坐标归零为 null');
  assert(!fixed.beats.some((b) => b.rows.some((r) => r.actorId === 'ghost')), '未知演员行被丢弃');
}

console.log('');
if (failed) {
  console.error(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}
console.log(`结果: ${passed} 全部通过 🎉`);
