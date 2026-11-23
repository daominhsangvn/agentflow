// The animatic: every scene of docs/marketing/explainer-video-plan.md (v2), built on js/engine.js.
// Times come from js/timeline.js (scene starts and VO windows), so a re-generated VO re-times
// the picture without edits here.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const TL = window.TIMELINE;
  const params = new URLSearchParams(location.search);
  const LANG = params.get("lang") === "vi" ? "vi" : "en";
  const L = (en, vi) => (LANG === "vi" ? vi : en);
  const { add, anim, hook, prog, clamp, lerp, valAt, ease, pathPoint } = E;

  const SC = {};
  for (const sc of TL.scenes) {
    SC[sc.id] = sc;
  }
  const S = (id, dt = 0) => SC[id].start + dt;
  const END = (id, dt = 0) => SC[id].end + dt;
  const V = (id, f = 0) => SC[id].voStart + SC[id].voDur * f;
  const VE = (id, dt = 0) => SC[id].voStart + SC[id].voDur + dt;

  const BRAND = "../../../packages/design-system/brand";
  const MARK = `${BRAND}/agentflow-mark.svg`;
  const LOGO = `${BRAND}/logos/Horizontal/agentflow-logo-horizontal-on-dark.svg`;

  const stage = document.getElementById("stage");
  E.stage = stage;
  document.documentElement.lang = LANG;

  // ------------------------------------------------------------------ helpers
  const div = (parent, o) => add(Object.assign({ parent }, o));
  const box = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

  function layer(parent, z) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "layer");
    svg.setAttribute("width", "1920");
    svg.setAttribute("height", "1080");
    svg.setAttribute("viewBox", "0 0 1920 1080");
    if (z != null) {
      svg.style.zIndex = String(z);
    }
    parent.appendChild(svg);
    return svg;
  }
  function path(svg, d, cls, o = 1, draw = false) {
    const attrs = { d };
    if (draw) {
      attrs.pathLength = "1";
    }
    const node = add({ parent: svg, svgTag: "path", cls: draw ? `${cls} draw` : cls, attrs, o });
    if (draw) {
      node.style.strokeDasharray = "1 1";
    }
    return node;
  }
  // Appends a segment to a track, pinned to the value the track has just before it starts.
  function seg(n, prop, frames) {
    const t0 = frames[0][0];
    const cur = valAt(n, prop, t0 - 0.001);
    anim(n, { [prop]: [[t0 - 0.001, cur]].concat(frames) });
    return n;
  }
  function pop(n, t, d = 0.45, from = 0.86) {
    seg(n, "o", [[t, 0], [t + d * 0.6, 1, "out"]]);
    seg(n, "s", [[t, from], [t + d, 1, "back"]]);
    return n;
  }
  const fadeIn = (n, t, d = 0.4) => seg(n, "o", [[t, 0], [t + d, 1, "out"]]);
  const fadeOut = (n, t, d = 0.4) => seg(n, "o", [[t, valAt(n, "o", t)], [t + d, 0, "inOut"]]);
  function to(n, t0, t1, props, e = "inOut") {
    for (const k of Object.keys(props)) {
      seg(n, k, [[t0, valAt(n, k, t0)], [t1, props[k], e]]);
    }
    return n;
  }
  const topLeft = (n, cx, cy) => ({ x: cx - n._it.w / 2, y: cy - n._it.h / 2 });
  function toC(n, t0, t1, cx, cy, extra = {}, e = "inOut") {
    const p = topLeft(n, cx, cy);
    return to(n, t0, t1, Object.assign({ x: p.x, y: p.y }, extra), e);
  }
  const drawIn = (p, t0, t1) => anim(p, { draw: [[t0, 0], [t1, 1, "inOut"]] });
  function march(p, speed = 36) {
    hook((t) => {
      p.style.strokeDashoffset = String(-t * speed);
    });
    return p;
  }
  // events: [[t, value], ...]; apply(value) runs whenever the current value changes.
  function stepper(events, apply) {
    events.sort((a, b) => a[0] - b[0]);
    let last = Symbol("init");
    hook((t) => {
      let v = null;
      for (const ev of events) {
        if (t >= ev[0]) {
          v = ev[1];
        } else {
          break;
        }
      }
      if (v !== last) {
        last = v;
        apply(v);
      }
    });
  }
  function classWindows(n, cls, list) {
    hook((t) => {
      n.classList.toggle(cls, list.some(([a, b]) => t >= a && t < b));
    });
  }
  // Opacity frames for a list of [from, to] windows (merged when they overlap).
  function windowFrames(list, fade = 0.3) {
    const sorted = list.slice().sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const w of sorted) {
      const lastW = merged[merged.length - 1];
      if (lastW && w[0] <= lastW[1] + fade * 2) {
        lastW[1] = Math.max(lastW[1], w[1]);
      } else {
        merged.push([w[0], w[1]]);
      }
    }
    const frames = [[0, 0]];
    for (const [a, b] of merged) {
      frames.push([a, 0], [a + fade, 1, "out"], [b, 1], [b + fade, 0, "inOut"]);
    }
    return frames;
  }

  // ------------------------------------------------------------------ vocabulary
  const ICON = {
    board: `<svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="22" rx="4"/><line x1="12" y1="5" x2="12" y2="27"/><line x1="20" y1="5" x2="20" y2="27"/><rect class="f" x="5.6" y="9" width="4" height="5" rx="1"/><rect class="f" x="14" y="9" width="4" height="8" rx="1"/><rect class="f" x="22.4" y="9" width="4" height="4" rx="1"/></svg>`,
    doc: `<svg viewBox="0 0 32 32"><path d="M8 3h11l6 6v20H8z"/><path d="M19 3v6h6"/><line x1="11" y1="15" x2="22" y2="15"/><line x1="11" y1="19" x2="22" y2="19"/><line x1="11" y1="23" x2="18" y2="23"/></svg>`,
    branch: `<svg viewBox="0 0 32 32"><circle cx="9" cy="7" r="3"/><circle cx="9" cy="25" r="3"/><circle cx="23" cy="11" r="3"/><line x1="9" y1="10" x2="9" y2="22"/><path d="M23 14c0 6-14 4-14 8"/></svg>`,
    person: `<svg viewBox="0 0 32 32"><circle cx="16" cy="11.5" r="5.5"/><path d="M6 27c1.5-5.5 5.5-8 10-8s8.5 2.5 10 8"/></svg>`,
    key: `<svg viewBox="0 0 32 32"><circle cx="10" cy="16" r="5.5"/><path d="M15.5 16H29M25 16v5M21 16v3.5"/></svg>`,
    spark: `<svg viewBox="0 0 32 32"><path d="M16 2.5l3 8.5 8.5 3-8.5 3-3 8.5-3-8.5-8.5-3 8.5-3z"/></svg>`,
    cursor: `<svg viewBox="0 0 32 32"><path d="M6 3l19 13.5-8.2 1.4 4.6 9.2-3.6 1.8-4.6-9.2L6 25z"/></svg>`,
    clock: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/><line class="hand" x1="16" y1="16" x2="16" y2="8"/><line x1="16" y1="16" x2="21" y2="18"/></svg>`,
  };
  const ART = {
    requirements: `<svg viewBox="0 0 24 24" class="art art-req"><path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/><line x1="8.5" y1="11" x2="16" y2="11"/><line x1="8.5" y1="14.5" x2="16" y2="14.5"/><line x1="8.5" y1="18" x2="13" y2="18"/></svg>`,
    plan: `<svg viewBox="0 0 24 24" class="art art-plan"><rect x="3.5" y="4" width="4" height="4" rx="1"/><line x1="10" y1="6" x2="20.5" y2="6"/><rect x="3.5" y="10" width="4" height="4" rx="1"/><line x1="10" y1="12" x2="20.5" y2="12"/><rect x="3.5" y="16" width="4" height="4" rx="1"/><line x1="10" y1="18" x2="17" y2="18"/></svg>`,
    code: `<svg viewBox="0 0 24 24" class="art art-code"><path d="M8 6l-5 6 5 6"/><path d="M16 6l5 6-5 6"/><path d="M13.5 4l-3 16"/></svg>`,
    testplan: `<svg viewBox="0 0 24 24" class="art art-tp"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
    results: `<svg viewBox="0 0 24 24" class="art art-res"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/><path class="chk" d="M11.5 15.5l2.5 2.5 5-5.5"/></svg>`,
    answer: `<svg viewBox="0 0 24 24" class="art art-ans"><path d="M4 5h16v10H10l-5 4v-4H4z"/></svg>`,
    gray: `<svg viewBox="0 0 24 24" class="art art-gray"><path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/><line x1="8.5" y1="12" x2="16" y2="12"/><line x1="8.5" y1="16" x2="14" y2="16"/></svg>`,
  };
  const SERVER = `<svg viewBox="0 0 104 96" class="mach"><rect x="20" y="4" width="64" height="88" rx="7"/><line x1="20" y1="26" x2="84" y2="26"/><line x1="20" y1="48" x2="84" y2="48"/><line x1="20" y1="70" x2="84" y2="70"/><circle class="led" cx="30" cy="15" r="3"/><circle class="led" cx="30" cy="37" r="3"/><circle class="led" cx="30" cy="59" r="3"/><circle class="led" cx="30" cy="81" r="3"/><line x1="50" y1="15" x2="76" y2="15"/><line x1="50" y1="37" x2="76" y2="37"/><line x1="50" y1="59" x2="76" y2="59"/><line x1="50" y1="81" x2="76" y2="81"/></svg>`;
  const LAPTOP = `<svg viewBox="0 0 104 96" class="mach"><rect x="16" y="14" width="72" height="50" rx="5"/><path d="M6 72h92l-6 10H12z"/><text class="prompt" x="27" y="46">&gt;_</text></svg>`;
  const RING = `<svg viewBox="0 0 140 140" class="ring"><circle class="ring-bg" cx="70" cy="70" r="62"/><circle class="ring-run" cx="70" cy="70" r="62"/><circle class="ring-done" cx="70" cy="70" r="62"/></svg>`;

  const ROLE = {
    ba: { name: "BA", job: L("Requirements", "Yêu cầu"), c: "var(--ba)", cl: "var(--ba-l)" },
    eng: { name: "Engineering", job: L("Code", "Viết code"), c: "var(--eng)", cl: "var(--eng-l)" },
    qc: { name: "QC", job: L("Testing", "Kiểm thử"), c: "var(--qc)", cl: "var(--qc-l)" },
    ppl: { name: L("People", "Con người"), job: "", c: "var(--people)", cl: "var(--people)" },
    none: { name: "", job: "", c: "#6d707b", cl: "#a3a6b1" },
  };
  const roleStyle = (k) => `--c:${ROLE[k].c};--c-l:${ROLE[k].cl}`;
  const badgePill = (k) =>
    `<div class="badge-pill" style="${roleStyle(k)}"><span class="dot"></span>${ROLE[k].name} <span class="job">· ${ROLE[k].job}</span></div>`;

  // Layout (1920 x 1080). Tools left, AgentFlow centre, agents right, people on top.
  const HUB = [960, 560];
  const TOOL_Y = { jira: 390, conf: 560, git: 730 };
  const TOOL_EDGE = 440;
  const MC = { ba: [1520, 390], eng: [1520, 560], qc: [1520, 730] };
  const MACH_EDGE = 1450;
  const GATE = [1251, 560];
  const PILL = [395, 177];

  // ------------------------------------------------------------------ containers
  const world = div(stage, { id: "world", w: 1920, h: 1080, origin: "0 0" });
  div(world, { cls: "bg-grid", w: 1920, h: 1080, origin: "0 0" });
  const map = div(world, { id: "map", w: 1920, h: 1080, origin: "0 0" });
  const mapSvg = layer(map);
  mapSvg.innerHTML =
    '<defs><linearGradient id="flow-gradient" gradientUnits="userSpaceOnUse" x1="420" y1="0" x2="1520" y2="0"><stop offset="0" stop-color="#00CCFE"/><stop offset="0.55" stop-color="#01B8FC"/><stop offset="1" stop-color="#078AF5"/></linearGradient></defs>';
  const chaos = div(world, { id: "chaos", w: 1920, h: 1080, origin: "0 0" });
  const chaosSvg = layer(chaos);
  const over = div(world, { id: "over", w: 1920, h: 1080, origin: "0 0" });
  const overSvg = layer(over, 40);
  const hud = div(world, { id: "hud", w: 1920, h: 1080, origin: "0 0" });
  const hudSvg = layer(hud);
  const vignette = div(world, { cls: "vignette", w: 1920, h: 1080, origin: "0 0", o: 0 });

  // Event registries, turned into hooks at the end.
  const mState = { ba: [], eng: [], qc: [] };
  const tileText = { jira: [], conf: [], git: [] };
  const tileFlash = { jira: [], conf: [], git: [] };
  const pillEv = [];
  const flowEv = [];
  const gateEv = [];
  const gateWin = [];
  const hubFlash = [];

  // ------------------------------------------------------------------ the map
  const toolDefs = [
    { k: "jira", title: "Jira · Azure DevOps · Teams", sub: L("where work starts", "nơi công việc bắt đầu"), icon: ICON.board },
    { k: "conf", title: "Confluence", sub: L("documents", "tài liệu"), icon: ICON.doc },
    { k: "git", title: "Git", sub: "code", icon: ICON.branch },
  ];
  const tools = {};
  toolDefs.forEach((d, i) => {
    const n = div(map, {
      cls: "tile",
      w: 380,
      h: 118,
      x: 60,
      y: TOOL_Y[d.k] - 59,
      o: 0,
      html: `<div class="tile-icon">${d.icon}</div><div class="tile-text"><div class="tile-title">${d.title}</div><div class="tile-sub">${d.sub}</div><div class="tile-status"></div></div>`,
    });
    tools[d.k] = { n, status: n.querySelector(".tile-status") };
    pop(n, S("C2", 0.5 + i * 0.18), 0.5, 0.92);
  });

  const toolLines = {};
  for (const k of Object.keys(TOOL_Y)) {
    const y = TOOL_Y[k];
    toolLines[k] = path(mapSvg, `M${TOOL_EDGE},${y} C640,${y} 690,560 868,560`, "line", 1, true);
    drawIn(toolLines[k], S("C4", 1.5), S("C4", 2.5));
  }
  const agLines = {};
  for (const k of Object.keys(MC)) {
    const y = MC[k][1];
    agLines[k] = path(mapSvg, `M1052,560 C1220,560 1270,${y} ${MACH_EDGE},${y}`, "line", 1, true);
    drawIn(agLines[k], S("C4", 1.9), S("C4", 2.9));
  }

  const boundary = div(map, { cls: "boundary", w: 1200, h: 590, x: 700, y: 262, o: 0 });
  const boundaryLabel = div(map, {
    cls: "boundary-label",
    w: 420,
    h: 24,
    x: 1470,
    y: 272,
    o: 0,
    html: L("Your infrastructure", "Hạ tầng của bạn"),
  });

  const hub = div(map, {
    cls: "hub",
    ...box(HUB[0], HUB[1], 184, 184),
    o: 0,
    html: `<div class="hub-ring"></div><div class="hub-core"><img src="${MARK}" alt=""></div>`,
  });
  const hubRing = hub.querySelector(".hub-ring");
  hook((t) => {
    hubRing.style.transform = `rotate(${t * 24}deg)`;
  });
  const hubName = div(map, { cls: "hub-label", ...box(960, 690, 420, 40), o: 0, html: '<div class="hub-name">AgentFlow</div>' });
  const hubRole = div(map, {
    cls: "hub-label",
    ...box(960, 728, 420, 30),
    o: 0,
    html: `<div class="hub-role">${L("Coordinate · Connect", "Điều phối · Kết nối")}</div>`,
  });
  const hubKey = div(map, { cls: "hub-key", ...box(1036, 486, 50, 50), o: 0, html: ICON.key });
  const hubSpark = div(map, {
    cls: "hub-spark",
    ...box(884, 486, 50, 50),
    o: 0,
    html: `${ICON.spark}<span>AI</span>`,
  });

  // The guard: three lights above the path, a dashed barrier across it.
  const gateItems = [L("On a card", "Có trên thẻ"), L("Read / Write", "Đọc / Ghi"), L("Inputs", "Đầu vào")]
    .map((lbl) => `<div class="gate-item"><div class="gate-light"></div><div class="gate-label">${lbl}</div></div>`)
    .join("");
  const gate = div(map, {
    cls: "gate-wrap",
    ...box(GATE[0], 524, 248, 208),
    o: 0,
    html: `<div class="gate">${gateItems}</div><div class="gate-bar"></div>`,
  });
  const gateLights = Array.from(gate.querySelectorAll(".gate-light"));

  const agDefs = [
    { k: "ba", svg: SERVER, where: L("server", "máy chủ") },
    { k: "eng", svg: LAPTOP, where: L("developer's laptop", "laptop của developer") },
    { k: "qc", svg: SERVER, where: L("test server", "máy chủ test") },
  ];
  const ag = {};
  for (const d of agDefs) {
    const [cx, cy] = MC[d.k];
    const m = div(map, { cls: "machine", ...box(cx, cy, 140, 140), o: 0, html: `${RING}${d.svg}` });
    m.style.cssText += `;${roleStyle(d.k)}`;
    const badge = div(map, {
      cls: "badge",
      w: 290,
      h: 70,
      x: cx + 76,
      y: cy - 34,
      origin: "0 50%",
      o: 0,
      html: `${badgePill(d.k)}<div class="badge-sub">${d.where} · Claude Code</div>`,
    });
    ag[d.k] = { m, badge, ringRun: m.querySelector(".ring-run") };
  }
  hook((t) => {
    for (const k of Object.keys(ag)) {
      ag[k].ringRun.style.transform = `rotate(${t * 140}deg)`;
    }
  });

  // People: the person who starts in the middle becomes the Admin of the row.
  const PPL_Y = 200;
  const you = div(map, { cls: "avatar", ...box(HUB[0], HUB[1], 76, 76), o: 0, html: `<div class="avatar-circle" style="width:76px;height:76px">${ICON.person}</div>` });
  const youCircle = you.querySelector(".avatar-circle");
  const youTag = div(map, { cls: "you-tag", ...box(960, 622, 200, 24), o: 0, html: L("you", "bạn") });
  const adminLabel = div(map, { cls: "avatar-label", ...box(780, PPL_Y + 43, 140, 22), o: 0, html: "Admin" });
  adminLabel.style.textAlign = "center";
  const people = [
    { label: "BA", cx: 900 },
    { label: "Engineer", cx: 1020 },
    { label: "QC", cx: 1140 },
  ].map((p) =>
    div(map, {
      cls: "avatar",
      w: 140,
      h: 100,
      x: p.cx - 70,
      y: PPL_Y - 32,
      o: 0,
      html: `<div class="avatar-circle">${ICON.person}</div><div class="avatar-label">${p.label}</div>`,
    })
  );
  const decideTag = div(map, {
    cls: "decide-tag",
    w: 220,
    h: 34,
    x: 1222,
    y: PPL_Y - 17,
    o: 0,
    html: `<b>✓</b>${L("decide", "quyết định")}`,
  });

  // The ticket (Jira) above the tools.
  const ticket = div(map, {
    cls: "ticket",
    w: 380,
    h: 112,
    x: 60,
    y: 150,
    o: 0,
    html: `<div class="tk-top"><span class="tk-key">LD-6</span><span class="tk-pill">To Do</span></div><div class="tk-sum">${L(
      "As a manager, I want a calendar of who in my team is off",
      "Là quản lý, tôi muốn xem lịch ai trong team đang nghỉ"
    )}</div>`,
  });
  const ticketPill = ticket.querySelector(".tk-pill");

  // Flow bar (born from the rules in C8).
  const FLOW = [
    { label: "Requirements", chips: ["ba"], fc: "var(--ba)" },
    { label: "Planning", chips: ["eng", "qc"], fc: "#01b8fc" },
    { label: "Implement", chips: ["eng"], fc: "var(--eng-l)" },
    { label: "Testing", chips: ["qc"], fc: "var(--qc-l)" },
    { label: "Review", chips: ["ppl"], fc: "var(--people)" },
    { label: "Done", chips: [], fc: "var(--ok-l)" },
  ];
  const flow = div(hud, {
    cls: "flowbar",
    w: 1590,
    h: 78,
    x: 165,
    y: 40,
    o: 0,
    html: FLOW.map(
      (f) =>
        `<div class="fcell" style="--fc:${f.fc}"><div class="fcell-label">${f.label}</div><div class="fcell-chips">${f.chips
          .map((c) => `<span class="fchip" style="${roleStyle(c)}">${ROLE[c].name}</span>`)
          .join("")}</div><div class="fcheck">✓</div></div>`
    ).join(""),
  });
  const flowCells = Array.from(flow.querySelectorAll(".fcell"));
  const cellX = (i) => 165 + i * 268 + 125;
  const backArc = path(hudSvg, `M${cellX(3)},36 Q${(cellX(2) + cellX(3)) / 2},-6 ${cellX(2) + 10},34`, "bad-line", 0);
  backArc.style.stroke = "var(--warn)";
  backArc.style.strokeDasharray = "none";
  backArc.style.strokeWidth = "3.5";

  // Cursor and approval stamps.
  const cursor = div(hud, { cls: "cursor", w: 40, h: 40, x: 700, y: 420, o: 0, origin: "0 0", z: 30, html: ICON.cursor });
  const clickRing = div(hud, { cls: "click-ring", w: 44, h: 44, o: 0, z: 29 });
  function click(tClick, x, y, from) {
    const tMove0 = tClick - 0.75;
    if (valAt(cursor, "o", tMove0) < 0.5) {
      const start = from || [x + 170, y + 130];
      seg(cursor, "x", [[tMove0, start[0]]]);
      seg(cursor, "y", [[tMove0, start[1]]]);
      fadeIn(cursor, tMove0, 0.2);
    }
    to(cursor, tMove0 + 0.05, tClick - 0.05, { x: x - 7, y: y - 4 });
    seg(cursor, "s", [[tClick - 0.05, 1], [tClick + 0.05, 0.85], [tClick + 0.22, 1]]);
    seg(clickRing, "x", [[tClick, x - 22]]);
    seg(clickRing, "y", [[tClick, y - 22]]);
    seg(clickRing, "o", [[tClick, 0.9], [tClick + 0.45, 0, "out"]]);
    seg(clickRing, "s", [[tClick, 0.4], [tClick + 0.45, 1.4, "out"]]);
  }
  function stamp(t, cx = 300, cy = 230) {
    const n = div(hud, {
      cls: "stamp",
      ...box(cx, cy, 240, 50),
      o: 0,
      r: -8,
      html: `✓ ${L("Approved", "Đã duyệt")}`,
    });
    pop(n, t, 0.4, 1.5);
    fadeOut(n, t + 1.5, 0.4);
  }
  function setPill(t, text) {
    pillEv.push([t, text]);
    tileText.jira.push([t, `LD-6 · ${text}`]);
  }

  // Travelling things.
  function docTravel(type, pts, t0, segD = 0.55) {
    const n = div(over, { cls: "doc", ...box(pts[0][0], pts[0][1], 52, 58), o: 0, html: ART[type] });
    pop(n, t0, 0.35, 0.6);
    let t = t0 + 0.2;
    for (let i = 1; i < pts.length; i++) {
      toC(n, t, t + segD, pts[i][0], pts[i][1]);
      t += segD;
    }
    fadeOut(n, t - 0.05, 0.25);
    return t;
  }
  function slip({ role, cmd, t0, from = HUB, dy = 0, checks = ["ok", "ok", "ok"], target, hold = 0 }) {
    const r = ROLE[role || "none"];
    const plain = `${r.name ? `${r.name} · ` : ""}${cmd}`;
    const w = Math.round(46 + plain.length * 10.9);
    const n = div(over, {
      cls: "slip",
      ...box(from[0], from[1], w, 48),
      o: 0,
      html: `<div class="slip-bar"></div><div class="slip-text">${r.name ? `<span class="role">${r.name}</span> · ` : ""}${cmd}</div><div class="slip-stamp">${L("REFUSED", "BỊ CHẶN")}</div>`,
    });
    n.style.cssText += `;${roleStyle(role || "none")}`;
    pop(n, t0, 0.35, 0.7);
    const tm = t0 + hold;
    toC(n, tm + 0.15, tm + 0.75, GATE[0], GATE[1] + dy, {}, "inOut");
    const tCheck = tm + 0.8;
    gateEv.push([tCheck, checks]);
    gateWin.push([tm - 0.1, tm + 2.0]);
    const bad = checks.indexOf("bad");
    if (bad === -1) {
      toC(n, tm + 1.3, tm + 1.95, target[0], target[1], { s: 0.45 });
      fadeOut(n, tm + 1.8, 0.2);
      return tm + 1.95;
    }
    const tBad = tCheck + bad * 0.15 + 0.05;
    classWindows(n, "refused", [[tBad, 1e9]]);
    to(n, tBad + 0.7, tBad + 1.2, { y: valAt(n, "y", tBad + 0.7) + 60 });
    fadeOut(n, tBad + 0.75, 0.45);
    return tBad;
  }
  function pulse(pathEl, t0, t1, reverse = false) {
    const n = div(over, { cls: "pulse", w: 18, h: 18, o: 0 });
    hook((t) => {
      const on = t >= t0 && t <= t1;
      n.style.opacity = on ? "1" : "0";
      n.style.visibility = on ? "visible" : "hidden";
      if (!on) {
        return;
      }
      let p = ease.inOut((t - t0) / (t1 - t0));
      if (reverse) {
        p = 1 - p;
      }
      const pt = pathPoint(pathEl, p);
      n.style.transform = `translate(${pt.x - 9}px,${pt.y - 9}px)`;
    });
  }
  function superText(text, t0, t1, cx, cy, w = 900, cls = "super") {
    const n = div(over, { cls, ...box(cx, cy, w, 60), o: 0, html: `<span class="super pill">${text}</span>` });
    pop(n, t0, 0.45, 0.9);
    fadeOut(n, Math.max(t1, t0 + 1.2), 0.35);
    return n;
  }

  // ------------------------------------------------------------------ C1 · agents are good
  const WIN = [
    { title: L("Requirements", "Yêu cầu"), text: "# Team calendar\n- Managers see who is off\n- Week and month views\n- Approved leave only\nAC: filter by team" },
    { title: "Code", text: "export function TeamCalendar() {\n  const leave = useTeamLeave();\n  return (\n    <Calendar days={leave} />\n  );\n}" },
    { title: L("Tests", "Test"), text: "✓ shows approved leave\n✓ hides pending requests\n✓ week view\n✓ month view\n✓ filter by team" },
  ];
  const winKeys = ["ba", "eng", "qc"];
  const wins = WIN.map((w, i) => {
    const n = div(over, {
      cls: "window",
      w: 420,
      h: 300,
      x: 270 + i * 480,
      y: 300,
      o: 0,
      html: `<div class="win-bar"><i></i><i></i><i></i><span class="win-title">${w.title}</span></div><pre class="win-body"></pre>`,
    });
    const pre = n.querySelector("pre");
    const t0 = 0.7 + i * 0.3;
    const t1 = t0 + 2.9;
    hook((t) => {
      const p = clamp((t - t0) / (t1 - t0));
      const s = w.text.slice(0, Math.round(p * w.text.length));
      if (pre.textContent !== s) {
        pre.textContent = s;
      }
    });
    pop(n, 0.15 + i * 0.2, 0.55, 0.9);
    return n;
  });

  // ------------------------------------------------------------------ C2/C3 · the person in the middle
  wins.forEach((n, i) => {
    const [cx, cy] = MC[winKeys[i]];
    toC(n, S("C2", 0.15), S("C2", 1.25), cx, cy, { s: 0.45 });
  });
  pop(you, S("C2", 0.8), 0.5, 0.7);
  fadeIn(youTag, S("C2", 1.0));
  const clock = div(chaos, { cls: "clock", ...box(1030, 492, 40, 40), o: 0, html: ICON.clock });
  fadeIn(clock, S("C2", 2.4));
  const clockHand = clock.querySelector(".hand");
  hook((t) => {
    clockHand.setAttribute("transform", `rotate(${(Math.min(t, T_FREEZE) * 420) % 360} 16 16)`);
  });
  const copyLbl = div(chaos, { cls: "copy-label", ...box(860, 612, 80, 20), o: 0, html: "copy" });
  const pasteLbl = div(chaos, { cls: "copy-label", ...box(1060, 612, 80, 20), o: 0, html: "paste" });
  fadeIn(copyLbl, S("C2", 1.5));
  fadeIn(pasteLbl, S("C2", 1.7));

  const T_FREEZE = VE("C3", -1.25);
  const ENDS = {
    J: [TOOL_EDGE, 390],
    C: [TOOL_EDGE, 560],
    G: [TOOL_EDGE, 730],
    R: [1426, 390],
    K: [1426, 560],
    T: [1426, 730],
  };
  const ROUTES = ["JR", "RC", "CK", "KG", "JT", "TJ", "GT", "RK", "CR", "KJ", "TC", "JK", "RG", "CT", "GK", "TR"];
  const tripTimes = [];
  [1.3, 2.1, 2.8, 3.5, 4.1, 4.6, 5.1, 5.6, 6.0, 6.4, 6.8, 7.2, 7.6].forEach((d) => tripTimes.push([S("C2", d), 1.3]));
  for (let d = 0; d < 6.2; d += 0.32) {
    tripTimes.push([S("C3", d), 1.0]);
  }
  const trips = tripTimes.map(([t0, dur], i) => {
    const r = ROUTES[i % ROUTES.length];
    const a = ENDS[r[0]];
    const b = ENDS[r[1]];
    const el = document.createElement("div");
    el.className = "token";
    el.innerHTML = ART.gray;
    chaos.appendChild(el);
    const d = `M${a[0]},${a[1]} Q${(a[0] + 960) / 2},${a[1] - 50} 960,560 Q${(960 + b[0]) / 2},${b[1] - 50} ${b[0]},${b[1]}`;
    const trail = path(chaosSvg, d, "trail", 0);
    seg(trail, "o", [[t0, 0], [t0 + 0.3, 0.32]]);
    return { el, a, b, t0, dur };
  });
  hook((t) => {
    const tc = Math.min(t, T_FREEZE);
    for (const tr of trips) {
      const p = (tc - tr.t0) / tr.dur;
      if (p <= 0 || p >= 1) {
        tr.el.style.opacity = "0";
        continue;
      }
      let x;
      let y;
      if (p < 0.5) {
        const u = ease.inOut(p / 0.5);
        x = lerp(tr.a[0], HUB[0], u);
        y = lerp(tr.a[1], HUB[1], u) - Math.sin(u * Math.PI) * 40;
      } else {
        const u = ease.inOut((p - 0.5) / 0.5);
        x = lerp(HUB[0], tr.b[0], u);
        y = lerp(HUB[1], tr.b[1], u) - Math.sin(u * Math.PI) * 40;
      }
      tr.el.style.opacity = "1";
      tr.el.style.transform = `translate(${x - 20}px,${y - 23}px)`;
    }
    // the person shakes more and more until the freeze
    const amp = t < T_FREEZE ? 4.5 * prog(t, S("C2", 2), S("C3", 3), "linear") : 0;
    youCircle.style.transform = `translate(${Math.sin(t * 41) * amp}px,${Math.cos(t * 33) * amp}px)`;
  });
  const qtag1 = div(chaos, { cls: "qtag", ...box(1150, 440, 330, 56), o: 0, html: L("Who approved what?", "Ai đã duyệt gì?") });
  const qtag2 = div(chaos, { cls: "qtag", ...box(760, 690, 330, 56), o: 0, html: L("What did it cost?", "Tốn bao nhiêu?") });
  pop(qtag1, V("C3", 0.33), 0.45, 0.7);
  pop(qtag2, V("C3", 0.55), 0.45, 0.7);
  seg(vignette, "o", [[T_FREEZE, 0], [T_FREEZE + 0.4, 0.55], [S("C4", 0.2), 0.55], [S("C4", 1.2), 0]]);
  fadeOut(chaos, S("C4", 0.05), 0.6);

  // World colour: Act 1 drains, AgentFlow brings it back.
  hook((t) => {
    let sat;
    if (t < S("C2")) {
      sat = lerp(0.85, 0.55, prog(t, 0, S("C2"), "linear"));
    } else if (t < S("C4")) {
      sat = lerp(0.55, 0.12, prog(t, S("C2"), S("C3", 4), "linear"));
    } else {
      sat = lerp(0.12, 1, prog(t, S("C4", 0.5), S("C4", 2.2)));
    }
    world.style.filter = sat >= 0.999 ? "none" : `saturate(${sat.toFixed(3)})`;
  });

  // ------------------------------------------------------------------ C4 · AgentFlow takes the middle
  fadeOut(youTag, S("C4", 0.1), 0.3);
  toC(you, S("C4", 0.2), S("C4", 1.2), 780, PPL_Y, { s: 64 / 76 });
  fadeIn(adminLabel, S("C4", 1.2));
  people.forEach((p, i) => pop(p, S("C4", 1.25 + i * 0.15), 0.45, 0.7));
  pop(decideTag, S("C4", 2.0), 0.45, 0.85);
  pop(hub, S("C4", 0.9), 0.8, 0.55);
  fadeIn(hubName, S("C4", 1.4), 0.5);
  fadeIn(hubRole, V("C4", 0.6), 0.5);

  // ------------------------------------------------------------------ C5 · three agents, three machines
  wins.forEach((n) => fadeOut(n, S("C5", 0.3), 0.6));
  ["ba", "eng", "qc"].forEach((k, i) => pop(ag[k].m, S("C5", 0.4 + i * 0.12), 0.6, 0.85));
  pop(ag.ba.badge, V("C5", 0.56), 0.45, 0.85);
  pop(ag.eng.badge, V("C5", 0.69), 0.45, 0.85);
  pop(ag.qc.badge, V("C5", 0.84), 0.45, 0.85);
  fadeIn(boundary, S("C5", 1.3), 0.9);
  fadeIn(boundaryLabel, S("C5", 1.8), 0.6);

  // ------------------------------------------------------------------ C6 · connect
  for (const k of Object.keys(tools)) {
    tileFlash[k].push([S("C6", 0.2), S("C6", 1.0)]);
  }
  const keyToken = div(over, { cls: "hub-key", ...box(TOOL_EDGE, 390, 50, 50), o: 0, html: ICON.key });
  pop(keyToken, S("C6", 0.35), 0.35, 0.6);
  toC(keyToken, S("C6", 0.5), S("C6", 1.4), 1036, 486);
  fadeOut(keyToken, S("C6", 1.4), 0.1);
  pop(hubKey, S("C6", 1.4), 0.4, 1.3);
  const badLine = path(mapSvg, `M${MACH_EDGE},${MC.ba[1]} L${TOOL_EDGE},${TOOL_Y.jira}`, "bad-line", 0);
  seg(badLine, "o", [[S("C6", 1.7), 0], [S("C6", 2.0), 1], [S("C6", 3.3), 1], [S("C6", 3.7), 0]]);
  march(badLine, -30);
  const badX = div(over, {
    cls: "qtag",
    ...box(965, 390, 56, 56),
    o: 0,
    html: "✕",
  });
  badX.style.cssText += ";display:flex;align-items:center;justify-content:center;padding:0;font-size:30px;";
  pop(badX, S("C6", 2.4), 0.4, 0.5);
  fadeOut(badX, S("C6", 3.3), 0.4);
  ["ba", "eng", "qc"].forEach((k, i) => pulse(agLines[k], S("C6", 3.2 + i * 0.15), S("C6", 4.0 + i * 0.15), true));
  ["jira", "conf", "git"].forEach((k, i) => pulse(toolLines[k], S("C6", 4.1 + i * 0.15), S("C6", 4.9 + i * 0.15), true));
  hubFlash.push([S("C6", 3.9), S("C6", 4.4)]);
  superText(L("Agents work through AgentFlow", "Agent làm việc qua AgentFlow"), S("C6", 2.6), END("C6", -0.3), 960, 902);

  // ------------------------------------------------------------------ C7 · skill cards
  const CARD_Y = 340;
  const cardDefs = [
    {
      k: "ba",
      x: 110,
      where: L("server", "máy chủ"),
      rows: [
        { cmd: "/ba-requirement", desc: L("writes the requirements · may ask", "viết bản yêu cầu · có thể hỏi"), needs: null, makes: "requirements" },
        { cmd: "/leavedesk-research", desc: L("answers questions · read-only", "trả lời câu hỏi · chỉ đọc"), needs: null, makes: "answer", ro: true },
      ],
    },
    {
      k: "eng",
      x: 710,
      where: L("developer's laptop", "laptop của developer"),
      rows: [
        { cmd: "/writing-plans", desc: L("writes the implementation plan", "viết kế hoạch triển khai"), needs: "requirements", makes: "plan" },
        { cmd: "/executing-plans", desc: L("writes code · opens a pull request", "viết code · mở pull request"), needs: "plan", approved: true, makes: "code" },
        { cmd: "/systematic-debugging", desc: L("finds a bug's cause · read-only", "tìm nguyên nhân lỗi · chỉ đọc"), needs: null, makes: "answer", ro: true },
      ],
    },
    {
      k: "qc",
      x: 1310,
      where: L("test server", "máy chủ test"),
      rows: [
        { cmd: "/qa-test", desc: L("designs the test plan", "thiết kế kế hoạch test"), needs: "requirements", makes: "testplan" },
        { cmd: "/qa-run", desc: L("runs tests on Engineering's branch", "chạy test trên nhánh Engineering"), needs: "testplan", makes: "results" },
        { cmd: "/qa-review", desc: L("answers questions · read-only", "trả lời câu hỏi · chỉ đọc"), needs: null, makes: "answer", ro: true },
      ],
    },
  ];
  const cards = cardDefs.map((d, i) => {
    let rowsHtml = "";
    let top = 78;
    d.rows.forEach((r, ri) => {
      const sock = r.needs
        ? `<div class="ksock">${ri === 0 ? `<span class="klab">${L("needs", "cần")}</span>` : ""}${ART[r.needs]}${
            r.approved ? '<i style="position:absolute;right:-8px;top:-8px;width:20px;height:20px;border-radius:50%;background:var(--ok);color:#fff;font:800 12px var(--sans);display:flex;align-items:center;justify-content:center;font-style:normal">✓</i>' : ""
          }</div>`
        : `<div class="ksock none">${ri === 0 ? `<span class="klab">${L("needs", "cần")}</span>` : ""}—</div>`;
      rowsHtml += `<div class="krow${r.ro ? " ro" : ""}" style="top:${top}px"><div class="kcmd">${r.cmd}</div><div class="kdesc">${r.desc}</div>${sock}<div class="karrow">→</div><div class="kplug">${
        ri === 0 ? `<span class="klab">${L("makes", "tạo ra")}</span>` : ""
      }${ART[r.makes]}</div></div>`;
      top += r.ro ? 60 : 66;
    });
    const n = div(over, {
      cls: "card",
      w: 500,
      h: 290,
      ...topLeft({ _it: { w: 500, h: 290 } }, MC[d.k][0], MC[d.k][1]),
      s: 0.2,
      o: 0,
      html: `<div class="card-head">${badgePill(d.k)}<span class="card-where">${d.where}</span><span class="card-file">AGENTFLOW.md</span></div>${rowsHtml}`,
    });
    const t0 = S("C7", 0.5 + i * 0.25);
    fadeIn(n, t0, 0.3);
    to(n, t0, t0 + 0.8, { x: d.x, y: CARD_Y, s: 1 }, "out");
    classWindows(n, "hl-cmd", [[V("C7", 0.38), END("C7")]]);
    classWindows(n, "hl-needs", [[V("C7", 0.56), END("C7")]]);
    classWindows(n, "hl-makes", [[V("C7", 0.8), END("C7")]]);
    fadeOut(n, S("C8", 0.0), 0.45);
    return n;
  });
  // BA's requirements feed both Engineering and QC.
  const plugTop = [110 + 412, CARD_Y + 78 + 7];
  const chainEng = path(overSvg, `M${plugTop[0]},${plugTop[1]} C${plugTop[0]},${CARD_Y - 50} 1032,${CARD_Y - 50} 1032,${plugTop[1]}`, "chain", 0);
  const chainQc = path(overSvg, `M${plugTop[0]},${plugTop[1]} C${plugTop[0]},${CARD_Y - 95} 1632,${CARD_Y - 95} 1632,${plugTop[1]}`, "chain", 0);
  march(chainEng);
  march(chainQc);
  seg(chainEng, "o", [[VE("C7", 0.05), 0], [VE("C7", 0.45), 1], [S("C8", 0.0), 1], [S("C8", 0.4), 0]]);
  seg(chainQc, "o", [[VE("C7", 0.3), 0], [VE("C7", 0.7), 1], [S("C8", 0.0), 1], [S("C8", 0.4), 0]]);
  const feeds = div(over, {
    cls: "edit-tag",
    ...box(960, CARD_Y - 120, 520, 40),
    o: 0,
    html: L("BA's requirements are what Engineering and QC need", "Bản yêu cầu của BA là đầu vào của Engineering và QC"),
  });
  feeds.style.textAlign = "center";
  feeds.style.borderColor = "var(--ba)";
  feeds.style.color = "var(--ba-l)";
  feeds.style.background = "#0f2530";
  pop(feeds, VE("C7", 0.5), 0.4, 0.9);
  fadeOut(feeds, S("C8", 0.0), 0.35);

  // ------------------------------------------------------------------ C8 · rules → flow bar
  const rchip = (k, text) => `<span class="rchip ${k}">${text}</span>`;
  const RULES = L(
    [
      `<b>Requirements</b> — ${rchip("ba", "BA")} writes them and asks questions.`,
      `<b>Planning</b> — at the same time, ${rchip("eng", "Engineering")} plans the code and ${rchip("qc", "QC")} plans the tests.`,
      `<b>Implement</b> — ${rchip("eng", "Engineering")} builds from the plan.`,
      `<b>Testing</b> — ${rchip("qc", "QC")} runs the tests on Engineering's branch.`,
      `<b>Review</b> — ${rchip("ppl", "people")} review and merge.`,
    ],
    [
      `<b>Requirements</b> — ${rchip("ba", "BA")} viết yêu cầu và đặt câu hỏi.`,
      `<b>Planning</b> — cùng lúc, ${rchip("eng", "Engineering")} lập kế hoạch code, ${rchip("qc", "QC")} lập kế hoạch test.`,
      `<b>Implement</b> — ${rchip("eng", "Engineering")} viết code theo kế hoạch.`,
      `<b>Testing</b> — ${rchip("qc", "QC")} chạy test trên nhánh của Engineering.`,
      `<b>Review</b> — ${rchip("ppl", "con người")} review và merge.`,
    ]
  );
  const rules = div(over, {
    cls: "rules",
    w: 1040,
    h: 420,
    x: 440,
    y: 300,
    o: 0,
    html: `<div class="rules-title">${L("Rules", "Quy tắc")}<span>LeaveDesk workflow</span></div>`,
  });
  pop(rules, S("C8", 0.2), 0.5, 0.94);
  RULES.forEach((html, i) => {
    const line = div(rules, { cls: "rule-line", w: 960, h: 58, x: 40, y: 84 + i * 62, o: 0, origin: "0 50%", html });
    line.style.fontSize = "22px";
    seg(line, "o", [[V("C8", 0.02) + i * 0.62, 0], [V("C8", 0.02) + i * 0.62 + 0.35, 1, "out"]]);
    seg(line, "x", [[V("C8", 0.02) + i * 0.62, 70], [V("C8", 0.02) + i * 0.62 + 0.45, 40, "out"]]);
  });
  const rulesNote = div(rules, { cls: "rules-note", w: 340, h: 44, x: 660, y: 396, o: 0, html: L("Roles, not commands", "Vai trò, không phải command") });
  rulesNote.style.textAlign = "center";
  pop(rulesNote, VE("C8", -0.4), 0.4, 0.8);
  const T_COLLAPSE = END("C8", -2.1);
  to(rules, T_COLLAPSE, T_COLLAPSE + 0.9, { y: -60, s: 0.3 }, "inOut");
  fadeOut(rules, T_COLLAPSE + 0.3, 0.6);
  seg(flow, "o", [[T_COLLAPSE + 0.5, 0], [T_COLLAPSE + 1.0, 1, "out"]]);
  seg(flow, "y", [[T_COLLAPSE + 0.5, 10], [T_COLLAPSE + 1.1, 40, "out"]]);

  // ------------------------------------------------------------------ C9 · a ticket comes in
  pop(ticket, S("C9", 0.2), 0.5, 0.9);
  setPill(S("C9", 0.2), "To Do");
  const T_C9_CLICK = S("C9", 1.4);
  click(T_C9_CLICK, PILL[0], PILL[1], [640, 330]);
  fadeOut(cursor, T_C9_CLICK + 0.5, 0.3);
  setPill(T_C9_CLICK + 0.05, "Requirements");
  pulse(toolLines.jira, S("C9", 1.65), S("C9", 2.45));
  hubFlash.push([S("C9", 2.4), S("C9", 2.9)]);
  flowEv.push([S("C9", 2.45), "a p p p p p"]);

  // ------------------------------------------------------------------ C10 · rules pick the BA agent
  const T10 = {
    rules: V("C10", 0.06),
    cards: V("C10", 0.25),
    hist: V("C10", 0.45),
    conv: V("C10", 0.64),
    slip: V("C10", 0.72),
  };
  T10.out = Math.max(T10.slip + 1.2, VE("C10", 0.45));
  const panelDefs = [
    {
      x: 100,
      num: 1,
      title: L("Rules", "Quy tắc"),
      body: L(
        ["Requirements — BA writes them", "Planning — Engineering + QC", "Implement — Engineering", "Testing — QC runs the tests", "Review — people merge"],
        ["Requirements — BA viết yêu cầu", "Planning — Engineering + QC", "Implement — Engineering", "Testing — QC chạy test", "Review — con người merge"]
      )
        .map((l, i) => `<div class="pline${i === 0 ? " p-hl" : ""}">${l}</div>`)
        .join(""),
      t: T10.rules,
    },
    {
      x: 690,
      num: 2,
      title: L("Skill cards", "Thẻ kỹ năng"),
      body: [
        ["ba", ["/ba-requirement → requirements", L("/leavedesk-research · read-only", "/leavedesk-research · chỉ đọc")]],
        ["eng", ["/writing-plans → plan", "/executing-plans → code"]],
        ["qc", ["/qa-test → test plan", "/qa-run → test results"]],
      ]
        .map(
          ([k, rows]) =>
            `<div class="mini${k === "ba" ? " p-hl" : ""}" style="${roleStyle(k)}"><div class="mini-head">${ROLE[k].name} · ${ROLE[k].job}</div>${rows
              .map((r, ri) => `<div class="mrow${k === "ba" && ri === 0 ? " p-hl2" : ""}">${r}</div>`)
              .join("")}</div>`
        )
        .join(""),
      t: T10.cards,
    },
    {
      x: 1280,
      num: 3,
      title: L("History · LD-6", "Lịch sử · LD-6"),
      body: `<div class="hrow">${L("Ticket created", "Tạo ticket")}<span class="when">2d</span></div><div class="hrow">${L("Moved to Requirements", "Chuyển sang Requirements")}<span class="when">${L("now", "vừa xong")}</span></div><div class="hrow p-hl">${L(
        "Requirements: none yet",
        "Bản yêu cầu: chưa có"
      )}</div><div class="tag-new p-tag">→ ${L("start new", "bắt đầu mới")}</div>`,
      t: T10.hist,
    },
  ];
  const panels = panelDefs.map((p) => {
    const n = div(over, {
      cls: "panel",
      w: 540,
      h: 400,
      x: p.x,
      y: 300,
      o: 0,
      html: `<div class="panel-title"><span class="num">${p.num}</span>${p.title}</div>${p.body}`,
    });
    pop(n, p.t, 0.45, 0.9);
    const hlAt = p.t + 0.45;
    for (const el of n.querySelectorAll(".p-hl")) {
      classWindows(el, "hl", [[hlAt, T10.out + 0.5]]);
    }
    for (const el of n.querySelectorAll(".p-hl2")) {
      classWindows(el, "hl", [[hlAt + 0.35, T10.out + 0.5]]);
    }
    const tag = n.querySelector(".p-tag");
    if (tag) {
      tag.style.opacity = "0";
      hook((t) => {
        tag.style.opacity = t >= hlAt + 0.4 ? "1" : "0";
      });
    }
    fadeOut(n, T10.out, 0.45);
    return n;
  });
  const SLIP10 = [960, 760];
  // From the bottom edge of each panel to the slip, so no line crosses panel text.
  [
    `M370,700 C370,762 620,760 ${SLIP10[0] - 136},${SLIP10[1]}`,
    `M960,700 L960,${SLIP10[1] - 26}`,
    `M1550,700 C1550,762 1300,760 ${SLIP10[0] + 136},${SLIP10[1]}`,
  ].forEach((d, i) => {
    const p = path(overSvg, d, "converge", 1, true);
    drawIn(p, T10.conv + i * 0.08, T10.conv + 0.45 + i * 0.08);
    fadeOut(p, T10.out, 0.4);
  });
  const t10arrive = slip({
    role: "ba",
    cmd: "/ba-requirement",
    t0: T10.slip,
    hold: T10.out - T10.slip,
    from: SLIP10,
    target: MC.ba,
  });
  mState.ba.push([t10arrive, "run"]);

  // ------------------------------------------------------------------ C11 · BA writes, people approve
  const t11doc = docTravel("requirements", [MC.ba, [1052, 560], HUB, [TOOL_EDGE + 30, 560]], S("C11", 0.2), 0.5);
  tileText.conf.push([t11doc, L("Requirements · v1", "Requirements · v1")]);
  tileFlash.conf.push([t11doc, t11doc + 0.6]);
  const qBubble = div(over, {
    cls: "bubble",
    ...box(HUB[0], HUB[1] - 70, 190, 48),
    o: 0,
    html: L("8 questions", "8 câu hỏi"),
  });
  const T11Q = V("C11", 0.42);
  mState.ba.push([T11Q, "wait"]);
  pop(qBubble, T11Q, 0.35, 0.7);
  toC(qBubble, T11Q + 0.1, T11Q + 0.75, 960, 292);
  fadeOut(qBubble, V("C11", 0.66), 0.3);
  const T11A = V("C11", 0.62);
  [780, 900, 1020].forEach((cx, i) => {
    const a = div(over, { cls: "bubble answer", ...box(cx, 262, 54, 42), o: 0, html: "↩" });
    pop(a, T11A + i * 0.08, 0.3, 0.6);
    toC(a, T11A + 0.15 + i * 0.08, T11A + 0.8 + i * 0.08, 960, 500);
    fadeOut(a, T11A + 0.75 + i * 0.08, 0.15);
  });
  mState.ba.push([V("C11", 0.66), "run"]);
  [
    ["v2", V("C11", 0.7)],
    ["v3", V("C11", 0.78)],
    ["v4", V("C11", 0.86)],
  ].forEach(([v, t]) => {
    tileText.conf.push([t, `Requirements · ${v}`]);
    tileFlash.conf.push([t, t + 0.35]);
  });
  const editTag = div(over, {
    cls: "edit-tag",
    w: 380,
    h: 36,
    x: 60,
    y: 623,
    o: 0,
    origin: "0 50%",
    html: `✎ ${L("your edit on the page is kept", "chỉnh sửa của bạn trên trang được giữ")}`,
  });
  pop(editTag, V("C11", 0.76), 0.35, 0.85);
  fadeOut(editTag, END("C11", -0.2), 0.3);
  mState.ba.push([V("C11", 0.88), "done"]);
  const T11OK = V("C11", 0.93);
  stamp(T11OK);
  setPill(T11OK + 0.15, "Planning");
  flowEv.push([T11OK + 0.2, "d a p p p p"]);

  // ------------------------------------------------------------------ C12 · Engineering and QC at once
  mState.ba.push([S("C12", 0.2), null]);
  pulse(toolLines.jira, S("C12", 0.0), S("C12", 0.6));
  const T12 = {
    dim: S("C12", 0.35),
    chip: V("C12", 0.08),
    eng: V("C12", 0.16),
    qc: V("C12", 0.24),
    wire: V("C12", 0.56),
    snap: V("C12", 0.8),
    out: V("C12", 0.88),
  };
  const histChip = div(over, {
    cls: "hist-chip",
    w: 360,
    h: 84,
    x: 480,
    y: 478,
    o: 0,
    html: `${ART.requirements}<div><div class="t1">Requirements v4</div><div class="t2">${L("by BA · approved by people", "do BA viết · người đã duyệt")}</div></div><div class="ok">✓</div>`,
  });
  const histOk = histChip.querySelector(".ok");
  hook((t) => {
    histOk.style.opacity = t >= T12.snap ? "1" : "0";
  });
  pop(histChip, T12.chip, 0.45, 0.85);
  const ccards = [
    ["eng", 352, "/writing-plans", L("needs requirements → makes the plan", "cần bản yêu cầu → tạo kế hoạch"), "plan", T12.eng],
    ["qc", 588, "/qa-test", L("needs requirements → makes the test plan", "cần bản yêu cầu → tạo kế hoạch test"), "testplan", T12.qc],
  ].map(([k, y, cmd, desc, makes, t]) => {
    const n = div(over, {
      cls: "ccard",
      w: 560,
      h: 112,
      x: 1000,
      y,
      o: 0,
      html: `<div class="csock">${ART.requirements}</div><div class="chead">${ROLE[k].name} · ${ROLE[k].job}</div><div class="ccmd">${cmd}</div><div class="cdesc">${desc}</div><div class="cplug">${ART[makes]}</div>`,
    });
    n.style.cssText += `;${roleStyle(k)}`;
    pop(n, t, 0.45, 0.88);
    classWindows(n, "snap", [[T12.snap, T12.out + 0.5]]);
    fadeOut(n, T12.out, 0.4);
    return n;
  });
  [
    `M840,520 C930,520 930,408 1016,408`,
    `M840,520 C930,520 930,644 1016,644`,
  ].forEach((d) => {
    const p = path(overSvg, d, "chain", 0);
    march(p);
    seg(p, "o", [[T12.wire, 0], [T12.wire + 0.35, 1], [T12.out, 1], [T12.out + 0.35, 0]]);
  });
  fadeOut(histChip, T12.out, 0.4);
  const T12SLIP = T12.out + 0.15;
  const t12a = slip({ role: "eng", cmd: "/writing-plans", t0: T12SLIP, dy: -22, target: MC.eng });
  const t12b = slip({ role: "qc", cmd: "/qa-test", t0: T12SLIP + 0.12, dy: 30, target: MC.qc });
  mState.eng.push([t12a, "run"]);
  mState.qc.push([t12b, "run"]);
  superText(L("In parallel", "Song song"), T12SLIP + 0.2, t12b - 0.1, 1260, 902, 400);

  // ------------------------------------------------------------------ C13 · guard
  pop(hubSpark, S("C13", 0.15), 0.4, 0.6);
  fadeOut(hubSpark, END("C13", -0.3), 0.3);
  gateWin.push([S("C13", 0.1), END("C13", -0.2)]);
  const T13A = V("C13", 0.2);
  const T13B = V("C13", 0.56);
  const tbadA = slip({ role: null, cmd: "/deploy", t0: T13A, checks: ["bad"] });
  const tbadB = slip({ role: "qc", cmd: "/qa-run", t0: T13B, checks: ["ok", "ok", "bad"] });
  const log = div(over, {
    cls: "log",
    w: 620,
    h: 116,
    x: 60,
    y: 806,
    o: 0,
    html: `<div class="log-title">${L("History · LD-6", "Lịch sử · LD-6")}</div><div class="log-line l1">${L(
      "Refused · /deploy · not on any card",
      "Bị chặn · /deploy · không có trên thẻ nào"
    )}</div><div class="log-line l2">${L("Refused · /qa-run · missing test plan", "Bị chặn · /qa-run · thiếu kế hoạch test")}</div>`,
  });
  const logL1 = log.querySelector(".l1");
  const logL2 = log.querySelector(".l2");
  hook((t) => {
    logL1.style.opacity = t >= tbadA + 0.1 ? "1" : "0";
    logL2.style.opacity = t >= tbadB + 0.1 ? "1" : "0";
  });
  pop(log, tbadA, 0.4, 0.9);
  fadeOut(log, END("C13", -0.3), 0.35);

  // ------------------------------------------------------------------ C14 · Engineering writes the code
  mState.eng.push([S("C14", 0.25), "done"]);
  mState.qc.push([S("C14", 0.25), "done"]);
  const t14a = docTravel("plan", [MC.eng, [1052, 560], HUB, [TOOL_EDGE + 30, 560]], S("C14", 0.25), 0.42);
  docTravel("testplan", [MC.qc, [1052, 560], HUB, [TOOL_EDGE + 30, 560]], S("C14", 0.45), 0.42);
  tileText.conf.push([t14a, L("Implementation plan · Test plan", "Kế hoạch triển khai · Kế hoạch test")]);
  tileFlash.conf.push([t14a, t14a + 0.7]);
  mState.eng.push([S("C14", 1.6), null]);
  mState.qc.push([S("C14", 1.6), null]);
  const T14OK = S("C14", 1.85);
  stamp(T14OK);
  setPill(T14OK + 0.15, "Implement");
  flowEv.push([T14OK + 0.2, "d d a p p p"]);
  const t14slip = slip({ role: "eng", cmd: "/executing-plans", t0: S("C14", 2.15), target: MC.eng });
  mState.eng.push([t14slip, "run"]);
  const code = div(over, {
    cls: "codepanel",
    w: 340,
    h: 150,
    x: 1092,
    y: 440,
    o: 0,
    html: `<span class="hdr">LD-6 · ${L("feature branch", "nhánh tính năng")}</span>\n<span class="add c1">+ TeamCalendar.tsx</span>\n<span class="add c2">+ useTeamLeave.ts</span>\n<span class="add c3">+ calendar.test.ts</span>`,
  });
  const codeLines = [code.querySelector(".c1"), code.querySelector(".c2"), code.querySelector(".c3")];
  pop(code, t14slip + 0.3, 0.4, 0.9);
  hook((t) => {
    codeLines.forEach((el, i) => {
      el.style.opacity = t >= t14slip + 0.6 + i * 0.3 ? "1" : "0";
    });
  });
  const T14PR = t14slip + 1.55;
  const ownLine = path(mapSvg, "M1460,600 C1380,860 700,880 450,742", "own-line", 0);
  march(ownLine, -32);
  seg(ownLine, "o", [[T14PR, 0], [T14PR + 0.4, 1], [END("C14", -0.3), 1], [END("C14", 0.2), 0]]);
  const ownTag = div(over, {
    cls: "own-tag",
    ...box(1010, 858, 420, 24),
    o: 0,
    html: L("pushed with the developer's own Git account", "push bằng tài khoản Git của developer"),
  });
  ownTag.style.textAlign = "center";
  fadeIn(ownTag, T14PR + 0.3);
  fadeOut(ownTag, END("C14", -0.2), 0.3);
  tileText.git.push([T14PR + 0.5, "PR #6 · LD-6"]);
  tileFlash.git.push([T14PR + 0.5, T14PR + 1.1]);
  mState.eng.push([T14PR + 0.5, "done"]);
  fadeOut(code, END("C14", -0.1), 0.35);

  // ------------------------------------------------------------------ C15 · QC tests, the fix goes back
  mState.eng.push([S("C15", 0.1), null]);
  const T15 = {
    toTesting: S("C15", 0.7),
    slip: S("C15", 0.95),
    fill0: S("C15", 3.0),
    fill1: S("C15", 3.9),
    fail: V("C15", 0.3),
  };
  click(T15.toTesting, PILL[0], PILL[1], [640, 330]);
  fadeOut(cursor, T15.toTesting + 0.4, 0.25);
  setPill(T15.toTesting + 0.05, "Testing");
  flowEv.push([T15.toTesting + 0.1, "d d d a p p"]);
  const t15slip = slip({ role: "qc", cmd: "/qa-run", t0: T15.slip, target: MC.qc });
  mState.qc.push([t15slip, "run"]);
  const counter = div(over, {
    cls: "counter",
    w: 372,
    h: 160,
    x: 1064,
    y: 650,
    o: 0,
    html: `<div class="counter-head">QC · /qa-run · LD-6</div><div class="count-text"></div><div class="d1">D-1</div><div class="grid33">${'<div class="sq"></div>'.repeat(33)}</div>`,
  });
  const sqs = Array.from(counter.querySelectorAll(".sq"));
  const countText = counter.querySelector(".count-text");
  const d1 = counter.querySelector(".d1");
  pop(counter, t15slip, 0.4, 0.9);
  T15.fill0 = Math.max(T15.fill0, t15slip + 0.3);
  T15.fill1 = Math.max(T15.fill1, T15.fill0 + 0.8);
  T15.fail = Math.max(T15.fail, T15.fill1 + 0.2);
  const T15BACK = T15.fail + 0.55;
  const T15FIX = Math.max(V("C15", 0.42), T15BACK + 0.35);
  const T15HIST = T15FIX + 0.6;
  const T15HL = Math.max(V("C15", 0.66), T15HIST + 0.5);
  const T15RESUME = T15HL + 0.45;
  const T15FIXED = T15RESUME + 1.15;
  const T15RETEST = T15FIXED + 0.25;
  const T15FILL2 = [T15RETEST + 0.25, T15RETEST + 1.05];
  hook((t) => {
    let green = 0;
    let red = false;
    let txt = "";
    let pass = false;
    if (t >= T15FILL2[0]) {
      green = Math.round(33 * prog(t, T15FILL2[0], T15FILL2[1], "linear"));
      txt = `${green} / 33`;
      pass = green === 33;
    } else if (t >= T15.fill0) {
      green = Math.round(32 * prog(t, T15.fill0, T15.fill1, "linear"));
      red = t >= T15.fail;
      txt = red ? "32 / 33" : `${green} / 33`;
    }
    sqs.forEach((sq, i) => {
      sq.className = `sq${i < green ? " g" : ""}${red && i === 32 ? " r" : ""}`;
      sq.textContent = red && i === 32 ? "✕" : "";
    });
    countText.innerHTML = pass ? '<span class="good">33 / 33 ✓</span>' : red ? `<span class="bad">${txt}</span>` : txt;
    d1.style.opacity = red ? "1" : "0";
  });
  mState.qc.push([T15.fail, "err"]);
  const t15res = docTravel("results", [MC.qc, [1052, 560], HUB, [TOOL_EDGE + 30, 560]], T15.fail + 0.1, 0.4);
  tileText.conf.push([t15res, "Test run 1 · 32/33"]);
  tileFlash.conf.push([t15res, t15res + 0.6]);
  click(T15BACK, PILL[0], PILL[1], [640, 330]);
  fadeOut(cursor, T15BACK + 0.4, 0.25);
  setPill(T15BACK + 0.05, "Implement");
  flowEv.push([T15BACK + 0.1, "d d a p p p"]);
  seg(backArc, "o", [[T15BACK + 0.05, 0], [T15BACK + 0.3, 1], [T15BACK + 1.6, 1], [T15BACK + 2.0, 0]]);
  mState.qc.push([T15BACK + 0.2, null]);
  const fixBubble = div(over, { cls: "bubble comment", ...box(1020, 290, 170, 46), o: 0, html: "fix D-1" });
  pop(fixBubble, T15FIX, 0.35, 0.7);
  toC(fixBubble, T15FIX + 0.25, T15FIX + 0.9, HUB[0], HUB[1] - 120);
  fadeOut(fixBubble, T15HIST + 0.6, 0.3);
  const histMini = div(over, {
    cls: "histmini",
    w: 380,
    h: 170,
    x: 480,
    y: 300,
    o: 0,
    html: `<div class="panel-title">${L("History · LD-6", "Lịch sử · LD-6")}</div><div class="hrow">requirements ← BA</div><div class="hrow">plan ← Engineering</div><div class="hrow h-code">code ← Engineering</div>`,
  });
  pop(histMini, T15HIST, 0.4, 0.9);
  classWindows(histMini.querySelector(".h-code"), "hl", [[T15HL, T15FIXED + 0.6]]);
  fadeOut(histMini, T15FIXED + 0.6, 0.35);
  const resumeLine = path(overSvg, "M1046,520 Q1250,400 1446,540", "resume-line", 1, true);
  drawIn(resumeLine, T15RESUME, T15RESUME + 0.6);
  fadeOut(resumeLine, T15FIXED + 0.3, 0.35);
  const resumeTag = div(over, {
    cls: "resume-tag",
    ...box(1250, 420, 300, 38),
    o: 0,
    html: `↻ ${L("resume · same session", "tiếp tục · cùng phiên")}`,
  });
  resumeTag.style.textAlign = "center";
  pop(resumeTag, T15RESUME + 0.3, 0.35, 0.85);
  fadeOut(resumeTag, T15FIXED + 0.3, 0.3);
  mState.eng.push([T15RESUME + 0.6, "run"]);
  const fixPill = div(over, { cls: "diffpill", ...box(1250, 615, 170, 36), o: 0, html: "+ fix D-1" });
  pop(fixPill, T15RESUME + 0.8, 0.35, 0.8);
  fadeOut(fixPill, T15FIXED + 0.5, 0.3);
  mState.eng.push([T15FIXED, "done"]);
  click(T15RETEST, PILL[0], PILL[1], [640, 330]);
  fadeOut(cursor, T15RETEST + 0.4, 0.25);
  setPill(T15RETEST + 0.05, "Testing");
  flowEv.push([T15RETEST + 0.1, "d d d a p p"]);
  mState.eng.push([T15RETEST + 0.2, null]);
  mState.qc.push([T15RETEST + 0.2, "run"]);
  mState.qc.push([T15FILL2[1], "done"]);
  tileText.conf.push([T15FILL2[1] + 0.15, "Test run 2 · 33/33"]);
  tileFlash.conf.push([T15FILL2[1] + 0.15, T15FILL2[1] + 0.7]);
  tileText.git.push([T15FILL2[1] + 0.3, "PR #6 · PR tests"]);
  fadeOut(counter, END("C15", 0.1), 0.35);

  // ------------------------------------------------------------------ C16 · done
  mState.qc.push([S("C16", 0.3), null]);
  setPill(S("C16", 0.15), "Review");
  flowEv.push([S("C16", 0.2), "d d d d a p"]);
  const prScrim = div(over, { cls: "scrim", ...box(960, 625, 940, 300), o: 0 });
  fadeIn(prScrim, S("C16", 0.2), 0.4);
  fadeOut(prScrim, END("C16", -0.1), 0.35);
  superText(L("Agents never merge.", "Agent không tự merge."), S("C16", 0.25), END("C16", -0.2), 960, 520, 700);
  const prDefs = [
    ["eng", 540, "Pull request #6 · leavedesk-app", L("Code", "Code")],
    ["qc", 980, "Pull request · leavedesk-qa", L("Tests", "Test")],
  ];
  const prs = prDefs.map(([k, x, head, what], i) => {
    const n = div(over, {
      cls: "pr",
      w: 400,
      h: 150,
      x,
      y: 600,
      o: 0,
      html: `<div class="pr-head">${head}</div><div class="pr-title">${what} · <span class="role">${ROLE[k].name}</span></div><div class="pr-foot"><span class="pr-pill">${L(
        "In review",
        "Đang review"
      )}</span><span class="pr-btn">Merge</span></div>`,
    });
    n.style.cssText += `;${roleStyle(k)}`;
    pop(n, S("C16", 0.4 + i * 0.15), 0.45, 0.9);
    const pillEl = n.querySelector(".pr-pill");
    const tMerge = S("C16", 1.55 + i * 0.75);
    click(tMerge, x + 400 - 58, 600 + 150 - 32, i === 0 ? [980, 900] : null);
    classWindows(n, "merged", [[tMerge + 0.05, 1e9]]);
    hook((t) => {
      const txt = t >= tMerge + 0.05 ? L("Merged", "Đã merge") : L("In review", "Đang review");
      if (pillEl.textContent !== txt) {
        pillEl.textContent = txt;
      }
    });
    fadeOut(n, END("C16", -0.1), 0.35);
    return n;
  });
  fadeOut(cursor, S("C16", 2.55), 0.3);
  tileText.git.push([S("C16", 2.4), L("2 PRs merged ✓", "2 PR đã merge ✓")]);
  setPill(S("C16", 2.75), "Done");
  flowEv.push([S("C16", 2.8), "d d d d d d"]);

  // ------------------------------------------------------------------ C17 · see it all
  const dash = div(over, {
    cls: "dash",
    w: 1360,
    h: 690,
    x: 280,
    y: 150,
    o: 0,
    html: `
      <div class="dash-side"><div class="dash-org"><img src="${MARK}" alt="">Acme</div>
        <div class="dash-nav on">Home</div><div class="dash-nav">Cases</div><div class="dash-nav">Runs</div>
        <div class="dash-nav">Agents</div><div class="dash-nav">Sessions</div><div class="dash-nav">Workflows</div>
        <div class="demo-foot"><span class="demo">${L("demo data", "dữ liệu mẫu")}</span></div></div>
      <div class="dash-main"><div class="dash-title">Home</div>
        <div class="dcard d-att" style="left:26px;top:74px;width:520px;height:300px">
          <div class="dh">Needs attention</div>
          <div class="att-row"><span class="kind wait">${L("Waiting for a person", "Chờ người")}</span>LD-12 · Requirements<span class="age">5m</span></div>
          <div class="att-row"><span class="kind dec">${L("Pending decision", "Chờ quyết định")}</span>LD-9 · ${L("post comment", "đăng comment")}<span class="age">12m</span></div>
          <div class="att-row"><span class="kind blk">${L("Blocked task", "Task bị chặn")}</span>LD-11 · /qa-run<span class="age">1h</span></div>
        </div>
        <div class="dcard d-ag" style="left:566px;top:74px;width:520px;height:300px">
          <div class="dh">Agents</div>
          <svg viewBox="0 0 480 220" width="480" height="220" style="position:absolute;left:20px;top:58px">
            <line x1="240" y1="58" x2="92" y2="168" stroke="#3a3b45" stroke-width="2"/>
            <line x1="240" y1="58" x2="240" y2="168" stroke="#355ae4" stroke-width="3"/>
            <line x1="240" y1="58" x2="388" y2="168" stroke="#3a3b45" stroke-width="2"/>
            <circle cx="240" cy="50" r="34" fill="#14151a" stroke="#01b8fc" stroke-width="3"/>
            <image href="${MARK}" x="214" y="30" width="52" height="42"/>
            <rect x="32" y="150" width="120" height="44" rx="10" fill="#14151a" stroke="#00ccfe" stroke-width="2"/>
            <text x="92" y="178" fill="#7fe3ff" font-size="17" font-weight="650" text-anchor="middle" font-family="Geist, sans-serif">BA</text>
            <rect class="ag-run" x="170" y="150" width="140" height="44" rx="10" fill="#14151a" stroke="#8fa7ff" stroke-width="3" stroke-dasharray="9 6"/>
            <text x="240" y="178" fill="#8fa7ff" font-size="17" font-weight="650" text-anchor="middle" font-family="Geist, sans-serif">Engineering</text>
            <rect x="328" y="150" width="120" height="44" rx="10" fill="#14151a" stroke="#9964e5" stroke-width="2"/>
            <text x="388" y="178" fill="#c3a0f6" font-size="17" font-weight="650" text-anchor="middle" font-family="Geist, sans-serif">QC</text>
          </svg>
        </div>
        <div class="dcard d-use" style="left:26px;top:394px;width:1060px;height:200px">
          <div class="dh">Usage · ${L("last 7 days", "7 ngày qua")}</div>
          <div class="use-row">
            <div><div class="use-k">${L("Input tokens", "Token vào")}</div><div class="use-v">1.84M</div></div>
            <div><div class="use-k">${L("Output tokens", "Token ra")}</div><div class="use-v">231K</div></div>
            <div><div class="use-k">${L("Cost", "Chi phí")}</div><div class="use-v">$38.10</div></div>
            <div class="bars"><i style="height:30%"></i><i style="height:52%"></i><i style="height:41%"></i><i style="height:76%"></i><i style="height:64%"></i><i style="height:88%"></i><i style="height:57%"></i></div>
          </div>
        </div>
      </div>`,
  });
  const agRun = dash.querySelector(".ag-run");
  hook((t) => {
    agRun.style.strokeDashoffset = String(-t * 30);
  });
  const T17 = { out: S("C17", 0.0), in: S("C17", 0.35) };
  fadeOut(flow, T17.out, 0.5);
  fadeOut(ticket, T17.out, 0.1);
  pop(dash, T17.in, 0.6, 0.92);
  const callDefs = [
    [".d-ag", L("Which agent is working", "Agent nào đang làm"), V("C17", 0.12), [1360, 212]],
    [".d-att", L("What needs a person", "Việc gì cần người"), V("C17", 0.38), [800, 212]],
    [".d-use", L("What it cost", "Tốn bao nhiêu"), V("C17", 0.6), [1330, 532]],
  ];
  callDefs.forEach(([sel, text, t, [cx, cy]]) => {
    classWindows(dash.querySelector(sel), "hl", [[t, END("C17")]]);
    const c = div(over, { cls: "call", ...box(cx, cy, 340, 46), o: 0, html: text });
    c.style.textAlign = "center";
    pop(c, t, 0.4, 0.8);
    fadeOut(c, END("C17", -0.1), 0.3);
  });
  const dashBound = div(over, { cls: "boundary", w: 1420, h: 760, x: 250, y: 116, o: 0 });
  const dashBoundLabel = div(over, {
    cls: "boundary-label",
    w: 420,
    h: 24,
    x: 1236,
    y: 84,
    o: 0,
    html: L("Your servers", "Máy chủ của bạn"),
  });
  fadeIn(dashBound, V("C17", 0.8), 0.5);
  fadeIn(dashBoundLabel, V("C17", 0.82), 0.5);
  [dash, dashBound, dashBoundLabel].forEach((n) => fadeOut(n, S("C18", 0.0), 0.5));

  // ------------------------------------------------------------------ C18 · logo + line
  const logoSvg = layer(over, 41);
  const LANES = [
    ["#00CCFE", "M-60,250 C320,250 470,345 640,352"],
    ["#5f86ff", "M-60,400 C320,400 470,384 650,384"],
    ["#a978ee", "M-60,560 C320,560 470,420 640,414"],
  ];
  LANES.forEach(([color, d], i) => {
    const p = path(logoSvg, d, "line", 1, true);
    p.style.stroke = color;
    p.style.strokeWidth = "6";
    drawIn(p, S("C18", 0.25 + i * 0.12), S("C18", 1.15 + i * 0.12));
    fadeOut(p, S("C18", 1.5), 0.5);
  });
  const logo = div(over, {
    w: 700,
    h: 106,
    x: 610,
    y: 330,
    o: 0,
    html: `<img src="${LOGO}" alt="AgentFlow" style="width:700px;height:106px;display:block">`,
  });
  pop(logo, S("C18", 1.15), 0.7, 0.86);
  const triad = [
    [`<span class="agents">${L("Agents do the work.", "Agent làm việc.")}</span>`, V("C18", 0.0)],
    [`<span class="af">${L("AgentFlow coordinates.", "AgentFlow điều phối.")}</span>`, V("C18", 0.36)],
    [`<span class="ppl">${L("People decide.", "Con người quyết định.")}</span>`, V("C18", 0.7)],
  ];
  triad.forEach(([html, t], i) => {
    const n = div(over, { cls: "triad", ...box(960, 520 + i * 76, 1400, 70), o: 0, html });
    pop(n, t - 0.05, 0.5, 0.92);
  });
  const cta = div(over, {
    cls: "cta",
    ...box(960, 800, 1000, 80),
    o: 0,
    html: `Self-hosted · ${L("Open source (MIT)", "Mã nguồn mở (MIT)")}<small>CTA / URL — ${L("to be decided", "chưa chốt")}</small>`,
  });
  fadeIn(cta, VE("C18", 0.2), 0.6);

  // ------------------------------------------------------------------ map visibility (one track, in time order)
  const T_UNDIM8 = END("C8", -1.5);
  const T12UNDIM = T12.out + 0.05;
  anim(map, {
    o: [
      [0, 1],
      [S("C7", 0.1), 1],
      [S("C7", 0.7), 0.12],
      [T_UNDIM8, 0.12],
      [T_UNDIM8 + 0.9, 1],
      [S("C10", 0.2), 1],
      [S("C10", 0.6), 0.14],
      [T10.out, 0.14],
      [T10.out + 0.5, 1],
      [T12.dim, 1],
      [T12.dim + 0.4, 0.22],
      [T12UNDIM, 0.22],
      [T12UNDIM + 0.4, 1],
      [S("C16", 0.1), 1],
      [S("C16", 0.5), 0.3],
      [T17.out, 0.3],
      [T17.out + 0.6, 0],
    ],
  });
  anim(gate, { o: windowFrames(gateWin, 0.25) });

  // ------------------------------------------------------------------ state hooks
  for (const k of Object.keys(mState)) {
    const m = ag[k].m;
    stepper(mState[k], (v) => {
      m.classList.remove("st-run", "st-done", "st-wait", "st-err");
      if (v) {
        m.classList.add(`st-${v}`);
      }
    });
  }
  for (const k of Object.keys(tileText)) {
    stepper(tileText[k], (v) => {
      tools[k].status.textContent = v || "";
    });
    classWindows(tools[k].n, "flash", tileFlash[k]);
  }
  stepper(pillEv, (v) => {
    ticketPill.textContent = v || "To Do";
    ticketPill.className = `tk-pill${v === "Done" ? " done" : v && v !== "To Do" ? " prog" : ""}`;
  });
  stepper(flowEv, (v) => {
    const st = (v || "p p p p p p").split(" ");
    flowCells.forEach((c, i) => {
      c.classList.toggle("a", st[i] === "a");
      c.classList.toggle("d", st[i] === "d");
    });
  });
  classWindows(hub, "flash", hubFlash);
  hook((t) => {
    let active = null;
    for (const ev of gateEv) {
      if (t >= ev[0] - 0.05 && t < ev[0] + 1.25) {
        active = ev;
      }
    }
    gateLights.forEach((el, i) => {
      let st = "";
      if (active) {
        const states = active[1];
        const bad = states.indexOf("bad");
        const shown = t >= active[0] + i * 0.15;
        if (shown && (bad === -1 || i <= bad) && states[i]) {
          st = states[i];
        }
      }
      el.className = `gate-light${st ? ` ${st}` : ""}`;
      el.textContent = st === "ok" ? "✓" : st === "bad" ? "✕" : "";
    });
  });

  // ------------------------------------------------------------------ captions
  const cap = div(stage, { cls: "caption", w: 1920, h: 90, x: 0, y: 960, html: "<span></span>" });
  const capSpan = cap.querySelector("span");
  hook((t) => {
    let shown = null;
    let a = 0;
    for (const sc of TL.scenes) {
      const s0 = sc.voStart - 0.08;
      const s1 = sc.voStart + sc.voDur + 0.45;
      if (t >= s0 && t <= s1) {
        shown = sc;
        a = Math.min(1, (t - s0) / 0.15, (s1 - t) / 0.2);
        break;
      }
    }
    const txt = shown ? shown[LANG] : "";
    if (capSpan.textContent !== txt) {
      capSpan.textContent = txt;
    }
    cap.style.opacity = shown ? String(clamp(a)) : "0";
    cap.style.visibility = shown ? "visible" : "hidden";
  });

  window.SCENE_LANG = LANG;
})();
