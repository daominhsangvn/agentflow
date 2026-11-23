// Agents page, 5 s: the machines in view come online one by one (grey dot to green Online, in a
// cascade down the rows), the summary chips count up to "21 online" / "1 offline", and the
// QC · Testing health check flips from "Not checked" to "Passed". The table stays above the fold,
// so the section below it never shows. Data comes from tools/app-demo-data.mjs.
(() => {
  const K = window.__uiKit;
  const T = { first: 0.35, step: 0.17, health: 2.75 };
  const ONLINE = "34,197,94";
  let S = null;

  const chip = (text) =>
    Array.from(document.querySelectorAll('[data-testid="agent-fleet-summary"] [data-slot="badge"]')).find(
      (b) => b.textContent.trim() === text
    );

  function prepare() {
    K.freezeStyles();
    const table = document.querySelector("table");
    const heads = Array.from(table.tHead.rows[0].cells);
    const widths = heads.map((th) => th.getBoundingClientRect().width);
    heads.forEach((th, i) => {
      th.style.width = `${widths[i]}px`;
    });
    table.style.tableLayout = "fixed";
    // Only the rows in view take part; the ones below the fold stay as they are.
    const fold = window.innerHeight;
    const rows = Array.from(table.tBodies[0].rows).filter(
      (r) => r.getBoundingClientRect().top < fold && r.cells[2].textContent.trim() === "Online"
    );
    const items = rows.map((row, i) => {
      const status = row.cells[2].firstElementChild;
      const dot = status.firstElementChild;
      dot.style.transformOrigin = "center";
      const label = status.lastChild;
      return { row, status, dot, label, at: T.first + i * T.step };
    });
    const qc = rows.find((r) => r.cells[0].textContent.includes("QC · Testing"));
    const health = K.wrapContents(qc.cells[3]);
    health.style.display = "inline-block";
    health.style.transformOrigin = "left center";
    const online = chip("21 online");
    const offline = chip("1 offline");
    // Each chip keeps its widest width ("13 offline"), so the chips beside it never shift.
    for (const [c, widest] of [[online, "21 online"], [offline, `${1 + items.length} offline`]]) {
      const text = c.textContent;
      c.textContent = widest;
      c.style.minWidth = `${c.getBoundingClientRect().width}px`;
      c.textContent = text;
      c.style.transformOrigin = "center";
    }
    S = { items, qc, health, online, offline };
  }

  function renderItem(it, t) {
    const on = t >= it.at;
    it.status.classList.toggle("text-muted-foreground", !on);
    it.dot.classList.toggle("bg-success", on);
    it.dot.classList.toggle("bg-muted-foreground", !on);
    it.label.nodeValue = on ? "Online" : "Offline";
    it.dot.style.transform = `scale(${K.bump(t, it.at, 0.7, 0.35)})`;
    const ring = on ? K.prog(t, it.at, it.at + 0.6) : 0;
    it.dot.style.boxShadow =
      ring > 0 && ring < 1 ? `0 0 0 ${(1 + 6 * ring).toFixed(1)}px rgba(${ONLINE},${(0.5 * (1 - ring)).toFixed(3)})` : "";
    it.row.style.backgroundColor = K.flash(t, it.at, ONLINE, 0.07, 0.9);
  }

  function render(t) {
    let came = 0;
    for (const it of S.items) {
      renderItem(it, t);
      came += t >= it.at ? 1 : 0;
    }
    const waiting = S.items.length - came;
    const last = S.items.filter((it) => t >= it.at).at(-1);
    S.online.textContent = `${21 - waiting} online`;
    S.offline.textContent = `${1 + waiting} offline`;
    S.online.style.transform = `scale(${last ? K.bump(t, last.at, 0.12, 0.25) : 1})`;

    const passed = t >= T.health;
    S.health.textContent = passed ? "Passed" : "Not checked";
    S.health.style.color = passed ? "" : "rgb(161,161,170)";
    S.health.style.transform = `scale(${K.bump(t, T.health, 0.18, 0.32)})`;
    if (t >= T.health) {
      S.qc.style.backgroundColor = K.flash(t, T.health, ONLINE, 0.14, 1.4);
    }
  }

  window.__ui = { duration: 5, prepare, render };
})();
