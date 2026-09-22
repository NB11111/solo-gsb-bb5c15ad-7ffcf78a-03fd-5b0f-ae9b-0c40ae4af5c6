// 零依赖冒烟测试：直接验证核心推演逻辑
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  simulate, normalizeState, cellKey,
  buildReport, fingerprintState, normalizeReport
} = require('../public/app.js');

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

console.log('8) buildReport：逐拍坐标与动作、冲突汇总');
{
  const state = {
    beats: 2,
    actors: [
      { id: 'a', name: '阿甲', start: { c: 3, r: 2 }, moves: { '1': 'R', '2': 'S' } },
      { id: 'b', name: '阿乙', start: { c: 4, r: 2 }, moves: { '1': 'L', '2': 'S' } }
    ]
  };
  const simR = simulate(state.actors, 2);
  const rpt = buildReport(state, simR, { fromBeat: 0, toBeat: 2, now: new Date('2026-09-22T10:30:00') });
  assert(rpt.type === 'rehearsal-report' && rpt.version === 1, '报告类型与版本正确');
  assert(rpt.beatRows.length === 3, '逐拍行数 = 起点+2 拍 = 3');
  const beat1 = rpt.beatRows.find((x) => x.beat === 1);
  const rowA = beat1.rows.find((x) => x.actorId === 'a');
  const rowB = beat1.rows.find((x) => x.actorId === 'b');
  assert(rowA.pos === cellKey(4, 2) && rowA.move.dir === 'R', '阿甲第 1 拍：动作 R，拍末 (4,2)');
  assert(rowB.pos === cellKey(3, 2) && rowB.move.dir === 'L', '阿乙第 1 拍：动作 L，拍末 (3,2)');
  assert(rowA.swap && rowB.swap, '互换双方行内均标记 swap');
  const beat0 = rpt.beatRows.find((x) => x.beat === 0);
  assert(beat0.rows[0].move === null, '第 0 拍无动作字段');
  assert(beat0.rows[0].pos === cellKey(3, 2), '第 0 拍坐标即起点');
  assert(rpt.summary.swap === 1 && rpt.summary.total === 1, '汇总 1 次互换');
  assert(rpt.conflicts[0].kind === 'swap' && rpt.conflicts[0].beat === 1, '冲突条目为第 1 拍互换');
  assert(rpt.rangeText.indexOf('起点') === 0 && rpt.createdText === '2026-09-22 10:30', '范围文案与快照时间正确');
  assert(rpt.actors.length === 2, '默认纳入全部演员');
}

console.log('9) buildReport：拍次范围与演员筛选');
{
  const state = {
    beats: 3,
    actors: [
      { id: 'a', name: 'A', start: { c: 2, r: 2 }, moves: { '1': 'R', '2': 'R', '3': 'R' } },
      { id: 'b', name: 'B', start: { c: 4, r: 2 }, moves: { '1': 'S', '2': 'S', '3': 'L' } },
      { id: 'c', name: 'C', start: { c: 8, r: 1 }, moves: { '1': 'R', '2': 'S', '3': 'S' } }
    ]
  };
  const simR = simulate(state.actors, 3);
  // 只选 A、B，范围 2–3：第 1 拍相邻未冲突、C 的越界不收录；第 2 拍 A、B 同格 (4,2)
  const rpt = buildReport(state, simR, { actorIds: ['a', 'b'], fromBeat: 2, toBeat: 3 });
  assert(rpt.actors.length === 2 && rpt.actors[0].id === 'a', '入选演员按 state 顺序为 A、B');
  assert(rpt.beatRows.every((x) => x.beat >= 2 && x.beat <= 3), '逐拍只含 2–3 拍');
  assert(rpt.beatRows.every((x) => x.rows.length === 2), '每行只有 A、B 两人');
  assert(rpt.conflicts.every((c) => c.beat >= 2), '冲突不含范围外拍次');
  assert(!rpt.conflicts.some((c) => c.kind === 'swap'), '第 1 拍无互换（B 原地）');
  assert(!rpt.conflicts.some((c) => c.actorIds.includes('c') || c.kind === 'blocked'), '未入选演员的越界不收录');
  assert(rpt.summary.collision === 1 && rpt.conflicts[0].beat === 2 &&
    rpt.conflicts[0].cellKeys[0] === cellKey(4, 2), '第 2 拍同格 (4,2) 被收录');
  // 范围反转自动交换
  const swapped = buildReport(state, simR, { fromBeat: 3, toBeat: 1 });
  assert(swapped.range.fromBeat === 1 && swapped.range.toBeat === 3, '反转范围自动纠正为 1–3');
  // 越界条目随筛选生效
  const onlyC = buildReport(state, simR, { actorIds: ['c'], fromBeat: 1, toBeat: 1 });
  assert(onlyC.summary.blocked === 1 && onlyC.beatRows[0].rows[0].move.blocked === true,
    '只选 C 时收录其第 1 拍越界并在行内标记');
}

console.log('10) 报告快照不受生成后的走位编辑影响');
{
  const state = {
    beats: 2,
    actors: [{ id: 'a', name: 'A', start: { c: 1, r: 1 }, moves: { '1': 'R' } }]
  };
  const snapshot = buildReport(state, simulate(state.actors, 2), { fromBeat: 0, toBeat: 2 });
  const json = JSON.stringify(snapshot);

  // 生成后大幅修改走位（模拟「悄悄改变快照」的反例）
  state.beats = 5;
  state.actors[0].name = '改名了';
  state.actors[0].start = { c: 8, r: 6 };
  state.actors[0].moves = { '1': 'L', '2': 'U', '3': 'D' };
  state.actors.push({ id: 'b', name: 'B', start: null, moves: {} });

  assert(JSON.stringify(snapshot) === json, '快照对象未被后续编辑修改');
  const row = snapshot.beatRows.find((x) => x.beat === 1).rows[0];
  assert(row.pos === cellKey(2, 1) && row.move.dir === 'R' && row.name === 'A',
    '快照逐拍仍是生成时坐标/动作/姓名');
  assert(snapshot.totalBeats === 2 && snapshot.actors.length === 1, '快照拍数与演员名单冻结');
  const newFp = fingerprintState(state);
  assert(snapshot.fingerprint !== newFp, '走位变更后指纹与快照不一致（可提示用户）');
}

console.log('11) fingerprintState 稳定性与 normalizeReport 校验');
{
  const state1 = {
    beats: 2,
    actors: [{ id: 'a', name: 'A', start: { c: 1, r: 1 }, moves: { '1': 'R' } }]
  };
  const state2 = JSON.parse(JSON.stringify(state1));
  assert(fingerprintState(state1) === fingerprintState(state2), '相同走位指纹一致');
  state2.actors[0].moves['1'] = 'L';
  assert(fingerprintState(state1) !== fingerprintState(state2), '动作改变指纹变化');
  const state3 = JSON.parse(JSON.stringify(state1));
  state3.actors[0].name = '阿甲';
  assert(fingerprintState(state1) !== fingerprintState(state3), '改名也算走位变更');

  const rpt = buildReport(state1, simulate(state1.actors, 2), {});
  assert(normalizeReport(JSON.parse(JSON.stringify(rpt))), '合法报告通过校验');
  assert(normalizeReport(null) === null, 'null 报告被拒');
  assert(normalizeReport({ type: 'other' }) === null, '类型错误被拒');
  assert(normalizeReport({ type: 'rehearsal-report', createdAt: 'x' }) === null, '形状缺失被拒');
}

console.log('');
if (failed) {
  console.error(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}
console.log(`结果: ${passed} 全部通过 🎉`);
