// Workflows page, 5 s: events arrive. A Jira event lights the LeaveDesk Delivery trigger, a Teams
// mention lights Policy Q&A, an Azure DevOps tag lights UI tests; each row's last run ticks to
// "just now" and its case counts bump. The pointer then hovers "New workflow".
// Data comes from tools/app-demo-data.mjs.
(() => {
  const K = window.__uiKit;
  const T = { pointer: 3.35, hover: 4.15 };
  // [workflow, project, trigger chip, provider colour, event time]; rows with no open cases get an "open" badge
  const EVENTS = [
    ["Delivery", "LeaveDesk", "Issue status changed", "38,132,255", 0.45],
    ["Policy Q&A", "HR portal", "Bot mentioned in a channel", "123,131,235", 1.35],
    ["UI tests", "Mobile app", "Tag added to a work item", "56,152,236", 2.25],
  ];
  const COUNT_DELAY = 0.35;
  let S = null;

  const byText = (root, sel, text) =>
    Array.from(root.querySelectorAll(sel)).find((el) => el.textContent.trim() === text) ?? null;

  function lockColumns(table) {
    const heads = Array.from(table.tHead.rows[0].cells);
    const widths = heads.map((th) => th.getBoundingClientRect().width);
    heads.forEach((th, i) => {
      th.style.width = `${widths[i]}px`;
    });
    table.style.tableLayout = "fixed";
  }

  function bumpable(el) {
    el.style.display = "inline-block";
    el.style.transformOrigin = "left center";
    return el;
  }

  function prepare() {
    K.freezeStyles();
    const table = document.querySelector("table");
    lockColumns(table);
    const rows = Array.from(table.tBodies[0].rows);
    const openTemplate = rows.map((r) => byText(r.cells[4], '[data-slot="badge"]', "1 open")).find(Boolean);
    const events = EVENTS.map(([name, project, chipText, rgb, at]) => {
      const row = rows.find(
        (r) => r.cells[0].textContent.trim().startsWith(name) && r.cells[2].textContent.trim() === project
      );
      const chip = byText(row.cells[1], '[data-slot="badge"]', chipText);
      const cases = bumpable(Array.from(row.cells[4].querySelectorAll("span")).find((s) => s.textContent.trim().endsWith("cases")));
      let open = row.cells[4].querySelector('[data-slot="badge"]');
      let added = false;
      if (!open) {
        open = openTemplate.cloneNode(true);
        open.textContent = "0 open";
        cases.parentElement.append(open);
        added = true;
      }
      open.style.transformOrigin = "left center";
      const last = bumpable(K.wrapContents(row.cells[3]));
      return {
        row,
        chip,
        rgb,
        at,
        cases,
        casesN: Number.parseInt(cases.textContent, 10),
        open,
        openN: Number.parseInt(open.textContent, 10),
        added,
        last,
        lastText: last.textContent,
      };
    });
    const button = byText(document, "a,button", "New workflow");
    S = { events, button, pointer: K.pointer() };
  }

  function renderEvent(e, t) {
    // The trigger chip lights in the provider's colour, rings out and settles back.
    const glow = t >= e.at ? 1 - K.prog(t, e.at + 0.15, e.at + 1.4, "linear") : 0;
    const ring = t >= e.at ? K.prog(t, e.at, e.at + 0.7) : 0;
    e.chip.style.backgroundColor = glow > 0 ? `rgba(${e.rgb},${(0.32 * glow).toFixed(3)})` : "";
    e.chip.style.borderColor = glow > 0 ? `rgba(${e.rgb},${(0.9 * glow).toFixed(3)})` : "";
    e.chip.style.boxShadow =
      ring > 0 && ring < 1 ? `0 0 0 ${(1 + 8 * ring).toFixed(1)}px rgba(${e.rgb},${(0.45 * (1 - ring)).toFixed(3)})` : "";
    e.chip.style.transform = `scale(${K.bump(t, e.at, 0.1, 0.3)})`;
    e.row.style.backgroundColor = K.flash(t, e.at, e.rgb, 0.12, 1.5);

    const c = e.at + COUNT_DELAY;
    const counted = t >= c;
    e.cases.textContent = `${K.fmt(e.casesN + (counted ? 1 : 0))} cases`;
    e.cases.style.transform = `scale(${K.bump(t, c, 0.16, 0.32)})`;
    e.open.textContent = `${e.openN + (counted ? 1 : 0)} open`;
    e.open.style.transform = `scale(${K.bump(t, c, 0.18, 0.32)})`;
    e.open.style.display = e.added && !counted ? "none" : "";
    e.open.style.opacity = e.added ? String(K.prog(t, c, c + 0.25)) : "";
    e.last.textContent = counted ? "just now" : e.lastText;
    e.last.style.transform = `scale(${K.bump(t, c, 0.12, 0.3)})`;
  }

  function render(t) {
    for (const e of S.events) {
      renderEvent(e, t);
    }
    S.button.style.filter = t >= T.hover ? "brightness(1.18)" : "";
    const [x, y] = K.center(S.button, 0.42, 0.6);
    S.pointer.at(t, [[T.pointer, 1480, 720], [T.hover, x, y]]);
  }

  window.__ui = { duration: 5, prepare, render };
})();
