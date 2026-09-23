/**
 * Run with `npm test`. Node 24 strips types natively, so no build step —
 * relative imports need the explicit .ts extension for that to work.
 */
import { buildSearchPlan, narrowPlan, maxPage, windowMinutesFor, STAR_STEPS } from '../src/lib/sample.ts'
import { hashSeed, mulberry32, shuffle, randomInt } from '../src/lib/random.ts'
import { inkFor, weightFor } from '../src/lib/ink.ts'

let fails = 0
const ok = (cond: boolean, label: string) => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
}

// 1. Same seed must produce identical plans (the colophon promises this).
console.log('=== seed reproducibility ===')
for (const seed of ['7f3a2c', 'abc123', '000001']) {
  const a = buildSearchPlan(mulberry32(hashSeed(seed)), 5, 'time')
  const b = buildSearchPlan(mulberry32(hashSeed(seed)), 5, 'time')
  ok(a.q === b.q && a.sort === b.sort && a.order === b.order, `seed ${seed} -> identical plan`)
}

// 2. Different seeds must diverge.
const p1 = buildSearchPlan(mulberry32(hashSeed('aaa111')), 5, 'time')
const p2 = buildSearchPlan(mulberry32(hashSeed('bbb222')), 5, 'time')
ok(p1.q !== p2.q, 'different seeds -> different windows')

// 3. Shuffle must be seed-stable (same batch order from a shared link).
const items = Array.from({ length: 40 }, (_, i) => i)
const s1 = shuffle(items, mulberry32(hashSeed('zz9'))).join(',')
const s2 = shuffle(items, mulberry32(hashSeed('zz9'))).join(',')
ok(s1 === s2, 'shuffle is seed-stable')
ok(shuffle(items, mulberry32(hashSeed('zz9'))).length === 40, 'shuffle preserves length')
ok(new Set(shuffle(items, mulberry32(hashSeed('q1')))).size === 40, 'shuffle loses nothing')

// 4. Query format must match what the API accepts (no millis, valid range).
console.log('=== query shape ===')
const plan = buildSearchPlan(mulberry32(hashSeed('fmt001')), 5, 'time')
ok(
  /^created:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\.\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z stars:>=5$/.test(plan.q),
  `format: ${plan.q}`,
)
ok(plan.window.end.getTime() > plan.window.start.getTime(), 'window end after start')
const raw = buildSearchPlan(mulberry32(hashSeed('raw01')), 0, 'time')
ok(!raw.q.includes('stars:'), 'raw mode omits star qualifier entirely')

// 5. Windows must stay inside GitHub's lifetime.
console.log('=== window bounds over 400 seeds ===')
let tooOld = 0
let future = 0
let widest = 0
for (let i = 0; i < 400; i++) {
  const p = buildSearchPlan(
    mulberry32(hashSeed('s' + i)),
    STAR_STEPS[i % STAR_STEPS.length]!,
    i % 2 ? 'time' : 'volume',
  )
  if (p.window.start.getTime() < Date.UTC(2008, 0, 1)) tooOld++
  if (p.window.end.getTime() > Date.now()) future++
  widest = Math.max(widest, p.window.minutes)
}
ok(tooOld === 0, `no window predates GitHub (${tooOld} bad)`)
ok(future === 0, `no window reaches into the future (${future} bad)`)
console.log(`  (widest window seen: ${widest} min = ${(widest / 1440).toFixed(1)} days)`)

// 6. Narrowing must actually shrink and stay valid.
console.log('=== narrowing ===')
const wide = buildSearchPlan(mulberry32(hashSeed('nar01')), 100, 'time')
const tight = narrowPlan(wide, 100, 5000)
ok(tight.window.minutes < wide.window.minutes, `narrowed ${wide.window.minutes} -> ${tight.window.minutes} min`)
ok(tight.window.start.getTime() === wide.window.start.getTime(), 'narrowing keeps the same start')
ok(tight.q.includes('stars:>=100'), 'narrowing keeps the star floor')

// 7. Page cap must never exceed the reachable 1000.
console.log('=== 1000-result cap ===')
ok(maxPage(50000, 100) === 10, `maxPage(50000) = ${maxPage(50000, 100)} (must be 10)`)
ok(maxPage(250, 100) === 3, `maxPage(250) = ${maxPage(250, 100)}`)
ok(maxPage(0, 100) === 1, 'maxPage(0) is at least 1')
let overCap = 0
for (let i = 0; i < 200; i++) if (randomInt(mulberry32(i), 1, maxPage(999999, 100)) > 10) overCap++
ok(overCap === 0, 'random page never exceeds page 10')

// 8. Age multiplier must widen windows for old eras.
console.log('=== age-dependent star floor ===')
const old2011 = windowMinutesFor(new Date('2011-06-15'), 100)
const new2024 = windowMinutesFor(new Date('2024-06-15'), 100)
ok(new2024 > old2011, `2024 window (${new2024}) wider than 2011 (${old2011}) at stars>=100`)
ok(
  windowMinutesFor(new Date('2024-06-15'), 0) < windowMinutesFor(new Date('2024-06-15'), 100),
  'raw window narrower than curated',
)

// 9. Ink mapping must be stable and cover all four drums.
console.log('=== ink ===')
ok(inkFor('Rust') === inkFor('Rust'), 'ink is deterministic')
ok(inkFor('rust') === inkFor('Rust'), 'ink is case-insensitive')
ok(inkFor(null) === 'black', 'no language -> black')
const drums = new Set(
  ['TypeScript', 'JavaScript', 'Rust', 'C++', 'Python', 'Java', 'HTML', 'Go', 'Ruby', 'Shell'].map(inkFor),
)
ok(drums.size === 4, `common languages spread across all 4 drums (got ${drums.size})`)
ok(weightFor(0) === 1 && weightFor(5000) === 4, 'weight scales with stars')

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
