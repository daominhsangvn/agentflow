// Minimal deterministic animation engine: every element's state is a pure function of time t,
// so the player can scrub and a headless browser can capture any frame.
(function () {
  "use strict";
  const E = (window.E = {});
  const items = [];
  const hooks = [];

  const ease = {
    linear: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: (p) => {
      const c1 = 1.35;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    step: (p) => (p < 1 ? 0 : 1),
  };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, t0, t1, e = "out") => ease[e](clamp((t - t0) / Math.max(1e-6, t1 - t0)));

  // frames: [[t, value], [t, value, easeName], ...] sorted by t. The ease of a frame shapes the
  // segment that ends on it.
  function kf(t, frames) {
    const n = frames.length;
    if (t <= frames[0][0]) {
      return frames[0][1];
    }
    for (let i = 1; i < n; i++) {
      const f1 = frames[i];
      if (t < f1[0]) {
        const f0 = frames[i - 1];
        const span = f1[0] - f0[0];
        if (span <= 0) {
          return f1[1];
        }
        const p = ease[f1[2] || "inOut"]((t - f0[0]) / span);
        return f0[1] + (f1[1] - f0[1]) * p;
      }
    }
    return frames[n - 1][1];
  }

  function add(o) {
    const isSvg = Boolean(o.svgTag);
    const node = isSvg
      ? document.createElementNS("http://www.w3.org/2000/svg", o.svgTag)
      : document.createElement(o.tag || "div");
    if (o.id) {
      node.id = o.id;
    }
    if (o.cls) {
      node.setAttribute("class", o.cls);
    }
    if (o.html != null) {
      node.innerHTML = o.html;
    }
    if (isSvg) {
      for (const k of Object.keys(o.attrs || {})) {
        node.setAttribute(k, o.attrs[k]);
      }
    } else {
      const st = node.style;
      st.position = "absolute";
      st.left = "0px";
      st.top = "0px";
      if (o.w != null) {
        st.width = `${o.w}px`;
      }
      if (o.h != null) {
        st.height = `${o.h}px`;
      }
      st.transformOrigin = o.origin || "50% 50%";
      if (o.z != null) {
        st.zIndex = String(o.z);
      }
    }
    (o.parent || E.stage).appendChild(node);
    const it = {
      node,
      svg: isSvg,
      w: o.w || 0,
      h: o.h || 0,
      base: { x: o.x || 0, y: o.y || 0, s: o.s == null ? 1 : o.s, r: o.r || 0, o: o.o == null ? 1 : o.o },
      tracks: {},
    };
    items.push(it);
    node._it = it;
    return node;
  }

  function anim(node, tracks) {
    const it = node._it;
    for (const k of Object.keys(tracks)) {
      const merged = (it.tracks[k] || []).concat(tracks[k]);
      merged.sort((a, b) => a[0] - b[0]);
      it.tracks[k] = merged;
    }
    return node;
  }

  function valAt(node, k, t) {
    const it = node._it;
    return it.tracks[k] ? kf(t, it.tracks[k]) : it.base[k];
  }

  function render(t) {
    for (const it of items) {
      const tr = it.tracks;
      const b = it.base;
      const o = tr.o ? kf(t, tr.o) : b.o;
      const st = it.node.style;
      st.opacity = String(o);
      if (it.svg) {
        if (tr.draw) {
          st.strokeDashoffset = String(1 - kf(t, tr.draw));
        }
        continue;
      }
      const x = tr.x ? kf(t, tr.x) : b.x;
      const y = tr.y ? kf(t, tr.y) : b.y;
      const s = tr.s ? kf(t, tr.s) : b.s;
      const r = tr.r ? kf(t, tr.r) : b.r;
      st.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`;
      st.visibility = o < 0.002 ? "hidden" : "visible";
    }
    for (const h of hooks) {
      h(t);
    }
  }

  // Point at fraction p of an SVG path (used for pulses that ride the map lines).
  function pathPoint(path, p) {
    const len = path.getTotalLength();
    return path.getPointAtLength(clamp(p) * len);
  }

  Object.assign(E, {
    ease,
    clamp,
    lerp,
    prog,
    kf,
    add,
    anim,
    valAt,
    render,
    pathPoint,
    hook: (fn) => hooks.push(fn),
    items,
  });
})();
