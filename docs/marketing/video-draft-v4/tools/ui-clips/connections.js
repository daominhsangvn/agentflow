// Connections page, 5 s: Jira, Microsoft Teams and Azure DevOps appear one by one, each status
// settles from Checking to Active with a pulse, a Jira event arrives ("Last delivery" ticks to
// "just now"), and the pointer clicks Test on the Jira row, which pulses Active once more.
// Data comes from tools/app-demo-data.mjs.
(() => {
  const K = window.__uiKit;
  const T = { rows: [0.3, 0.85, 1.4], settle: 0.5, delivery: 2.45, pointer: 2.95, hover: 3.75, click: 4.1, tested: 4.3 };
  const NEW_ROW = "99,102,241";
  const ACTIVE = "34,197,94";
  let S = null;

  // The bordered box around the table: its height opens row by row, so each row opens its gap first.
  function frameOf(table) {
    for (let el = table; el && el !== document.body; el = el.parentElement) {
      if (getComputedStyle(el).borderTopWidth !== "0px") {
        return el;
      }
    }
    return table.parentElement;
  }

  function prepare() {
    K.freezeStyles();
    const table = document.querySelector("table");
    const rows = Array.from(table.tBodies[0].rows);
    // Column widths stay as the app laid them out, so the wider "Checking" badge moves nothing.
    const heads = Array.from(table.tHead.rows[0].cells);
    const widths = heads.map((th) => th.getBoundingClientRect().width);
    heads.forEach((th, i) => {
      th.style.width = `${widths[i]}px`;
    });
    table.style.tableLayout = "fixed";
    const frame = frameOf(table);
    const frameH = frame.getBoundingClientRect().height;
    const rowH = rows.map((r) => r.getBoundingClientRect().height);
    frame.style.overflow = "hidden";
    const items = rows.map((row) => {
      const status = row.querySelector('[data-slot="badge"]');
      status.style.display = "inline-flex";
      status.style.transformOrigin = "left center";
      return { row, status };
    });
    const jira = rows.find((r) => r.cells[0].textContent.includes("Jira"));
    const last = K.wrapContents(jira.cells[3]);
    last.style.display = "inline-block";
    last.style.transformOrigin = "left center";
    const test = Array.from(jira.querySelectorAll("button")).find((b) => b.textContent.trim() === "Test");
    S = {
      frame,
      // Height of the box with no rows; each row adds its own measured height.
      emptyH: frameH - rowH.reduce((a, b) => a + b, 0),
      rowH,
      items,
      jira,
      jiraStatus: items[rows.indexOf(jira)].status,
      last,
      lastText: last.textContent,
      test,
      pointer: K.pointer(),
    };
  }

  function pulse(t, at, len = 0.6) {
    if (t < at) {
      return 0;
    }
    return Math.max(0, 1 - K.prog(t, at, at + len, "linear"));
  }

  function renderStatus(el, t, at, extra = []) {
    const active = t >= at;
    el.textContent = active ? "Active" : "Checking";
    // Before it settles the badge is neutral; the app's own classes give the Active look.
    el.style.color = active ? "" : "rgb(161,161,170)";
    el.style.borderColor = active ? "" : "rgba(255,255,255,0.12)";
    el.style.backgroundColor = active ? "" : "rgba(255,255,255,0.05)";
    const kicks = [at, ...extra].filter((k) => t >= k);
    const kick = kicks.at(-1);
    el.style.transform = `scale(${kick === undefined ? 1 : K.bump(t, kick, 0.16, 0.3)})`;
    const p = kick === undefined ? 0 : pulse(t, kick);
    el.style.boxShadow = p > 0 ? `0 0 0 ${(2 + 7 * (1 - p)).toFixed(1)}px rgba(${ACTIVE},${(0.5 * p).toFixed(3)})` : "";
  }

  function render(t) {
    let h = S.emptyH;
    S.items.forEach(({ row, status }, i) => {
      const at = T.rows[i];
      h += S.rowH[i] * K.prog(t, at, at + 0.35, "inOut");
      const f = K.prog(t, at + 0.2, at + 0.55);
      row.style.opacity = String(f);
      row.style.transform = f < 1 ? `translateY(${(-6 * (1 - f)).toFixed(2)}px)` : "";
      if (row !== S.jira) {
        row.style.backgroundColor = K.flash(t, at + 0.2, NEW_ROW, 0.14, 1.2);
      }
      renderStatus(status, t, at + T.settle, row === S.jira ? [T.tested] : []);
    });
    S.frame.style.height = `${h.toFixed(2)}px`;

    const now = t >= T.delivery;
    S.last.textContent = now ? "just now" : S.lastText;
    S.last.style.transform = `scale(${K.bump(t, T.delivery, 0.16, 0.32)})`;
    S.last.style.color = now ? `rgba(255,255,255,${(0.95 - 0.35 * K.prog(t, T.delivery, T.delivery + 1.4)).toFixed(3)})` : "";
    const hovered = t >= T.hover;
    S.jira.style.backgroundColor = K.flash(t, T.delivery, NEW_ROW, 0.2, 1.4) || K.flash(t, T.rows[0] + 0.2, NEW_ROW, 0.14, 1.2);
    S.test.style.backgroundColor = hovered ? "var(--muted)" : "";

    const [x, y] = K.center(S.test, 0.5, 0.6);
    S.pointer.at(t, [[T.pointer, 1500, 620], [T.hover, x, y]], [T.click]);
  }

  window.__ui = { duration: 5, prepare, render };
})();
