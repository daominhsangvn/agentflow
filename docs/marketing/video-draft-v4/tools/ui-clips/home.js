// Home page, 5 s: the attention stats count up, the "Needs attention" items slide in one by one
// (as in C8 of the video), the 30-day activity chart draws in from left to right, and the pointer
// ends on the first item, LD-12. Data comes from tools/app-demo-data.mjs.
(() => {
  const K = window.__uiKit;
  const T = { stats: [0.15, 1.15], stagger: 0.08, items: 0.45, itemStep: 0.36, chart: [1.0, 3.1], pointer: 3.2, hover: 4.0 };
  const RISE = 8;
  let S = null;

  const leaf = (text) =>
    Array.from(document.querySelectorAll("span,div")).find((el) => el.children.length === 0 && el.textContent.trim() === text);

  function prepare() {
    K.freezeStyles();
    const label = leaf("Task success (7 days)");
    const stats = Array.from(label.parentElement.parentElement.children).map((cell) => {
      const el = cell.firstElementChild;
      const text = el.textContent.trim();
      el.style.display = "inline-block";
      el.style.transformOrigin = "left bottom";
      return { el, n: Number.parseInt(text, 10), suffix: text.endsWith("%") ? "%" : "" };
    });
    const items = Array.from(leaf("Needs attention").parentElement.querySelectorAll("ul > li"));
    const svg = document.querySelector(".recharts-wrapper svg.recharts-surface");
    const box = svg.getBoundingClientRect();
    // The plot is revealed left to right; the axes and their labels stay in place.
    const xAxis = svg.querySelector(".recharts-xAxis .recharts-cartesian-axis-line")?.getBoundingClientRect();
    const yAxis = svg.querySelector(".recharts-yAxis .recharts-cartesian-axis-line")?.getBoundingClientRect();
    const plotLeft = yAxis ? yAxis.right - box.left : 0;
    const baseline = xAxis ? xAxis.top - box.top : box.height;
    const link = items[0].querySelector("a");
    S = { stats, items, svg, w: box.width, h: box.height, plotLeft, baseline, link, pointer: K.pointer() };
  }

  function renderChart(t) {
    const p = K.prog(t, T.chart[0], T.chart[1], "inOut");
    if (p >= 1) {
      S.svg.style.clipPath = "";
      return;
    }
    const x = (S.plotLeft + (S.w - S.plotLeft) * p).toFixed(1);
    const b = (S.baseline + 1).toFixed(1);
    S.svg.style.clipPath = `polygon(0 0, ${x}px 0, ${x}px ${b}px, ${S.w}px ${b}px, ${S.w}px ${S.h}px, 0 ${S.h}px)`;
  }

  function render(t) {
    S.stats.forEach((s, i) => {
      const a = T.stats[0] + i * T.stagger;
      const b = T.stats[1] + i * T.stagger;
      s.el.textContent = `${Math.round(s.n * K.prog(t, a, b))}${s.suffix}`;
      s.el.style.transform = `scale(${K.bump(t, b, 0.12, 0.3)})`;
    });

    S.items.forEach((li, i) => {
      const at = T.items + i * T.itemStep;
      const p = K.prog(t, at, at + 0.3);
      li.style.opacity = String(p);
      li.style.transform = p < 1 ? `translateY(${((1 - p) * RISE).toFixed(1)}px)` : "";
    });

    renderChart(t);

    S.link.style.textDecoration = t >= T.hover ? "underline" : "";
    const [x, y] = K.center(S.link, 0.3, 0.6);
    S.pointer.at(t, [[T.pointer, 1250, 900], [T.hover, x, y]]);
  }

  window.__ui = { duration: 5, prepare, render };
})();
