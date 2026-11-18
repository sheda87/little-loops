/* Little Loops: animated stitch diagrams (version 2: hands and one continuous yarn).

   How it works, in plain words:
   - The yarn is ONE continuous line from the finished work, around the hook, over the left
     index finger and off to the ball. It can never come apart, because it is a single path.
   - Each animation is a list of "poses". A pose says where the hook is and where each loop of
     that one yarn sits. The player smoothly moves from one pose to the next.
   - A "loop unit" is 7 points of yarn. It can sit around the hook, lie flat as a chain link,
     or be tucked into a single point (a finished stitch).
   - Colors come from the theme variables in styles.css, so diagrams change with the season.

   Public API (used by app.js):  LLAnim.has(id)  and  LLAnim.mount(host, id, options)
*/
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const VX = 58;
  const VY = 50;
  const VW = 264;
  const VH = 176;

  /* ---------------- small helpers ---------------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const r1 = (n) => Math.round(n * 10) / 10;
  const rad = (d) => (d * Math.PI) / 180;
  const COLORS = {
    accent: 'var(--accent)', mid: 'var(--mid)', edge: 'var(--edge)', bar: 'var(--bar)',
    ink: 'var(--ink)', paper: 'var(--paper)', soft: 'var(--soft)', warm: 'var(--warm)', muted: 'var(--muted)',
    accentDark: 'var(--accent-dark)', skin: 'var(--skin)', skinEdge: 'var(--skin-edge)',
  };

  /* ---------------- layout of the picture ---------------- */
  const TX = 172; // x of the stitch we work into
  const RY = 176; // y of the top of the previous row
  const R = 12; // how far the yarn wraps out from the hook
  const FING = { x: 86, y: 104 }; // top of the left index finger
  const HOOK_LEN = 178;
  const GRIP = 92; // where the right hand starts, measured back from the hook tip

  // Point on the hook: d = distance back from the tip, o = sideways offset.
  const toWorld = (hk, d, o) => {
    const a = rad(hk.r);
    return [hk.x + d * Math.cos(a) - o * Math.sin(a), hk.y + d * Math.sin(a) + o * Math.cos(a)];
  };
  // The same hook, slid back along itself by d.
  const along = (hk, d) => ({ x: hk.x + Math.cos(rad(hk.r)) * d, y: hk.y + Math.sin(rad(hk.r)) * d, r: hk.r });
  // A hook placed so that its point at distance d lands on (x, y).
  const insAt = (d, x, y, r) => ({ x: x - d * Math.cos(rad(r)), y: y - d * Math.sin(rad(r)), r });

  const READY = { x: 168, y: 100, r: -16 };
  const NEXT = { x: 134, y: 102, r: -16 };
  const INS = insAt(14, TX, RY - 3, -38);
  const A0 = [TX - 36, RY - 3]; // where the yarn is anchored: the last finished stitch
  const BASE = [TX, RY - 4]; // the base of the stitch being made
  const XS = [28, 64, 100, 136, 172, 208, 244, 280, 316]; // tops of the previous row

  /* ---------------- loop units (7 points each) ---------------- */
  const N = 13;

  // Point at fraction u (0 to 1) along a polyline.
  function along01(pts, u) {
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const s = len[len.length - 1] * u;
    let i = 1;
    while (i < len.length - 1 && len[i] < s) i++;
    const seg = len[i] - len[i - 1] || 1;
    const f = clamp01((s - len[i - 1]) / seg);
    return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f), pts[i - 1][2]];
  }

  // One turn of yarn around the hook, starting under it, crossing the front, and returning behind.
  // Each loop is a slightly different size, so they look like soft yarn and not stamped rings.
  function unitHook(hk, d, grow = 1, rs = 1) {
    const pts = [];
    const rr = R * rs * (1 + 0.12 * Math.sin(d * 0.37));
    for (let k = 0; k < N; k++) {
      const [x, y] = toWorld(hk, d + 8 * Math.sin((k * Math.PI) / 6) + 1.5 - k * 0.25, rr * Math.cos((k * Math.PI) / 6));
      pts.push([x, y, k >= 1 && k <= 6 ? 1 : 0]);
    }
    return grow >= 1 ? pts : pts.map((_, k) => along01(pts, (grow * k) / (N - 1)));
  }
  // The same loop lying flat, like a link in a chain.
  function unitLink(c) {
    const [cx, cy, rx, ry] = c;
    return Array.from({ length: N }, (_, k) => {
      const phi = rad(90 + k * 30);
      return [cx + rx * Math.cos(phi), cy + ry * Math.sin(phi), 0];
    });
  }
  const unitAt = (p) => Array.from({ length: N }, () => [p[0], p[1], 0]);

  function unitPts(spec, hk, prev) {
    if (spec === 'p') return Array.from({ length: N }, () => [prev[0], prev[1], prev[2]]); // not used yet
    if (typeof spec === 'number') return unitHook(hk, spec);
    if (spec.link) return unitLink(spec.link);
    if (spec.arc) {
      const [cx, cy, rr, a0, a1] = spec.arc;
      return Array.from({ length: N }, (_, k) => {
        const a = a0 + ((a1 - a0) * k) / (N - 1);
        const c = Math.cos(rad(a));
        return [cx + rr * c, cy + rr * Math.sin(rad(a)), c < -0.6 ? 1 : 0];
      });
    }
    if (spec.at) return unitAt(spec.at);
    return unitHook(hk, spec.d, spec.grow === undefined ? 1 : spec.grow, spec.rs);
  }

  /* ---------------- building the one yarn path ---------------- */
  const PT = (x, y, z = 0) => ({ t: 'pt', p: [x, y], z });
  const U = (s) => ({ t: 'unit', s });
  // A loop of yarn pulled up through stitch(es): goes down to each point S and comes back up.
  const HP = (n, S) => ({ t: 'hp', n, S });
  const FG = (slack = 12) => ({ t: 'finger', slack });

  function build(items, hk, tension = 0.55) {
    const out = [];
    const last = () => out[out.length - 1];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.t === 'pt') {
        out.push([it.p[0], it.p[1], it.z || 0]);
      } else if (it.t === 'unit') {
        out.push(...unitPts(it.s, hk, last()));
      } else if (it.t === 'hp') {
        const prev = last();
        if (!it.S) {
          for (let k = 0; k < it.n + 2; k++) out.push([prev[0], prev[1], 0]);
        } else {
          const nx = items[i + 1];
          const ns = nx && nx.t === 'unit' ? unitPts(nx.s, hk, prev)[0] : prev;
          const S = it.S.map((p) => [p[0], p[1], 0]);
          out.push([lerp(prev[0], S[0][0], 0.5), lerp(prev[1], S[0][1], 0.5), 0]);
          out.push(...S);
          const sl = S[S.length - 1];
          out.push([lerp(ns[0], sl[0], 0.5), lerp(ns[1], sl[1], 0.5), 0]);
        }
      } else if (it.t === 'finger') {
        const p = last();
        const fr = [FING.x + 11, FING.y + 4, 1];
        out.push([(p[0] + fr[0]) / 2, (p[1] + fr[1]) / 2 + it.slack, 1]);
        out.push(fr);
        out.push([FING.x, FING.y - 11, 1]);
        out.push([FING.x - 11, FING.y + 4, 0]);
        out.push([FING.x - 12, FING.y + 64, 0]);
        out.push([FING.x - 28, FING.y + 180, 0]);
      }
    }
    return sag(out, tension);
  }

  // Loose yarn droops a little between its points; pulled-tight yarn does not.
  function sag(pts, tension) {
    const k = (1 - tension) * 0.24;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      out.push(pts[i]);
      if (i < pts.length - 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + k * Math.max(0, len - 12), Math.max(a[2], b[2])]);
      }
    }
    return out;
  }

  // The standard working yarn for a stitch: anchored at the last stitch, then units, then the finger.
  function stitchItems(o) {
    const a = o.A || A0;
    const it = [PT(a[0], a[1]), PT((o.S0 || a)[0], (o.S0 || a)[1])];
    o.U.forEach((s, i) => {
      it.push(U(s));
      (o.hp || []).forEach((h) => {
        if (h.after === i) it.push(HP(h.n, h.S || null));
      });
    });
    it.push(FG(o.slack === undefined ? 12 : o.slack));
    return it;
  }

  /* ---------------- drawing the curve ---------------- */
  // Smooth curve through points, split into a back part and a front part (z = 1 is in front).
  function curve(pts) {
    const n = pts.length;
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    let back = '';
    let front = '';
    let bEnd = -9;
    let fEnd = -9;
    const ctl = (a, b, len, sign) => {
      // handle on point a, aimed along the line from b's side, never longer than 0.4 of the segment
      const dx = sign * (b[0][0] - b[1][0]);
      const dy = sign * (b[0][1] - b[1][1]);
      const m = Math.hypot(dx, dy);
      if (m < 1e-6) return [a[0], a[1]];
      const k = Math.min(m / 6, len * 0.4) / m;
      return [a[0] + dx * k, a[1] + dy * k];
    };
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 0.05) continue;
      const c1 = ctl(p1, [p2, p0], len, 1);
      const c2 = ctl(p2, [p1, p3], len, 1);
      const seg = `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
      const start = `M${r1(p1[0])} ${r1(p1[1])}`;
      if (p1[2] > 0.5 || p2[2] > 0.5) {
        front += (fEnd === i ? '' : start) + seg;
        fEnd = i + 1;
      } else {
        back += (bEnd === i ? '' : start) + seg;
        bEnd = i + 1;
      }
    }
    return { back, front };
  }

  /* ================================================================
     The animations
     ================================================================ */
  const SCENES = {};
  // A pose. Pass the hook, the list of yarn items, and optional timing.
  const pose = (cap, step, hook, items, o = {}) => ({ cap, step, hook, items, move: o.move === undefined ? 1600 : o.move, hold: o.hold === undefined ? 900 : o.hold, stagger: o.stagger || 0, sh: o.sh, tension: o.tension });
  // A finished stitch is a stack of small flat loops (one per loop worked off), like the post of a real stitch.
  const LK = (i, lean = 0, x = TX) => ({ link: [x + lean * i, RY - 5 - 11 * i, 11, 5.2] });

  // ---------- chain ----------
  SCENES.chain = () => {
    const LY = 166;
    const links = [[100, LY, 14, 8], [126, LY, 14, 8], [152, LY, 14, 8]];
    const L4 = [178, LY, 14, 8];
    const hk0 = { x: 150, y: 134, r: -26 };
    const mk = (hook, u1, u2) => ({
      hook,
      items: [PT(88, LY), U({ link: links[0] }), U({ link: links[1] }), U({ link: links[2] }), U(u1), U(u2), FG(14)],
    });
    const a = mk(hk0, 22, 'p');
    const b = mk(hk0, 22, 4);
    const c = mk(along(hk0, 40), -18, 4);
    const d = mk({ x: 176, y: 134, r: -26 }, { link: L4 }, 22);
    const done = mk({ x: 176, y: 134, r: -26 }, { link: L4 }, 22);
    return {
      art: { thumb: [150, 190], row: false },
      poses: [
        pose('Start with 1 loop on the hook.', null, a.hook, a.items, { move: 0, hold: 1400 }),
        pose('Yarn over: wrap the yarn over the hook from back to front.', 0, b.hook, b.items, { move: 1100, hold: 900, stagger: 0.5 }),
        pose('Pull the yarn through the loop. The old loop slides off the hook.', 1, c.hook, c.items, { move: 1700, hold: 700 }),
        pose('That makes one chain. 1 loop stays on the hook.', 1, d.hook, d.items, { move: 1500, hold: 1500 }),
        pose('Repeat for as many chains as your pattern asks for. Never count the loop on the hook.', 2, done.hook, done.items, { move: 600, hold: 1800 }),
      ],
    };
  };

  // ---------- slip stitch ----------
  SCENES.slst = () => {
    const S = [[TX, RY - 3]];
    const T = [TX, RY - 9];
    const hp = (s) => [{ after: 0, n: 1, S: s }];
    const mk = (hook, Us, s) => ({ hook, items: stitchItems({ U: Us, hp: hp(s), S0: BASE }) });
    const H3 = along(INS, 44);
    const p0 = mk(READY, [44, 'p'], null);
    const p1 = mk(INS, [44, 'p'], null);
    const p2 = mk(INS, [44, 3], null);
    const p3 = mk(H3, [0, 3], S);
    const p4 = mk(NEXT, [LK(1), 36], null);
    return {
      art: { row: true, work: [TX] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Put the hook into the stitch.', 0, p1.hook, p1.items, { move: 1800, hold: 900 }),
        pose('Yarn over.', 1, p2.hook, p2.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull the yarn through the stitch and through the loop on the hook, in one motion.', 1, p3.hook, p3.items, { move: 2000, hold: 1000 }),
        pose('One slip stitch done. It is short and flat, with 1 loop left on the hook.', 1, p4.hook, p4.items, { move: 1800, hold: 1800 }),
      ],
    };
  };

  // ---------- single crochet ----------
  SCENES.sc = () => {
    const S = [[TX, RY - 3]];
    const T = [TX, RY - 18];
    const mk = (hook, Us, s) => ({ hook, items: stitchItems({ U: Us, hp: [{ after: 0, n: 1, S: s }], S0: BASE }) });
    const H4 = along(INS, 18);
    const H6 = along(INS, 58);
    const p0 = mk(READY, [44, 'p', 'p'], null);
    const p1 = mk(INS, [44, 'p', 'p'], null);
    const p2 = mk(INS, [44, 6, 'p'], null);
    const p3 = mk(H4, [26, 6, 'p'], S);
    const p4 = mk(H4, [26, 6, 3], S);
    const p5 = mk(H6, [-14, -34, 3], S);
    const p6 = mk(NEXT, [LK(1), LK(2), 36], null);
    return {
      art: { row: true, work: [TX] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Put the hook into the next stitch, under both loops of the V.', 0, p1.hook, p1.items, { move: 1800, hold: 900 }),
        pose('Yarn over.', 1, p2.hook, p2.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull up a loop through the stitch. You now have 2 loops on the hook.', 1, p3.hook, p3.items, { move: 1800, hold: 1400 }),
        pose('Yarn over again.', 2, p4.hook, p4.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull the yarn through both loops.', 2, p5.hook, p5.items, { move: 2000, hold: 1000 }),
        pose('One single crochet done, with 1 loop on the hook.', 2, p6.hook, p6.items, { move: 1900, hold: 1800 }),
      ],
    };
  };

  // ---------- half double crochet ----------
  SCENES.hdc = () => {
    const S = [[TX, RY - 3]];
    const T = [TX, RY - 28];
    const mk = (hook, Us, s) => ({ hook, items: stitchItems({ U: Us, hp: [{ after: 1, n: 1, S: s }], S0: BASE }) });
    const H4 = along(INS, 14);
    const H6 = along(INS, 70);
    const p0 = mk(READY, [44, 'p', 'p', 'p'], null);
    const p1 = mk(READY, [44, 6, 'p', 'p'], null);
    const p2 = mk(INS, [44, 30, 'p', 'p'], null);
    const p3 = mk(INS, [44, 30, 3, 'p'], null);
    const p4 = mk(H4, [30, 16, 3, 'p'], S);
    const p5 = mk(H4, [42, 28, 14, 3], S);
    const p6 = mk(H6, [-14, -28, -42, 3], S);
    const p7 = mk(NEXT, [LK(1), LK(2), LK(3), 36], null);
    return {
      art: { row: true, work: [TX] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Yarn over.', 0, p1.hook, p1.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Put the hook into the next stitch.', 0, p2.hook, p2.items, { move: 1800, hold: 900 }),
        pose('Yarn over again.', 1, p3.hook, p3.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull up a loop through the stitch. You now have 3 loops on the hook.', 1, p4.hook, p4.items, { move: 1800, hold: 1500 }),
        pose('Yarn over.', 2, p5.hook, p5.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull the yarn through all 3 loops.', 2, p6.hook, p6.items, { move: 2200, hold: 1000 }),
        pose('One half double crochet done, with 1 loop on the hook.', 2, p7.hook, p7.items, { move: 1900, hold: 1800 }),
      ],
    };
  };

  // ---------- double crochet ----------
  SCENES.dc = () => {
    const S = [[TX, RY - 3]];
    const T = [TX, RY - 40];
    const Tm = [TX, RY - 22];
    const mk = (hook, Us, s) => ({ hook, items: stitchItems({ U: Us, hp: [{ after: 1, n: 1, S: s }], S0: BASE }) });
    const H4 = along(INS, 14);
    const H6 = along(H4, 40);
    const H9 = along(H6, 60);
    const p0 = mk(READY, [46, 'p', 'p', 'p', 'p'], null);
    const p1 = mk(READY, [46, 6, 'p', 'p', 'p'], null);
    const p2 = mk(INS, [50, 32, 'p', 'p', 'p'], null);
    const p3 = mk(INS, [50, 32, 3, 'p', 'p'], null);
    const p4 = mk(H4, [36, 18, 3, 'p', 'p'], S);
    const p5 = mk(H4, [50, 34, 18, 3, 'p'], S);
    const p6 = mk(H6, [50, -6, -22, 3, 'p'], S);
    const p7 = mk(H6, [50, LK(2), LK(3), 18, 'p'], null);
    const p8 = mk(H6, [50, LK(2), LK(3), 18, 3], null);
    const p9 = mk(H9, [-10, LK(2), LK(3), -42, 3], null);
    const p10 = mk(NEXT, [LK(1), LK(2), LK(3), LK(4), 36], null);
    return {
      art: { row: true, work: [TX] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Yarn over.', 0, p1.hook, p1.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Put the hook into the next stitch.', 0, p2.hook, p2.items, { move: 1800, hold: 900 }),
        pose('Yarn over again.', 1, p3.hook, p3.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull up a loop through the stitch. You now have 3 loops on the hook.', 1, p4.hook, p4.items, { move: 1800, hold: 1500 }),
        pose('Yarn over.', 2, p5.hook, p5.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull through the first 2 loops. You now have 2 loops on the hook.', 2, p6.hook, p6.items, { move: 1900, hold: 900 }),
        pose('Two loops left on the hook.', 2, p7.hook, p7.items, { move: 1100, hold: 1100 }),
        pose('Yarn over.', 3, p8.hook, p8.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull through the last 2 loops.', 3, p9.hook, p9.items, { move: 2000, hold: 1000 }),
        pose('One double crochet done, with 1 loop on the hook.', 3, p10.hook, p10.items, { move: 1900, hold: 1800 }),
      ],
    };
  };

  // ---------- increase: 2 single crochets in the same stitch ----------
  SCENES.inc = () => {
    const S = [[TX, RY - 3]];
    const T1 = [TX - 9, RY - 18];
    const T2 = [TX + 9, RY - 18];
    const mk = (hook, Us, s0, s1) => ({ hook, items: stitchItems({ U: Us, hp: [{ after: 0, n: 1, S: s0 }, { after: 2, n: 1, S: s1 }], S0: BASE }) });
    const H3 = along(INS, 18);
    const H5 = along(INS, 58);
    const p0 = mk(READY, [44, 'p', 'p', 'p', 'p'], null, null);
    const p1 = mk(INS, [44, 'p', 'p', 'p', 'p'], null, null);
    const p2 = mk(INS, [44, 6, 'p', 'p', 'p'], null, null);
    const p3 = mk(H3, [26, 6, 'p', 'p', 'p'], S, null);
    const p4 = mk(H3, [26, 6, 3, 'p', 'p'], S, null);
    const p5 = mk(H5, [-14, -34, 3, 'p', 'p'], S, null);
    const p6 = mk(READY, [LK(1, -4), LK(2, -4), 40, 'p', 'p'], null, null);
    const p7 = mk(INS, [LK(1, -4), LK(2, -4), 44, 'p', 'p'], null, null);
    const p8 = mk(INS, [LK(1, -4), LK(2, -4), 44, 6, 'p'], null, null);
    const p9 = mk(H3, [LK(1, -4), LK(2, -4), 26, 6, 'p'], null, S);
    const p10 = mk(H3, [LK(1, -4), LK(2, -4), 26, 6, 3], null, S);
    const p11 = mk(H5, [LK(1, -4), LK(2, -4), -14, -34, 3], null, S);
    const p12 = mk(NEXT, [LK(1, -4), LK(2, -4), LK(2, -4), LK(2, 4), 36], null, [BASE]);
    return {
      art: { row: true, work: [TX] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Work a single crochet into the stitch. Put the hook in.', 0, p1.hook, p1.items, { move: 1800, hold: 900 }),
        pose('Yarn over.', 0, p2.hook, p2.items, { move: 1000, hold: 700, stagger: 0.5 }),
        pose('Pull up a loop. 2 loops on the hook.', 0, p3.hook, p3.items, { move: 1700, hold: 1000 }),
        pose('Yarn over again.', 0, p4.hook, p4.items, { move: 1000, hold: 700, stagger: 0.5 }),
        pose('Pull through both loops. That is the first single crochet.', 0, p5.hook, p5.items, { move: 1800, hold: 700 }),
        pose('First single crochet done. Keep the loop on the hook.', 0, p6.hook, p6.items, { move: 1700, hold: 1000 }),
        pose('Put the hook into the same stitch again.', 0, p7.hook, p7.items, { move: 1700, hold: 900 }),
        pose('Yarn over.', 0, p8.hook, p8.items, { move: 1000, hold: 700, stagger: 0.5 }),
        pose('Pull up a loop. 2 loops on the hook.', 0, p9.hook, p9.items, { move: 1700, hold: 1000 }),
        pose('Yarn over again.', 0, p10.hook, p10.items, { move: 1000, hold: 700, stagger: 0.5 }),
        pose('Pull through both loops. That is the second single crochet.', 0, p11.hook, p11.items, { move: 1800, hold: 700 }),
        pose('Two single crochets in one stitch make one increase. Your round now has 1 more stitch.', 1, p12.hook, p12.items, { move: 1900, hold: 2400 }),
      ],
    };
  };

  // ---------- invisible decrease ----------
  SCENES.dec = () => {
    const X1 = TX;
    const X2 = TX - 36;
    const A = [X2 - 36, RY - 4];
    const B = [(X1 + X2) / 2, RY - 4];
    const T = [B[0], RY - 17];
    const S2 = [[X1, RY - 3], [X2, RY - 3]];
    const INS1 = insAt(14, X1, RY - 3, -40);
    const INS2 = insAt(12, X2, RY - 3, -4);
    const H4 = { ...along(INS2, 60), r: -14 };
    const H6 = along(H4, 80);
    const mk = (hook, Us, s) => ({ hook, items: stitchItems({ A, S0: B, U: Us, hp: [{ after: 0, n: 2, S: s }] }) });
    const p0 = mk(READY, [62, 'p', 'p'], null);
    const p1 = mk(INS1, [62, 'p', 'p'], null);
    const p2 = mk(INS2, [62, 'p', 'p'], null);
    const p3 = mk(INS2, [62, 3, 'p'], null);
    const p4 = mk(H4, [62, 6, 'p'], S2);
    const p5 = mk(H4, [62, 20, 3], S2);
    const p6 = mk(H6, [-18, -60, 3], S2);
    const p7 = mk(NEXT, [LK(1, 0, B[0]), LK(2, 0, B[0]), 36], null);
    return {
      art: { row: true, work: [X1, X2] },
      poses: [
        pose('Start with 1 loop on the hook.', null, p0.hook, p0.items, { move: 0, hold: 1300 }),
        pose('Put the hook through the front loop only of the next stitch.', 0, p1.hook, p1.items, { move: 1800, hold: 1000 }),
        pose('Now through the front loop only of the stitch after it. The hook is under 2 front loops.', 0, p2.hook, p2.items, { move: 1900, hold: 1200 }),
        pose('Yarn over.', 1, p3.hook, p3.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull through both front loops. You now have 2 loops on the hook.', 1, p4.hook, p4.items, { move: 2000, hold: 1500 }),
        pose('Yarn over again.', 2, p5.hook, p5.items, { move: 1000, hold: 800, stagger: 0.5 }),
        pose('Pull through both loops.', 2, p6.hook, p6.items, { move: 2200, hold: 1000 }),
        pose('Two stitches have become one. 1 loop is left on the hook.', 2, p7.hook, p7.items, { move: 1900, hold: 1800 }),
      ],
    };
  };

  // ---------- magic ring ----------
  SCENES.ring = () => {
    const C = [168, 124];
    const OFF = { x: 470, y: 120, r: -4 };
    const circ = (Rr) => [{ arc: [C[0], C[1], Rr, 135, 315] }, { arc: [C[0], C[1], Rr, 315, 495] }];
    const xOf = (Rr) => [C[0] - 0.707 * Rr, C[1] + 0.707 * Rr];
    const bars = (Rr) => {
      // each single crochet around the ring is a small loop of yarn attached to the ring
      const out = {};
      const L = Rr > 20 ? 22 : 12;
      const W = Rr > 20 ? 6.5 : 3.5;
      for (let k = 0; k < 6; k++) {
        const a = rad(-90 + k * 60);
        const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
        const at = (r, s) => [C[0] + r * ux + s * vx, C[1] + r * uy + s * vy];
        out['m' + k] = { pts: [at(Rr, -1.5), at(Rr + L * 0.45, -W), at(Rr + L, 0), at(Rr + L * 0.45, W), at(Rr, 1.5)] };
      }
      return out;
    };
    const hidden = (Rr) => {
      const b = bars(Rr);
      for (const k in b) b[k].o = 0;
      return b;
    };
    const shown = (Rr, stag) => {
      const b = bars(Rr);
      let i = 0;
      for (const k in b) { b[k].o = 1; b[k].dl = stag ? (i++ / 6) * 0.8 : 0; }
      return b;
    };
    const mk = (hook, Rr, u1, u2, s, tail = [112, 222]) => {
      const [c1, c2] = circ(Rr);
      return { hook, items: [PT(tail[0], tail[1]), U(c1), U(c2), HP(1, s), U(u1), U(u2), FG(10)] };
    };
    const P_ = [C[0] - 34, C[1]]; // the left strand of the loop, where the hook goes under
    const HK1 = { x: 124, y: 126, r: -3 };
    const HK3 = along(HK1, 44);
    const HK5 = along(HK1, 66);
    const HK6 = { x: 150, y: 80, r: -14 };
    const q0 = mk(OFF, 34, 'p', 'p', null);
    const q1 = mk(HK1, 34, 'p', 'p', null);
    const q2 = mk(HK1, 34, 7, 'p', null);
    const q3 = mk(HK3, 34, 7, 'p', [P_]);
    const q4 = mk(HK3, 34, 22, 4, [P_]);
    const q5 = mk(HK5, 34, -20, 4, [P_]);
    const lk = { at: xOf(34) };
    const q6 = mk(HK6, 34, lk, 36, null);
    const q7 = mk(HK6, 9, { at: xOf(9) }, 36, null, [96, 232]);
    const withSh = (q, sh) => ({ ...q, sh });
    return {
      art: { row: false, thumb: [142, 170], label: { text: 'tail', x: 104, y: 238 } },
      shapes: Object.keys(bars(34)),
      poses: [
        pose('Make a loop in the yarn and leave a tail.', 0, q0.hook, q0.items, { move: 0, hold: 1700, sh: hidden(34) }),
        pose('Put the hook under the first strand of the loop.', 1, q1.hook, q1.items, { move: 2000, hold: 1000 }),
        pose('Catch the working yarn with the hook.', 1, q2.hook, q2.items, { move: 1100, hold: 900, stagger: 0.5 }),
        pose('Pull a loop through.', 1, q3.hook, q3.items, { move: 1700, hold: 1100 }),
        pose('Chain 1 to lock the ring: yarn over.', 2, q4.hook, q4.items, { move: 1000, hold: 700, stagger: 0.5 }),
        pose('Pull through the loop on the hook. This chain does not count as a stitch.', 2, q5.hook, q5.items, { move: 1700, hold: 1000 }),
        pose('Work 6 single crochets into the ring, over the ring and the tail.', 3, q6.hook, q6.items, { move: 3000, hold: 1200, sh: shown(34, true) }),
        pose('Pull the tail to close the ring tight.', 4, q7.hook, q7.items, { move: 2400, hold: 2200, sh: shown(9, false) }),
      ],
    };
  };

  /* ================================================================
     The player
     ================================================================ */
  function compile(def, key) {
    const cs = {};
    const states = [];
    const delays = [];
    def.poses.forEach((p, i) => {
      const yarn = build(p.items, p.hook, p.tension);
      if (states.length && yarn.length !== states[0].yarn.length) console.error('LLAnim ' + key + ': pose ' + i + ' has ' + yarn.length + ' yarn points, expected ' + states[0].yarn.length);
      for (const id in p.sh || {}) cs[id] = { ...(cs[id] || {}), ...p.sh[id] };
      const dl = {};
      for (const id in cs) dl[id] = cs[id].dl || 0;
      const sh = {};
      for (const id in cs) sh[id] = { pts: cs[id].pts, o: cs[id].o };
      states.push({ hook: { ...p.hook }, yarn, sh, stagger: p.stagger });
      delays.push(dl);
    });
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
    const out = { hook: {}, yarn: [], sh: {} };
    const t = ease(clamp01(u));
    for (const k of ['x', 'y', 'r']) out.hook[k] = lerp(a.hook[k], b.hook[k], t);
    const st = b.stagger || 0;
    const n = b.yarn.length;
    for (let i = 0; i < n; i++) {
      const ti = ease(clamp01((u - (st * i) / n) / (1 - st)));
      const p = a.yarn[i];
      const q = b.yarn[i];
      out.yarn.push([lerp(p[0], q[0], ti), lerp(p[1], q[1], ti), ti < 0.5 ? p[2] : q[2]]);
    }
    for (const id in b.sh) {
      const x = a.sh[id] || b.sh[id];
      const y = b.sh[id];
      const d = dl[id] || 0;
      const tt = ease(clamp01(d ? (u - d) / (1 - d) : u));
      out.sh[id] = {
        pts: y.pts.map((q, i) => [lerp(x.pts[i][0], q[0], tt), lerp(x.pts[i][1], q[1], tt)]),
        o: lerp(x.o === undefined ? y.o : x.o, y.o, tt),
      };
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
  // A finger: a thick rounded line with an outline.
  const finger = (parent, x1, y1, x2, y2, w) => {
    const a = svg('line', { x1, y1, x2, y2 }, parent);
    stroke(a, 'skinEdge', w + 3);
    const b = svg('line', { x1, y1, x2, y2 }, parent);
    stroke(b, 'skin', w);
  };
  const blob = (parent, d) => {
    const p = svg('path', { d, 'stroke-width': 2, 'stroke-linejoin': 'round' }, parent);
    p.style.fill = COLORS.skin;
    p.style.stroke = COLORS.skinEdge;
    return p;
  };

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.500z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.500v14H7zM13.500 5H17v14h-3.500z" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.300-5.200M5 4v4.500h4.500" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M18 5.500v13L9.500 12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M6 5.500v13L14.500 12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  };

  function mount(host, key, opts = {}) {
    const build_ = SCENES[key];
    if (!build_) return null;
    const def = build_();
    const tl = compile(def, key);
    const nPoses = def.poses.length;
    let speed = [1, 0.5, 0.25].includes(opts.speed) ? opts.speed : 1;

    /* ----- DOM ----- */
    host.innerHTML = '';
    host.classList.add('anim-on');
    const stage = document.createElement('div');
    stage.className = 'anim-stage';
    const root = svg('svg', { viewBox: `${VX} ${VY} ${VW} ${VH}`, 'aria-hidden': 'true', focusable: 'false' }, stage);
    const gBack = svg('g', {}, root);
    const gY0 = svg('g', {}, root);
    const gHandL = svg('g', {}, root);
    const gHook = svg('g', {}, root);
    const gHandR = svg('g', {}, root);
    const gY1 = svg('g', {}, root);
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

    /* ----- the static picture: fabric, left hand, hook, right hand ----- */
    const art = def.art || {};
    if (art.row) {
      // The finished row: each stitch is a "V" with a loop on top. The hook goes in under the loop.
      const strand = (parent, d) => {
        const a = svg('path', { d }, parent);
        stroke(a, 'mid', 7);
        const b = svg('path', { d }, parent);
        stroke(b, 'edge', 4.2);
      };
      for (let r = 2; r >= 0; r--) {
        const y0 = RY - 3 + 22 * r;
        for (const x of XS) {
          const working = r === 0 && (art.work || []).includes(x);
          strand(gBack, `M${x - 12} ${y0}C${x - 13} ${y0 + 9} ${x - 6} ${y0 + 17} ${x} ${y0 + 24}`);
          strand(gBack, `M${x + 12} ${y0}C${x + 13} ${y0 + 9} ${x + 6} ${y0 + 17} ${x} ${y0 + 24}`);
          strand(gBack, `M${x - 12} ${y0}A12 6 0 0 1 ${x + 12} ${y0}`);
          strand(working ? gFront : gBack, `M${x - 12} ${y0}A12 6 0 0 0 ${x + 12} ${y0}`);
        }
      }
    }
    if (art.label) {
      const t = svg('text', { x: art.label.x, y: art.label.y, 'font-size': 12, 'text-anchor': 'middle' }, gBack);
      t.style.fill = COLORS.muted;
      t.style.fontFamily = 'var(--sans)';
      t.style.fontWeight = 700;
      t.textContent = art.label.text;
    }
    const shapeEls = {};
    for (const id of def.shapes || []) {
      const g = svg('g', {}, gBack);
      const pc = svg('path', {}, g);
      stroke(pc, 'accentDark', 7.6);
      const p = svg('path', {}, g);
      stroke(p, 'accent', 4.8);
      shapeEls[id] = { g, p, pc };
    }
    // left hand: index finger holds the yarn, thumb holds the work
    finger(gHandL, FING.x, FING.y, FING.x, 232, 19);
    blob(gHandL, 'M-14 248L-14 198C0 178 44 170 84 174C116 178 134 206 130 248Z');
    const th = art.thumb || [150, 212];
    finger(gHandL, 34, 246, th[0], th[1], 17);
    // hook
    const hookG = svg('g', {}, gHook);
    const body = svg('path', { d: `M1 1C-1 -2 1 -6 6 -7.5C9 -8 11 -6 10 -4C13 -3 16 -6 22 -6L${HOOK_LEN} -6L${HOOK_LEN} 6L8 6C3 6 1 4 1 1Z` }, hookG);
    body.style.fill = COLORS.bar;
    const shine = svg('path', { d: `M26 -2.2L${HOOK_LEN - 6} -2.2`, 'stroke-linecap': 'round', opacity: 0.35 }, hookG);
    shine.style.stroke = 'var(--on-bar)';
    shine.setAttribute('stroke-width', 1.6);
    // right hand grips the hook (drawn in the hook's own coordinates)
    const handR = svg('g', {}, gHandR);
    finger(handR, 128, 34, 178, 34, 12);
    finger(handR, 132, 46, 168, 46, 12);
    finger(handR, 134, -17, GRIP + 2, -9.5, 11);
    finger(handR, 134, 17, GRIP + 2, 9.5, 11);
    blob(handR, 'M122 -17C122 -26 132 -28 142 -28L170 -28C184 -28 190 -17 190 -5L190 13C190 27 180 30 168 30L138 30C128 30 122 25 122 17Z');
    // the yarn
    const yBackC = svg('path', {}, gY0);
    stroke(yBackC, 'accentDark', 7.6);
    const yBack = svg('path', {}, gY0);
    stroke(yBack, 'accent', 4.8);
    const yBackT = svg('path', { 'stroke-dasharray': '1.5 5', opacity: 0.45 }, gY0);
    stroke(yBackT, 'paper', 1.3);
    const yFrontC = svg('path', {}, gY1);
    stroke(yFrontC, 'accentDark', 7.6);
    const yFront = svg('path', {}, gY1);
    stroke(yFront, 'accent', 4.8);
    const yFrontT = svg('path', { 'stroke-dasharray': '1.5 5', opacity: 0.45 }, gY1);
    stroke(yFrontT, 'paper', 1.3);

    function draw(S) {
      const hk = S.hook;
      const tf = `translate(${r1(hk.x)} ${r1(hk.y)}) rotate(${r1(hk.r)})`;
      hookG.setAttribute('transform', tf);
      handR.setAttribute('transform', tf);
      const c = curve(S.yarn);
      yBackC.setAttribute('d', c.back);
      yFrontC.setAttribute('d', c.front);
      yBack.setAttribute('d', c.back);
      yBackT.setAttribute('d', c.back);
      yFront.setAttribute('d', c.front);
      yFrontT.setAttribute('d', c.front);
      for (const id in shapeEls) {
        const s = S.sh[id];
        if (!s) continue;
        const dd = curve(s.pts.map((q) => [q[0], q[1], 0])).back;
        shapeEls[id].p.setAttribute('d', dd);
        shapeEls[id].pc.setAttribute('d', dd);
        shapeEls[id].g.style.opacity = s.o;
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
      return mix(tl.states[i - 1], tl.states[i], u, tl.delays[i]);
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
        cap.innerHTML = '<span class="anim-n"></span><span class="anim-t"></span>';
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
