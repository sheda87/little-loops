/* Little Loops: animated stitch diagrams.

   How it works, in plain words:
   - Each animation is a list of "poses". A pose says where the hook is, which loops are on it,
     and where the yarn runs. The player smoothly moves from one pose to the next.
   - Loops on the hook ("rings") are drawn so the hook passes through them: the half of the
     ring nearest the tip is drawn over the hook and the rest behind it.
   - Everything takes its colors from the theme variables in styles.css, so the diagrams change
     with the season.

   Public API (used by app.js):  LLAnim.has(id)  and  LLAnim.mount(host, id, options)
*/
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const VW = 360;
  const VH = 200;

  /* ---------------- small helpers ---------------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const r1 = (n) => Math.round(n * 10) / 10;
  const COLORS = {
    accent: 'var(--accent)', mid: 'var(--mid)', edge: 'var(--edge)', bar: 'var(--bar)',
    ink: 'var(--ink)', paper: 'var(--paper)', soft: 'var(--soft)', warm: 'var(--warm)', muted: 'var(--muted)',
  };

  // A point fixed to the hook: d = distance back from the tip, o = offset to the side.
  const H = (d, o = 0) => ({ h: 1, d, o });
  // Points around an ellipse (closed loop of yarn).
  const E = (cx, cy, rx, ry, n = 8, rot = 0) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      const x = rx * Math.cos(a);
      const y = ry * Math.sin(a);
      return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
    });

  const toWorld = (hk, d, o) => {
    const a = (hk.r * Math.PI) / 180;
    return [hk.x + d * Math.cos(a) - o * Math.sin(a), hk.y + d * Math.sin(a) + o * Math.cos(a)];
  };
  const resolvePts = (specs, hk) => specs.map((p) => (Array.isArray(p) ? p : toWorld(hk, p.d, p.o)));

  function resample(pts, n) {
    if (pts.length === n) return pts;
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1] || 1;
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = (total * k) / (n - 1);
      let i = 1;
      while (i < len.length - 1 && len[i] < t) i++;
      const seg = len[i] - len[i - 1] || 1;
      const u = clamp01((t - len[i - 1]) / seg);
      out.push([lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]);
    }
    return out;
  }
  function lerpPts(a, b, t) {
    const n = Math.max(a.length, b.length);
    const A = resample(a, n);
    const B = resample(b, n);
    return A.map((p, i) => [lerp(p[0], B[i][0], t), lerp(p[1], B[i][1], t)]);
  }

  // Smooth curve through points (Catmull-Rom turned into Beziers).
  function smooth(pts, closed) {
    const n = pts.length;
    if (n < 2) return '';
    const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);
      d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return closed ? d + 'Z' : d;
  }

  /* ================================================================
     Scene vocabulary (shared by all stitches)
     ================================================================ */
  const TX = 124; // x of the stitch we work into
  const RY = 158; // y of the top of the previous row
  const RING_RY = 8.5; // loops on the hook
  const READY = { x: 150, y: 92, r: -20 };
  const INS = { x: TX + 2, y: 156, r: -50 };
  const NEXT = { x: 96, y: 92, r: -20 };
  const along = (hk, d) => {
    const a = (hk.r * Math.PI) / 180;
    return { x: hk.x + Math.cos(a) * d, y: hk.y + Math.sin(a) * d, r: hk.r };
  };

  const merge = (...sets) => {
    const out = {};
    for (const s of sets) for (const k in s) out[k] = { ...(out[k] || {}), ...s[k] };
    return out;
  };
  const ringSet = (id, d, o = 1, extra = {}) => ({ [id]: { d, o, ...extra } });
  const hookSet = (hk) => ({ hook: { x: hk.x, y: hk.y, r: hk.r } });
  // The working yarn leaves from a loop on the hook and runs off to the right.
  const yarnFrom = (d) => ({ w: { pts: [H(d, RING_RY), [232, 114], [296, 132], [368, 130]] } });
  // The loop of yarn pulled up through the stitch, between two loops on the hook.
  const pulled = (dFrom, dTo, o = 1, x = TX) => ({ bt: { pts: [H(dFrom, RING_RY), [x, RY - 1], H(dTo, RING_RY)], o } });
  const P = (cap, step, set, move = 1500, hold = 900) => ({ cap, step, set, move, hold });

  function ringItems(ids) {
    return ids.map((id) => ({ kind: 'ring', id, color: 'accent', w: 4.2, init: { d: 36, o: 0 } }));
  }

  // The top of the previous row: each stitch has a back loop and a front loop.
  function fabric(targets) {
    const items = [{ kind: 'rect', x: 10, y: RY + 10, w: 340, h: 40, rx: 12, fill: 'edge', op: 0.3 }];
    for (const x of [44, 84, 124, 164, 204, 244, 284, 324]) {
      const t = targets.find((q) => q.x === x);
      items.push({ kind: 'strand', id: t && t.id + 'b', layer: 'behind', color: 'edge', w: 4, closed: true, init: { pts: E(x, RY - 3, 12, 6), o: 1 } });
      items.push({ kind: 'strand', id: t && t.id + 'f', layer: 'behind', color: 'mid', w: 4, closed: true, init: { pts: E(x, RY + 3, 12, 6), o: 1 } });
      if (t) {
        items.push({ kind: 'strand', id: t.id + 'bo', layer: 'front', color: 'edge', w: 4, closed: true, init: { pts: E(x, RY - 3, 12, 6), o: 0 } });
        items.push({ kind: 'strand', id: t.id + 'fo', layer: 'front', color: 'mid', w: 4, closed: true, init: { pts: E(x, RY + 3, 12, 6), o: 0 } });
      }
    }
    return items;
  }
  // Both loops (or just the front loop) cross over the hook while it is in the stitch.
  const under = (id, both, o) => merge({ [id + 'fo']: { o } }, both ? { [id + 'bo']: { o } } : {});

  // A finished stitch standing on the row: a post with its top loop.
  function finished(id, x, h, wide = 12, lean = 0) {
    const topx = x + lean;
    return [
      { kind: 'strand', id: id + 'p', layer: 'behind', color: 'accent', w: 5, init: { pts: [[x, RY - 4], [(x + topx) / 2, RY - 4 - h / 2], [topx, RY - 4 - h]], o: 0 } },
      { kind: 'strand', id: id + 't', layer: 'behind', color: 'accent', w: 4.4, closed: true, init: { pts: E(topx, RY - 4 - h, wide, 6), o: 0 } },
    ];
  }
  const show = (id, o = 1) => ({ [id + 'p']: { o }, [id + 't']: { o } });

  const base = (extra) => [
    ...extra,
    { kind: 'strand', id: 'bt', layer: 'behind', color: 'accent', w: 4.2, init: { pts: [H(38, RING_RY), [TX, RY - 1], H(8, RING_RY)], o: 0 } },
    { kind: 'strand', id: 'w', layer: 'front', color: 'accent', w: 4.4, init: { pts: yarnFrom(36).w.pts, o: 1 } },
  ];

  /* ================================================================
     The animations
     ================================================================ */
  const SCENES = {};

  // ---------- chain ----------
  SCENES.chain = () => {
    const links = [40, 66, 92].map((x) => ({ kind: 'strand', layer: 'behind', color: 'accent', w: 4.2, closed: true, init: { pts: E(x, 118, 17, 9), o: 1 } }));
    const hk0 = { x: 142, y: 90, r: -18 };
    const connSpec = (dd) => [H(dd, RING_RY), [150, 104], [104, 114]];
    return {
      items: [
        ...links,
        { kind: 'strand', id: 'lk', layer: 'behind', color: 'accent', w: 4.2, closed: true, init: { pts: E(118, 118, 17, 9), o: 0 } },
        { kind: 'strand', id: 'conn', layer: 'behind', color: 'accent', w: 4.2, init: { pts: connSpec(36), o: 1 } },
        ...ringItems(['a', 'b']),
        { kind: 'strand', id: 'w', layer: 'front', color: 'accent', w: 4.4, init: { pts: yarnFrom(36).w.pts, o: 1 } },
        { kind: 'hook', id: 'hook', init: hk0 },
      ],
      poses: [
        P('Start with 1 loop on the hook.', null, merge(ringSet('a', 36)), 0, 1400),
        P('Yarn over: wrap the yarn over the hook from back to front.', 0, merge(ringSet('b', 6), yarnFrom(6)), 1000, 1000),
        P('Pull the yarn through the loop. That makes one chain.', 1,
          merge(ringSet('a', -18, 0, { dl: 0.0 }), ringSet('b', 36), yarnFrom(36), { lk: { o: 1, dl: 0.35 }, conn: { pts: [H(36, RING_RY), [148, 106], [124, 114]] } }), 1900, 1500),
        P('Repeat for as many chains as your pattern asks for. Never count the loop on the hook.', 2, merge(hookSet({ x: 150, y: 90, r: -18 })), 900, 1800),
      ],
    };
  };

  // ---------- slip stitch ----------
  SCENES.slst = () => ({
    items: [
      ...fabric([{ id: 't', x: TX }]),
      ...finished('s', TX, 6, 9),
      ...base(ringItems(['a', 'b'])),
      { kind: 'hook', id: 'hook', init: READY },
    ],
    poses: [
      P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
      P('Put the hook into the stitch.', 0, merge(hookSet(INS), under('t', true, 1)), 1800, 900),
      P('Yarn over.', 1, merge(ringSet('b', 6), yarnFrom(6)), 900, 800),
      P('Pull the yarn through the stitch and through the loop on the hook, in one motion.', 1,
        merge(hookSet(along(INS, 46)), ringSet('a', 36 - 46), pulled(-10, 6, 0.0), under('t', true, 0), yarnFrom(6)), 1800, 1000),
      P('One slip stitch done. It is short and flat, with 1 loop left on the hook.', 1,
        merge(ringSet('a', -10, 0), ringSet('b', 36), yarnFrom(36), show('s'), hookSet(NEXT)), 1800, 1800),
    ],
  });

  // ---------- single crochet ----------
  SCENES.sc = () => ({
    items: [
      ...fabric([{ id: 't', x: TX }]),
      ...finished('f', TX, 14),
      ...base(ringItems(['a', 'b', 'c'])),
      { kind: 'hook', id: 'hook', init: READY },
    ],
    poses: [
      P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
      P('Put the hook into the next stitch, under both loops of the V.', 0, merge(hookSet(INS), under('t', true, 1)), 1800, 900),
      P('Yarn over.', 1, merge(ringSet('b', 6), yarnFrom(6)), 900, 800),
      P('Pull up a loop through the stitch. You now have 2 loops on the hook.', 1,
        merge(hookSet(along(INS, 26)), ringSet('b', 16), pulled(36, 16), under('t', true, 0), yarnFrom(16)), 1700, 1400),
      P('Yarn over again.', 2, merge(ringSet('c', 5), yarnFrom(5)), 900, 800),
      P('Pull the yarn through both loops.', 2,
        merge(hookSet(along(INS, 26 + 46)), ringSet('a', 36 - 46), ringSet('b', 16 - 46), pulled(36 - 46, 16 - 46)), 1800, 1000),
      P('One single crochet done, with 1 loop on the hook.', 2,
        merge(ringSet('a', -10, 0), ringSet('b', -30, 0), ringSet('c', 36), pulled(-10, -30, 0), show('f'), yarnFrom(36), hookSet(NEXT)), 1800, 1800),
    ],
  });

  // ---------- half double crochet ----------
  SCENES.hdc = () => ({
    items: [
      ...fabric([{ id: 't', x: TX }]),
      ...finished('f', TX, 24),
      ...base(ringItems(['a', 'b', 'c', 'x'])),
      { kind: 'hook', id: 'hook', init: READY },
    ],
    poses: [
      P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
      P('Yarn over.', 0, merge(ringSet('b', 6), yarnFrom(6)), 900, 800),
      P('Put the hook into the next stitch.', 0,
        merge(hookSet(INS), ringSet('b', 12), ringSet('a', 38), under('t', true, 1), yarnFrom(12)), 1800, 900),
      P('Yarn over again.', 1, merge(ringSet('c', 5), ringSet('b', 20), ringSet('a', 40), yarnFrom(5)), 900, 800),
      P('Pull up a loop through the stitch. You now have 3 loops on the hook.', 1,
        merge(hookSet(along(INS, 26)), ringSet('c', 8), ringSet('b', 22), pulled(22, 8), under('t', true, 0), yarnFrom(8)), 1700, 1500),
      P('Yarn over.', 2, merge(ringSet('x', 4), ringSet('c', 16), ringSet('b', 28), yarnFrom(4)), 900, 800),
      P('Pull the yarn through all 3 loops.', 2,
        merge(hookSet(along(INS, 26 + 56)), ringSet('a', 40 - 56), ringSet('b', 28 - 56), ringSet('c', 16 - 56), pulled(28 - 56, 16 - 56)), 1900, 1000),
      P('One half double crochet done, with 1 loop on the hook.', 2,
        merge(ringSet('a', -16, 0), ringSet('b', -28, 0), ringSet('c', -40, 0), pulled(-28, -40, 0), ringSet('x', 36), show('f'), yarnFrom(36), hookSet(NEXT)), 1800, 1800),
    ],
  });

  // ---------- double crochet ----------
  SCENES.dc = () => ({
    items: [
      ...fabric([{ id: 't', x: TX }]),
      ...finished('f', TX, 36),
      ...base(ringItems(['a', 'b', 'c', 'x', 'y'])),
      { kind: 'hook', id: 'hook', init: READY },
    ],
    poses: [
      P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
      P('Yarn over.', 0, merge(ringSet('b', 6), yarnFrom(6)), 900, 800),
      P('Put the hook into the next stitch.', 0,
        merge(hookSet(INS), ringSet('b', 12), ringSet('a', 38), under('t', true, 1), yarnFrom(12)), 1800, 900),
      P('Yarn over again.', 1, merge(ringSet('c', 5), ringSet('b', 20), ringSet('a', 40), yarnFrom(5)), 900, 800),
      P('Pull up a loop through the stitch. You now have 3 loops on the hook.', 1,
        merge(hookSet(along(INS, 26)), ringSet('c', 8), ringSet('b', 22), pulled(22, 8), under('t', true, 0), yarnFrom(8)), 1700, 1500),
      P('Yarn over.', 2, merge(ringSet('x', 4), ringSet('c', 16), ringSet('b', 28), yarnFrom(4)), 900, 800),
      P('Pull through the first 2 loops. You now have 2 loops on the hook.', 2,
        merge(hookSet(along(INS, 26 + 34)), ringSet('b', 28 - 34), ringSet('c', 16 - 34)), 1700, 900),
      P('Two loops left on the hook.', 2,
        merge(ringSet('b', -6, 0), ringSet('c', -18, 0), pulled(22 - 34, 8 - 34, 0), ringSet('x', 20), yarnFrom(20)), 1100, 1100),
      P('Yarn over.', 3, merge(ringSet('y', 4), ringSet('x', 22), ringSet('a', 40), yarnFrom(4)), 900, 800),
      P('Pull through the last 2 loops.', 3,
        merge(hookSet(along(INS, 26 + 34 + 52)), ringSet('a', 40 - 52), ringSet('x', 22 - 52)), 1800, 1000),
      P('One double crochet done, with 1 loop on the hook.', 3,
        merge(ringSet('a', -14, 0), ringSet('x', -32, 0), ringSet('y', 36), show('f'), yarnFrom(36), hookSet(NEXT)), 1800, 1800),
    ],
  });

  // ---------- increase: 2 single crochets in the same stitch ----------
  SCENES.inc = () => ({
    items: [
      ...fabric([{ id: 't', x: TX }]),
      ...finished('f', TX, 14, 11, -9),
      ...finished('g', TX, 14, 11, 9),
      ...base(ringItems(['a', 'b', 'c', 'd'])),
      { kind: 'hook', id: 'hook', init: READY },
    ],
    poses: [
      P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
      P('Work a single crochet into the stitch. Put the hook in.', 0, merge(hookSet(INS), under('t', true, 1)), 1800, 900),
      P('Yarn over and pull up a loop. 2 loops on the hook.', 0,
        merge(hookSet(along(INS, 26)), ringSet('b', 16), pulled(36, 16), yarnFrom(16), under('t', true, 0)), 1800, 1000),
      P('Yarn over and pull through both loops. That is the first single crochet.', 0,
        merge(hookSet(READY), ringSet('a', 36 - 20, 0), ringSet('b', 16 - 20, 0), ringSet('c', 36), pulled(36 - 20, 16 - 20, 0), show('f'), yarnFrom(36)), 2000, 1100),
      P('Put the hook into the same stitch again.', 0, merge(hookSet(INS), under('t', true, 1)), 1700, 900),
      P('Yarn over and pull up a loop. 2 loops on the hook.', 0,
        merge(hookSet(along(INS, 26)), ringSet('d', 16), pulled(36, 16), yarnFrom(16), under('t', true, 0)), 1800, 1000),
      P('Yarn over and pull through both loops. That is the second single crochet.', 0,
        merge(hookSet(NEXT), ringSet('c', 36 - 20, 0), ringSet('d', 16 - 20, 0), ringSet('a', 36), pulled(36 - 20, 16 - 20, 0), show('g'), yarnFrom(36)), 2000, 1100),
      P('Two single crochets in one stitch make one increase. Your round now has 1 more stitch.', 1, {}, 700, 2400),
    ],
  });

  // ---------- invisible decrease ----------
  const DX2 = 84; // the second stitch
  SCENES.dec = () => {
    const INS1 = { x: TX + 2, y: 156, r: -50 };
    const INS2 = { x: DX2 + 4, y: 152, r: -8 };
    return {
      items: [
        ...fabric([{ id: 't', x: TX }, { id: 'u', x: DX2 }]),
        { kind: 'strand', id: 'dp', layer: 'behind', color: 'accent', w: 5, init: { pts: [[104, RY - 4], [104, RY - 12], [104, RY - 18]], o: 0 } },
        { kind: 'strand', id: 'dt', layer: 'behind', color: 'accent', w: 4.4, closed: true, init: { pts: E(104, RY - 18, 22, 6), o: 0 } },
        ...base(ringItems(['a', 'b', 'c'])),
        { kind: 'hook', id: 'hook', init: READY },
      ],
      poses: [
        P('Start with 1 loop on the hook.', null, merge(hookSet(READY), ringSet('a', 36)), 0, 1300),
        P('Put the hook through the front loop only of the next stitch.', 0,
          merge(hookSet(INS1), { tfo: { o: 1 } }), 1800, 1000),
        P('Now through the front loop only of the stitch after it. The hook is under 2 front loops.', 0,
          merge(hookSet(INS2), { tfo: { o: 1 }, ufo: { o: 1 } }), 1900, 1200),
        P('Yarn over.', 1, merge(ringSet('b', 6), yarnFrom(6)), 900, 800),
        P('Pull through both front loops. You now have 2 loops on the hook.', 1,
          merge(hookSet(along(INS2, 36)), ringSet('b', 14), {
            bt: { pts: [H(36, RING_RY), [TX, RY + 3], [DX2, RY + 3], H(14, RING_RY)], o: 1 }, tfo: { o: 0 }, ufo: { o: 0 },
          }, yarnFrom(14)), 1800, 1500),
        P('Yarn over again.', 2, merge(ringSet('c', 5), ringSet('b', 16), yarnFrom(5)), 900, 800),
        P('Pull through both loops.', 2,
          merge(hookSet(along(INS2, 36 + 46)), ringSet('a', 36 - 46), ringSet('b', 16 - 46), {
            bt: { pts: [H(36 - 46, RING_RY), [TX, RY + 3], [DX2, RY + 3], H(16 - 46, RING_RY)] },
          }), 1800, 1000),
        P('Two stitches have become one. 1 loop is left on the hook.', 2,
          merge(ringSet('a', -10, 0), ringSet('b', -30, 0), { bt: { o: 0 }, dp: { o: 1 }, dt: { o: 1 } }, ringSet('c', 36), yarnFrom(36), hookSet({ x: 52, y: 92, r: -20 })), 1800, 1800),
      ],
    };
  };
  // ---------- magic ring ----------
  const RC = { x: 128, y: 100, r: 40 };
  // The loop of yarn with its tail, as a list of points. n stays the same so it can be tweened.
  function loopPts(R, tail) {
    const { x, y } = RC;
    const c = (deg, rr = R) => [x + rr * Math.cos((deg * Math.PI) / 180), y + rr * Math.sin((deg * Math.PI) / 180)];
    return [tail, [lerp(tail[0], x - 6, 0.55), lerp(tail[1], y + R + 6, 0.55)], c(70), c(25), c(-20), c(-65), c(-110), c(-155), c(160), c(115), c(80), [x + 16, y + R + 8]];
  }
  SCENES.ring = () => {
    const tail0 = [64, 186];
    const hk0 = { x: 330, y: 96, r: -10 };
    const insHook = { x: 70, y: 100, r: -4 };
    const stitchBars = (R, o) => {
      const out = {};
      for (let k = 0; k < 6; k++) {
        const a = ((-90 + k * 60) * Math.PI) / 180;
        const r0 = R;
        const r2 = R + (R > 20 ? 20 : 14);
        out['m' + k] = { pts: [[RC.x + r0 * Math.cos(a), RC.y + r0 * Math.sin(a)], [RC.x + ((r0 + r2) / 2) * Math.cos(a), RC.y + ((r0 + r2) / 2) * Math.sin(a)], [RC.x + r2 * Math.cos(a), RC.y + r2 * Math.sin(a)]], o };
      }
      return out;
    };
    const bars = Array.from({ length: 6 }, (_, k) => ({ kind: 'strand', id: 'm' + k, layer: 'behind', color: 'accent', w: 6, init: { pts: stitchBars(RC.r, 0)['m' + k].pts, o: 0 } }));
    // the first strand of the loop, drawn again on top so the hook passes under it
    const leftArc = (R) => [c2(160, R), c2(180, R), c2(200, R)];
    function c2(deg, R) {
      return [RC.x + R * Math.cos((deg * Math.PI) / 180), RC.y + R * Math.sin((deg * Math.PI) / 180)];
    }
    return {
      items: [
        { kind: 'strand', id: 'rs', layer: 'behind', color: 'mid', w: 5, init: { pts: loopPts(RC.r, tail0), o: 1 } },
        { kind: 'strand', id: 'lo', layer: 'front', color: 'mid', w: 5, init: { pts: leftArc(RC.r), o: 0 } },
        { kind: 'text', id: 'tx1', x: 44, y: 176, text: 'tail', init: { o: 1 } },
        ...bars,
        { kind: 'strand', id: 'lk', layer: 'behind', color: 'accent', w: 4.4, closed: true, init: { pts: E(92, 106, 6, 10), o: 0 } },
        ...ringItems(['b', 'c']),
        { kind: 'strand', id: 'w', layer: 'front', color: 'accent', w: 4.4, init: { pts: [[RC.x + 16, RC.y + RC.r + 8], [196, 178], [262, 176], [368, 168]], o: 1 } },
        { kind: 'hook', id: 'hook', init: hk0 },
      ],
      poses: [
        P('Make a loop in the yarn and leave a tail.', 0, merge(hookSet({ x: 420, y: 96, r: -10 })), 0, 1700),
        P('Put the hook under the first strand of the loop.', 1, merge(hookSet(insHook), { lo: { o: 1, dl: 0.5 }, tx1: { o: 0 } }), 2000, 1000),
        P('Catch the working yarn with the hook.', 1,
          merge(ringSet('b', 7), { w: { pts: [[RC.x + 16, RC.y + RC.r + 8], [130, 160], H(7, RING_RY), [368, 150]] } }), 1100, 900),
        P('Pull a loop through.', 1,
          merge(hookSet({ x: 100, y: 100, r: -4 }), ringSet('b', 16), { w: { pts: [[RC.x + 16, RC.y + RC.r + 8], [126, 146], H(16, RING_RY), [368, 150]] } }), 1500, 1100),
        P('Chain 1 to lock the ring. This chain does not count as a stitch.', 2,
          merge(ringSet('c', 5), { w: { pts: [[RC.x + 16, RC.y + RC.r + 8], [130, 150], H(5, RING_RY), [368, 150]] } }), 900, 600),
        P('Pull through the loop on the hook.', 2,
          merge(hookSet({ x: 108, y: 98, r: -6 }), ringSet('b', -12, 0), ringSet('c', 36), { lk: { o: 1, dl: 0.4 }, w: { pts: [[RC.x + 16, RC.y + RC.r + 8], [150, 142], H(36, RING_RY), [368, 150]] } }), 1500, 1100),
        P('Work 6 single crochets into the ring, over the ring and the tail.', 3,
          merge(hookSet({ x: 196, y: 84, r: -14 }), { lo: { o: 0 }, lk: { o: 0 }, w: { pts: [[RC.x + 16, RC.y + RC.r + 8], [186, 132], H(36, RING_RY), [368, 150]] } },
            Object.fromEntries(Array.from({ length: 6 }, (_, k) => ['m' + k, { o: 1, dl: (k / 6) * 0.8 }]))), 3000, 1100),
        P('Pull the tail to close the ring tight.', 4,
          merge({ rs: { pts: loopPts(8, [14, 190]) }, tx1: { o: 0 } }, stitchBars(8, 1), { w: { pts: [[144, 116], [186, 126], H(36, RING_RY), [368, 150]] } }), 2400, 2200),
      ],
    };
  };

  /* ================================================================
     The player
     ================================================================ */
  function compile(def) {
    const hookItem = def.items.find((i) => i.kind === 'hook');
    const cur = {};
    for (const it of def.items) if (it.id) cur[it.id] = { ...it.init };
    const resolveAll = () => {
      const hk = cur[hookItem.id];
      const st = {};
      for (const it of def.items) {
        if (!it.id) continue;
        const q = { ...cur[it.id] };
        if (q.pts) q.pts = resolvePts(q.pts, hk);
        st[it.id] = q;
      }
      return st;
    };
    const states = [];
    const delays = [];
    def.poses.forEach((pose) => {
      const dl = {};
      for (const id in pose.set || {}) {
        const { dl: d, ...props } = pose.set[id];
        if (d) dl[id] = d;
        cur[id] = { ...(cur[id] || {}), ...props };
      }
      states.push(resolveAll());
      delays.push(dl);
    });
    // timeline
    const ms = [];
    const me = [];
    const he = [];
    def.poses.forEach((p, i) => {
      const start = i === 0 ? 0 : he[i - 1];
      ms.push(start);
      me.push(start + (i === 0 ? 0 : p.move));
      he.push(me[i] + p.hold);
    });
    return { states, delays, ms, me, he, total: he[he.length - 1] };
  }

  function mix(a, b, u, dl) {
    const t = ease(clamp01(dl ? (u - dl) / (1 - dl) : u));
    const out = {};
    for (const k in b) {
      if (k === 'pts') out.pts = lerpPts(a.pts || b.pts, b.pts, t);
      else if (typeof b[k] === 'number') out[k] = lerp(a[k] === undefined ? b[k] : a[k], b[k], t);
      else out[k] = b[k];
    }
    return out;
  }

  const svg = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  const stroke = (el, color, w) => {
    el.setAttribute('fill', 'none');
    el.style.stroke = COLORS[color] || color;
    el.setAttribute('stroke-width', w);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
  };

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.500z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.500v14H7zM13.500 5H17v14h-3.500z" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.300-5.200M5 4v4.500h4.500" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M18 5.500v13L9.500 12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M6 5.500v13L14.500 12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  };

  function mount(host, key, opts = {}) {
    const build = SCENES[key];
    if (!build) return null;
    const def = build();
    const tl = compile(def);
    const nPoses = def.poses.length;
    let speed = [1, 0.5, 0.25].includes(opts.speed) ? opts.speed : 1;

    /* ----- DOM ----- */
    host.innerHTML = '';
    host.classList.add('anim-on');
    const stage = document.createElement('div');
    stage.className = 'anim-stage';
    const root = svg('svg', { viewBox: `0 0 ${VW} ${VH}`, 'aria-hidden': 'true', focusable: 'false' }, stage);
    const gBehind = svg('g', {}, root);
    const gHook = svg('g', {}, root);
    const gFront = svg('g', {}, root);
    host.appendChild(stage);

    const cap = document.createElement('p');
    cap.className = 'anim-cap';
    cap.setAttribute('aria-live', 'polite');
    host.appendChild(cap);

    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.className = 'anim-scrub';
    scrub.min = 0;
    scrub.max = Math.round(tl.total);
    scrub.step = 10;
    scrub.value = 0;
    scrub.setAttribute('aria-label', 'Animation progress');
    host.appendChild(scrub);

    const ctl = document.createElement('div');
    ctl.className = 'anim-ctl';
    ctl.innerHTML =
      `<button type="button" class="anim-btn" data-a="prev" aria-label="Previous step">${ICON.prev}</button>` +
      `<button type="button" class="anim-btn big" data-a="play" aria-label="Play">${ICON.play}</button>` +
      `<button type="button" class="anim-btn" data-a="next" aria-label="Next step">${ICON.next}</button>` +
      '<div class="anim-speed" role="group" aria-label="Speed">' +
      [[1, 'Normal'], [0.5, 'Slow'], [0.25, 'Slower']].map(([v, l]) => `<button type="button" data-speed="${v}" aria-pressed="${v === speed}">${l}</button>`).join('') +
      '</div>';
    host.appendChild(ctl);
    const playBtn = ctl.querySelector('[data-a=play]');

    /* ----- drawing ----- */
    const els = {};
    for (const it of def.items) {
      if (it.kind === 'rect') {
        const e = svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.rx || 0, opacity: it.op ?? 1 }, gBehind);
        e.style.fill = COLORS[it.fill] || it.fill;
      } else if (it.kind === 'strand') {
        const parent = it.layer === 'front' ? gFront : gBehind;
        const g = svg('g', {}, parent);
        const a = svg('path', {}, g);
        stroke(a, it.color, it.w);
        const twist = svg('path', { 'stroke-dasharray': '1.500 5', opacity: 0.45 }, g);
        stroke(twist, 'paper', Math.max(1, it.w * 0.28));
        if (it.id) els[it.id] = { kind: 'strand', g, a, twist, closed: !!it.closed };
        if (!it.id) {
          const pts = it.init.pts;
          const d = smooth(resolvePts(pts, { x: 0, y: 0, r: 0 }), !!it.closed);
          a.setAttribute('d', d);
          twist.setAttribute('d', d);
          g.style.opacity = it.init.o ?? 1;
        }
      } else if (it.kind === 'ring') {
        const rx = it.rx || 3.6;
        const ry = it.ry || RING_RY;
        const back = svg('ellipse', { cx: 0, cy: 0, rx, ry }, gBehind);
        stroke(back, it.color, it.w);
        const front = svg('path', { d: `M0 ${-ry}A${rx} ${ry} 0 0 0 0 ${ry}` }, gFront);
        stroke(front, it.color, it.w);
        els[it.id] = { kind: 'ring', back, front };
      } else if (it.kind === 'hook') {
        const g = svg('g', {}, gHook);
        const body = svg('path', { d: 'M1 1C-1 -2 1 -6 6 -7.500C9 -8 11 -6 10 -4C13 -3 16 -5 22 -5L150 -5L150 5L8 5C3 5 1 3.500 1 1Z' }, g);
        body.style.fill = COLORS.bar;
        const shine = svg('path', { d: 'M26 -2.200L144 -2.200', 'stroke-linecap': 'round', opacity: 0.35 }, g);
        shine.style.stroke = 'var(--on-bar)';
        shine.setAttribute('stroke-width', 1.600);
        els[it.id] = { kind: 'hook', g };
      } else if (it.kind === 'text') {
        const t = svg('text', { x: it.x, y: it.y, 'font-size': 12, 'text-anchor': it.anchor || 'middle' }, gBehind);
        t.style.fill = COLORS.muted;
        t.style.fontFamily = 'var(--sans)';
        t.style.fontWeight = 700;
        t.textContent = it.text;
        els[it.id] = { kind: 'text', t };
      }
    }

    function draw(S) {
      const hk = S.hook;
      for (const id in els) {
        const e = els[id];
        const s = S[id];
        if (!e || !s) continue;
        if (e.kind === 'strand') {
          const d = smooth(s.pts, e.closed);
          e.a.setAttribute('d', d);
          e.twist.setAttribute('d', d);
          e.g.style.opacity = s.o ?? 1;
        } else if (e.kind === 'ring') {
          const tf = `translate(${r1(hk.x)} ${r1(hk.y)}) rotate(${r1(hk.r)}) translate(${r1(s.d)} 0)`;
          e.back.setAttribute('transform', tf);
          e.front.setAttribute('transform', tf);
          e.back.style.opacity = s.o;
          e.front.style.opacity = s.o * clamp01((s.d - 2) / 6);
        } else if (e.kind === 'hook') {
          e.g.setAttribute('transform', `translate(${r1(s.x)} ${r1(s.y)}) rotate(${r1(s.r)})`);
        } else if (e.kind === 'text') {
          e.t.style.opacity = s.o;
        }
      }
    }

    function poseAt(t) {
      let i = 0;
      for (let k = 0; k < nPoses; k++) if (tl.ms[k] <= t) i = k;
      return i;
    }
    function stateAt(t) {
      const i = poseAt(t);
      if (i === 0 || t >= tl.me[i]) return tl.states[i];
      const u = (t - tl.ms[i]) / (tl.me[i] - tl.ms[i]);
      const a = tl.states[i - 1];
      const b = tl.states[i];
      const out = {};
      for (const id in b) out[id] = mix(a[id] || b[id], b[id], u, tl.delays[i][id] || 0);
      return out;
    }

    /* ----- playback ----- */
    let t = 0;
    let playing = false;
    let stopAt = null;
    let raf = 0;
    let last = 0;
    let shown = -1;
    let dead = false;

    function setPlayIcon() {
      const atEnd = t >= tl.total - 1;
      playBtn.innerHTML = playing ? ICON.pause : atEnd ? ICON.replay : ICON.play;
      playBtn.setAttribute('aria-label', playing ? 'Pause' : atEnd ? 'Replay' : 'Play');
    }
    function render() {
      draw(stateAt(t));
      scrub.value = Math.round(t);
      const i = poseAt(t);
      if (i !== shown) {
        shown = i;
        const p = def.poses[i];
        const stepText = p.step === null || p.step === undefined ? 'Get ready' : `Step ${p.step + 1} of ${opts.steps ? opts.steps.length : '?'}`;
        cap.innerHTML = `<span class="anim-n"></span><span class="anim-t"></span>`;
        cap.firstChild.textContent = stepText;
        cap.lastChild.textContent = p.cap;
        if (opts.onStep) opts.onStep(p.step === undefined ? null : p.step, i);
      }
      setPlayIcon();
    }
    function tick(now) {
      if (dead) return;
      const dt = Math.min(64, now - last);
      last = now;
      t += dt * speed;
      if (stopAt !== null && t >= stopAt) { t = stopAt; stopAt = null; playing = false; }
      if (t >= tl.total) { t = tl.total; playing = false; }
      render();
      if (playing) raf = requestAnimationFrame(tick);
    }
    function play() {
      if (t >= tl.total - 1) t = 0;
      playing = true;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      setPlayIcon();
    }
    function pause() {
      playing = false;
      stopAt = null;
      cancelAnimationFrame(raf);
      setPlayIcon();
    }

    playBtn.addEventListener('click', () => (playing ? pause() : play()));
    ctl.querySelector('[data-a=prev]').addEventListener('click', () => {
      pause();
      const i = Math.max(0, poseAt(t) - 1);
      t = tl.me[i];
      render();
    });
    ctl.querySelector('[data-a=next]').addEventListener('click', () => {
      const i = poseAt(t) + 1;
      if (i >= nPoses) return;
      t = Math.max(t, tl.ms[i]);
      stopAt = tl.me[i];
      playing = true;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    });
    scrub.addEventListener('input', () => {
      pause();
      t = Number(scrub.value);
      render();
    });
    ctl.querySelectorAll('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        ctl.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        if (opts.onSpeed) opts.onSpeed(speed);
      })
    );
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVis);

    render();
    if (opts.autoplay) setTimeout(() => { if (!dead && t === 0) play(); }, 350);

    return {
      // jump to a moment (used by tests and by the "show me" links)
      seek(ms) { pause(); t = Math.max(0, Math.min(tl.total, ms)); render(); },
      poseTimes: () => tl.me.slice(),
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        host.classList.remove('anim-on');
        host.innerHTML = '';
        if (opts.onStep) opts.onStep(null, -1);
      },
    };
  }

  window.LLAnim = { has: (id) => !!SCENES[id], mount, ids: () => Object.keys(SCENES) };
})();
