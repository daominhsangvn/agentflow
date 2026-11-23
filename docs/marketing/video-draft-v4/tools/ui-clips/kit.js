// Helpers for the UI motion scripts (tools/ui-clips/<clip>.js), injected into the app page before
// the clip script. Every effect is a pure function of the clip time t, so frames render in any order.
window.__uiKit = (() => {
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const EASE = {
    out: (p) => 1 - (1 - p) ** 3,
    inOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    linear: (p) => p,
  };
  const prog = (t, a, b, e = "out") => EASE[e](clamp((t - a) / (b - a)));
  const lerp = (a, b, p) => a + (b - a) * p;
  const fmt = (n) => n.toLocaleString("en-US");

  // The clip script owns all motion: no CSS transitions, animations, carets or scrollbars.
  function freezeStyles() {
    const s = document.createElement("style");
    s.textContent =
      "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" +
      "::-webkit-scrollbar{display:none}*{scrollbar-width:none!important}";
    document.head.appendChild(s);
  }

  function replaceText(root, from, to) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.includes(from)) {
        n.nodeValue = n.nodeValue.replace(from, to);
      }
    }
  }

  // Wraps an element's current children so they can be swapped for new content later.
  function wrapContents(el) {
    const wrap = document.createElement("span");
    wrap.append(...el.childNodes);
    el.append(wrap);
    return wrap;
  }

  // Background tint that flashes at `at` and fades over `len` seconds.
  function flash(t, at, rgb, peak = 0.2, len = 1.4) {
    if (t < at) {
      return "";
    }
    const a = peak * (1 - prog(t, at, at + len, "linear"));
    return a > 0.002 ? `rgba(${rgb},${a.toFixed(3)})` : "";
  }

  // Scale kick when a value changes at `at`.
  function bump(t, at, amount = 0.14, len = 0.32) {
    return t >= at ? 1 + amount * (1 - prog(t, at, at + len)) : 1;
  }

  function center(el, fx = 0.5, fy = 0.5) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width * fx, r.top + r.height * fy];
  }

  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  document.body.appendChild(layer);

  // A pointer drawn over the page; the real mouse never moves, so hover looks are set by the clip.
  function pointer() {
    const arrow = document.createElement("div");
    arrow.innerHTML =
      '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    arrow.style.cssText =
      "position:absolute;left:0;top:0;opacity:0;transform-origin:3px 2px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))";
    const ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute;left:0;top:0;width:46px;height:46px;border-radius:50%;border:2px solid rgba(255,255,255,.9);opacity:0";
    layer.append(ring, arrow);
    return {
      // keys: [[t, x, y], ...]; the pointer glides between keys (ease in-out) and shows from the first.
      at(t, keys, clicks = []) {
        if (t < keys[0][0]) {
          arrow.style.opacity = "0";
          ring.style.opacity = "0";
          return;
        }
        let [x, y] = keys.at(-1).slice(1);
        for (let i = 0; i < keys.length - 1; i++) {
          const [t0, x0, y0] = keys[i];
          const [t1, x1, y1] = keys[i + 1];
          if (t < t1) {
            const p = prog(t, t0, t1, "inOut");
            x = lerp(x0, x1, p);
            y = lerp(y0, y1, p);
            break;
          }
        }
        const press = clicks.reduce((s, c) => (t >= c && t < c + 0.18 ? 0.88 : s), 1);
        arrow.style.opacity = String(prog(t, keys[0][0], keys[0][0] + 0.25));
        arrow.style.transform = `translate(${x - 3}px,${y - 2}px) scale(${press})`;
        const c = clicks.filter((k) => t >= k && t < k + 0.5).at(-1);
        if (c === undefined) {
          ring.style.opacity = "0";
          return;
        }
        const p = prog(t, c, c + 0.5);
        ring.style.opacity = String(0.9 * (1 - p));
        ring.style.transform = `translate(${x - 23}px,${y - 23}px) scale(${0.35 + 0.9 * p})`;
      },
    };
  }

  return { clamp, prog, lerp, fmt, freezeStyles, replaceText, wrapContents, flash, bump, center, pointer };
})();
