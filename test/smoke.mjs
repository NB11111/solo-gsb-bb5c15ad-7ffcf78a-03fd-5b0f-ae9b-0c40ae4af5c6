// 零依赖冒烟测试：直接验证核心推演逻辑
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { simulate, normalizeState, cellKey } = require('../public/app.js');

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

console.log('');
if (failed) {
  console.error(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}
console.log(`结果: ${passed} 全部通过 🎉`);
