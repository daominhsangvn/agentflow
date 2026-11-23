// Runs page, 5 s: a Teams run and then a Jira run arrive at the top, the LD-14 run finishes and gets
// its pull request, the counters follow, the run waiting for a person pulses, and the pointer goes
// to the new pull request and clicks it. Data comes from tools/app-demo-data.mjs.
(() => {
  const K = window.__uiKit;
  const T = { teams: 0.45, jira: 1.4, done: 2.5, ask: [3.0, 3.55], pointer: 3.15, hover: 4.0, click: 4.35 };
  const NEW_ROW = "99,102,241";
  const DONE_ROW = "34,197,94";
  let S = null;

  const badge = (row, text) =>
    Array.from(row.querySelectorAll('[data-slot="badge"]')).find((b) => b.textContent.trim() === text);

  // The value span of the summary card whose label starts with `label` ("Runs", "Active", ...).
  function cardValue(label) {
    const card = Array.from(document.querySelectorAll('[data-slot="card"]')).find((c) =>
      c.textContent.trim().toLowerCase().startsWith(label)
    );
    return card?.querySelector('[data-slot="card-title"] span') ?? null;
  }

  function newRow(template, swaps) {
    const row = template.cloneNode(true);
    for (const [from, to] of swaps) {
      K.replaceText(row, from, to);
    }
    return row;
  }

  function prepare() {
    K.freezeStyles();
    const body = document.querySelector("table tbody");
    const rows = Array.from(body.rows);
    const find = (s) => rows.find((r) => r.textContent.includes(s));
    const ld14 = find("LD-14");
    const jira = newRow(ld14, [
      ["LD-14", "LD-15"],
      ["Add public holidays to the calendar", "Show team leave in the calendar export"],
      ["3 min ago", "just now"],
    ]);
    const teams = newRow(find("teams-8c41d2e7a0"), [
      ["teams-8c41d2e7a0", "teams-5d2e91c4b7"],
      ["Customer can't reset password", "Can I swap a shift next week?"],
      ["Ticket triage", "Policy Q&A"],
      ["6 min ago", "just now"],
    ]);
    body.prepend(jira, teams);

    // LD-14 finishes: a Succeeded badge beside its Running one, a finish time and a pull request.
    const running = badge(ld14, "Running step");
    const done = badge(rows.find((r) => badge(r, "Succeeded")), "Succeeded").cloneNode(true);
    done.style.transformOrigin = "left center";
    running.after(done);
    const prDash = K.wrapContents(ld14.cells[3]);
    const pr = find("PAY-41").cells[3].firstElementChild.cloneNode(true);
    K.replaceText(pr, "payments-api #212", "leavedesk-app #7");
    const link = pr.querySelector("a");
    link.href = "https://github.com/acme/leavedesk-app/pull/7";
    link.title = "acme/leavedesk-app";
    ld14.cells[3].append(pr);
    const finDash = K.wrapContents(ld14.cells[5]);
    const finNow = document.createElement("span");
    finNow.textContent = "just now";
    ld14.cells[5].append(finNow);

    const ask = badge(find("DATA-5"), "Needs input");
    const counters = { runs: cardValue("runs"), active: cardValue("active"), succeeded: cardValue("succeeded") };
    for (const el of Object.values(counters)) {
      if (el) {
        el.style.display = "inline-block";
        el.style.transformOrigin = "left bottom";
      }
    }
    S = {
      rows: Array.from(body.rows),
      jira,
      teams,
      ld14,
      running,
      done,
      prDash,
      pr,
      link,
      finDash,
      finNow,
      ask,
      counters,
      // Measured after insertion: the lift for each new row is that row's own height.
      hJira: jira.getBoundingClientRect().height,
      hTeams: teams.getBoundingClientRect().height,
      pointer: K.pointer(),
    };
  }

  function counter(el, t, base, changes) {
    if (!el) {
      return;
    }
    const past = changes.filter(([at]) => t >= at);
    el.textContent = K.fmt(base + past.reduce((n, [, d]) => n + d, 0));
    el.style.transform = `scale(${past.length ? K.bump(t, past.at(-1)[0]) : 1})`;
  }

  function render(t) {
    // A new row first opens its gap (the rows below slide down), then fades in and settles.
    const open = (at) => K.prog(t, at, at + 0.35, "inOut");
    const show = (at) => K.prog(t, at + 0.2, at + 0.55);
    const [oTeams, oJira, fTeams, fJira] = [open(T.teams), open(T.jira), show(T.teams), show(T.jira)];
    const drop = new Map([
      [S.jira, -6 * (1 - fJira)],
      [S.teams, -6 * (1 - fTeams)],
    ]);
    S.rows.forEach((row, i) => {
      const lift = (i > 0 ? S.hJira * (1 - oJira) : 0) + (i > 1 ? S.hTeams * (1 - oTeams) : 0);
      const dy = (drop.get(row) ?? 0) - lift;
      row.style.transform = Math.abs(dy) > 0.01 ? `translateY(${dy.toFixed(2)}px)` : "";
    });
    S.jira.style.opacity = String(fJira);
    S.teams.style.opacity = String(fTeams);
    S.jira.style.backgroundColor = K.flash(t, T.jira + 0.2, NEW_ROW);
    S.teams.style.backgroundColor = K.flash(t, T.teams + 0.2, NEW_ROW);

    const done = t >= T.done;
    S.running.style.display = done ? "none" : "";
    S.done.style.display = done ? "" : "none";
    S.done.style.transform = `scale(${K.bump(t, T.done, 0.2, 0.35)})`;
    const hovered = t >= T.hover;
    S.ld14.style.backgroundColor = hovered ? "rgba(255,255,255,0.045)" : K.flash(t, T.done, DONE_ROW, 0.16, 1.5);
    S.finDash.style.display = done ? "none" : "";
    S.finNow.style.display = done ? "" : "none";
    const pPr = K.prog(t, T.done + 0.25, T.done + 0.6);
    S.prDash.style.display = pPr > 0 ? "none" : "";
    S.pr.style.display = pPr > 0 ? "" : "none";
    S.pr.style.opacity = String(pPr);
    S.link.style.textDecoration = hovered ? "underline" : "";

    counter(S.counters.runs, t, 1284, [[T.teams + 0.2, 1], [T.jira + 0.2, 1]]);
    counter(S.counters.active, t, 7, [[T.teams + 0.2, 1], [T.jira + 0.2, 1], [T.done, -1]]);
    counter(S.counters.succeeded, t, 1211, [[T.done, 1]]);

    const pulse = T.ask.reduce((a, at) => Math.max(a, t >= at ? 1 - K.prog(t, at, at + 0.55, "linear") : 0), 0);
    S.ask.style.boxShadow = pulse > 0 ? `0 0 0 ${(2 + 7 * (1 - pulse)).toFixed(1)}px rgba(250,204,21,${(0.55 * pulse).toFixed(3)})` : "";

    const [x, y] = K.center(S.link, 0.35, 0.55);
    S.pointer.at(t, [[T.pointer, 1660, 1010], [T.hover, x, y]], [T.click]);
  }

  window.__ui = { duration: 5, prepare, render };
})();
