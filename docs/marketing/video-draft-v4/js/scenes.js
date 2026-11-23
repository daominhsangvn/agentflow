// The v3 animatic (90 s): every scene of docs/marketing/explainer-video-plan-v3.md, built on
// js/engine.js. Times come from js/timeline.js (scene starts and VO windows), so a re-generated
// VO re-times the picture without edits here.
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
  // Start of a word in a scene's VO (the TTS text, so "Agent Flow" is two words and "Q.C." is "QC"),
  // matched with case but without punctuation, so "And" is not the "and" in "day and night"; nth
  // picks a later occurrence. It throws rather than guess, so a script edit that drops an anchor
  // word shows up as a page error.
  const normWord = (w) => w.replaceAll(/[^A-Za-z0-9]/g, "");
  const W = (id, word, nth = 1) => {
    const hits = SC[id].words.filter(([, w]) => normWord(w) === normWord(word));
    if (hits.length < nth) {
      throw new Error(`${id}: the VO has no word "${word}" (#${nth})`);
    }
    return hits[nth - 1][0];
  };
  // The LD-6 walkthrough (C3–C7) moves its command slips at this speed, so the example stays short.
  const FAST = 0.6;

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
  // Shows plain DOM children one after another (display + a short rise), driven by t.
  function reveal(list, rise = 10, d = 0.3) {
    hook((t) => {
      for (const it of list) {
        const on = t >= it.t;
        it.el.style.display = on ? "" : "none";
        if (on) {
          const p = prog(t, it.t, it.t + d);
          it.el.style.opacity = String(p);
          it.el.style.transform = `translateY(${((1 - p) * rise).toFixed(1)}px)`;
        }
      }
    });
  }

  // ------------------------------------------------------------------ vocabulary
  const ICON = {
    board: `<svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="22" rx="4"/><line x1="12" y1="5" x2="12" y2="27"/><line x1="20" y1="5" x2="20" y2="27"/><rect class="f" x="5.6" y="9" width="4" height="5" rx="1"/><rect class="f" x="14" y="9" width="4" height="8" rx="1"/><rect class="f" x="22.4" y="9" width="4" height="4" rx="1"/></svg>`,
    chat: `<svg viewBox="0 0 32 32"><path d="M3.5 5.5h17v12h-9l-5 4v-4h-3z"/><path d="M23.5 10.5h5v11h-2.5v4l-5-4h-7v-2.5"/><line x1="8" y1="10.5" x2="16" y2="10.5"/><line x1="8" y1="13.5" x2="13" y2="13.5"/></svg>`,
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

  // Chat apps where AgentFlow asks people (shown as supported, per the v3 plan's decision).
  const APPS = [
    { k: "teams", name: "Teams", c: "#7b83eb" },
    { k: "slack", name: "Slack", c: "#e8467c" },
    { k: "zalo", name: "Zalo", c: "#3d8bff" },
    { k: "telegram", name: "Telegram", c: "#2aabee" },
    { k: "whatsapp", name: "WhatsApp", c: "#25d366" },
  ];
  const appChip = (a, dot = true) =>
    `<span class="app" data-app="${a.k}" style="--ac:${a.c}">${dot ? "<i></i>" : ""}${a.name}</span>`;
  const mention = (name) => `<span class="mention">@${name}</span>`;

  // Layout (1920 x 1080). Tools left, AgentFlow centre, agents right, people on top.
  const HUB = [960, 560];
  const TOOL_Y = { jira: 345, chat: 490, conf: 635, git: 780 };
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
  // C8: the other projects around the LeaveDesk board; C9: the ending.
  const wall = div(stage, { id: "wall", w: 1920, h: 1080, origin: "0 0" });
  const ending = div(stage, { id: "ending", w: 1920, h: 1080, origin: "0 0" });
  const endSvg = layer(ending);

  // Event registries, turned into hooks at the end.
  const mState = { ba: [], eng: [], qc: [] };
  const tileText = { jira: [], chat: [], conf: [], git: [] };
  const tileFlash = { jira: [], chat: [], conf: [], git: [] };
  const pillEv = [];
  const flowEv = [];
  const gateEv = [];
  const gateWin = [];
  const hubFlash = [];

  // ------------------------------------------------------------------ the map
  const toolDefs = [
    { k: "jira", title: "Jira · Azure DevOps", sub: L("where work starts", "nơi công việc bắt đầu"), icon: ICON.board },
    { k: "chat", title: "Chat", sub: null, icon: ICON.chat },
    { k: "conf", title: "Confluence", sub: L("documents", "tài liệu"), icon: ICON.doc },
    { k: "git", title: "Git", sub: "code", icon: ICON.branch },
  ];
  const tools = {};
  for (const d of toolDefs) {
    const sub = d.sub ? `<div class="tile-sub">${d.sub}</div>` : `<div class="apps">${APPS.map((a) => appChip(a, false)).join("")}</div>`;
    const n = div(map, {
      cls: `tile tile-${d.k}`,
      w: 380,
      h: 116,
      x: 60,
      y: TOOL_Y[d.k] - 58,
      o: 0,
      html: `<div class="tile-icon">${d.icon}</div><div class="tile-text"><div class="tile-title">${d.title}</div>${sub}<div class="tile-status"></div></div>`,
    });
    tools[d.k] = { n, status: n.querySelector(".tile-status"), apps: Array.from(n.querySelectorAll(".app")) };
  }

  const toolLines = {};
  for (const k of Object.keys(TOOL_Y)) {
    const y = TOOL_Y[k];
    toolLines[k] = path(mapSvg, `M${TOOL_EDGE},${y} C640,${y} 690,560 868,560`, "line", 1, true);
  }
  const agLines = {};
  for (const k of Object.keys(MC)) {
    const y = MC[k][1];
    agLines[k] = path(mapSvg, `M1052,560 C1220,560 1270,${y} ${MACH_EDGE},${y}`, "line", 1, true);
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
      html: `<div class="avatar-circle">${ICON.person}</div><div class="avatar-label">${p.label}</div><div class="at">@</div>`,
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

  // Flow bar: the rules' steps, and which role works at each.
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

  // Cursor.
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
  // k < 1 runs the trip to the gate, the checks and the trip to the agent faster.
  function slip({ role, cmd, t0, from = HUB, dy = 0, checks = ["ok", "ok", "ok"], target, hold = 0, k = 1 }) {
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
    toC(n, tm + 0.15 * k, tm + 0.75 * k, GATE[0], GATE[1] + dy, {}, "inOut");
    const tCheck = tm + 0.8 * k;
    gateEv.push([tCheck, checks, k]);
    gateWin.push([tm - 0.1, tm + 2.0 * k]);
    const bad = checks.indexOf("bad");
    if (bad === -1) {
      toC(n, tm + 1.3 * k, tm + 1.95 * k, target[0], target[1], { s: 0.45 });
      fadeOut(n, tm + 1.8 * k, 0.2);
      return tm + 1.95 * k;
    }
    const tBad = tCheck + bad * 0.15 * k + 0.05;
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

  // ------------------------------------------------------------------ C1 · agents are good, people carry the work
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
    const t0 = 0.5 + i * 0.25;
    const t1 = t0 + 2.1;
    hook((t) => {
      const p = clamp((t - t0) / (t1 - t0));
      const s = w.text.slice(0, Math.round(p * w.text.length));
      if (pre.textContent !== s) {
        pre.textContent = s;
      }
    });
    pop(n, 0.15 + i * 0.18, 0.55, 0.9);
    return n;
  });

  const T1MOVE = W("C1", "But") - 0.9;
  const T_FREEZE = END("C1", -0.55);
  wins.forEach((n, i) => {
    const [cx, cy] = MC[winKeys[i]];
    toC(n, T1MOVE, T1MOVE + 1.0, cx, cy, { s: 0.45 });
  });
  toolDefs.forEach((d, i) => pop(tools[d.k].n, T1MOVE + 0.25 + i * 0.12, 0.5, 0.92));
  pop(you, T1MOVE + 0.5, 0.5, 0.7);
  fadeIn(youTag, T1MOVE + 0.7);
  const clock = div(chaos, { cls: "clock", ...box(1030, 492, 40, 40), o: 0, html: ICON.clock });
  fadeIn(clock, T1MOVE + 1.5);
  const clockHand = clock.querySelector(".hand");
  hook((t) => {
    clockHand.setAttribute("transform", `rotate(${(Math.min(t, T_FREEZE) * 420) % 360} 16 16)`);
  });
  const copyLbl = div(chaos, { cls: "copy-label", ...box(860, 612, 80, 20), o: 0, html: "copy" });
  const pasteLbl = div(chaos, { cls: "copy-label", ...box(1060, 612, 80, 20), o: 0, html: "paste" });
  fadeIn(copyLbl, T1MOVE + 1.0);
  fadeIn(pasteLbl, T1MOVE + 1.15);

  const ENDS = {
    J: [TOOL_EDGE, TOOL_Y.jira],
    H: [TOOL_EDGE, TOOL_Y.chat],
    C: [TOOL_EDGE, TOOL_Y.conf],
    G: [TOOL_EDGE, TOOL_Y.git],
    R: [1426, 390],
    K: [1426, 560],
    T: [1426, 730],
  };
  const ROUTES = ["JR", "RC", "KH", "CK", "HG", "TJ", "GT", "RH", "KJ", "HC", "TG", "JK", "RG", "CT", "HK", "TR"];
  const tripTimes = [];
  let tTrip = T1MOVE + 0.95;
  let gap = 0.62;
  while (tTrip < T_FREEZE - 0.4) {
    tripTimes.push([tTrip, 1.15]);
    tTrip += gap;
    gap = Math.max(0.24, gap * 0.86);
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
    const amp = t < T_FREEZE ? 4.5 * prog(t, T1MOVE + 1.2, T_FREEZE, "linear") : 0;
    youCircle.style.transform = `translate(${Math.sin(t * 41) * amp}px,${Math.cos(t * 33) * amp}px)`;
  });
  const qtag1 = div(chaos, { cls: "qtag", ...box(1150, 440, 330, 56), o: 0, html: L("Who approved what?", "Ai đã duyệt gì?") });
  const qtag2 = div(chaos, { cls: "qtag", ...box(760, 690, 360, 56), o: 0, html: L("What's still waiting?", "Việc nào còn đang chờ?") });
  pop(qtag1, W("C1", "carry"), 0.45, 0.7);
  pop(qtag2, W("C1", "between"), 0.45, 0.7);
  seg(vignette, "o", [[T_FREEZE, 0], [T_FREEZE + 0.4, 0.55], [S("C2", 0.2), 0.55], [S("C2", 1.2), 0]]);
  fadeOut(chaos, S("C2", 0.05), 0.6);

  // World colour: the problem drains it, AgentFlow brings it back.
  hook((t) => {
    let sat;
    if (t < T1MOVE) {
      sat = lerp(0.85, 0.55, prog(t, 0, T1MOVE, "linear"));
    } else if (t < S("C2")) {
      sat = lerp(0.55, 0.12, prog(t, T1MOVE, T_FREEZE, "linear"));
    } else {
      sat = lerp(0.12, 1, prog(t, S("C2", 0.5), S("C2", 2.2)));
    }
    world.style.filter = sat >= 0.999 ? "none" : `saturate(${sat.toFixed(3)})`;
  });

  // ------------------------------------------------------------------ C2 · AgentFlow connects and coordinates
  fadeOut(youTag, S("C2", 0.1), 0.3);
  toC(you, S("C2", 0.2), S("C2", 1.2), 780, PPL_Y, { s: 64 / 76 });
  fadeIn(adminLabel, S("C2", 1.2));
  people.forEach((p, i) => pop(p, S("C2", 1.25 + i * 0.15), 0.45, 0.7));
  pop(decideTag, S("C2", 1.9), 0.45, 0.85);
  pop(hub, S("C2", 0.7), 0.8, 0.55);
  fadeIn(hubName, S("C2", 1.2), 0.5);
  fadeIn(hubRole, W("C2", "connects") - 0.1, 0.5);
  wins.forEach((n) => fadeOut(n, S("C2", 0.4), 0.6));
  ["ba", "eng", "qc"].forEach((k, i) => pop(ag[k].m, S("C2", 0.55 + i * 0.12), 0.6, 0.85));
  const T2TOOLS = W("C2", "connects");
  for (const k of Object.keys(toolLines)) {
    drawIn(toolLines[k], T2TOOLS, T2TOOLS + 0.8);
    tileFlash[k].push([T2TOOLS, T2TOOLS + 0.8]);
  }
  pop(hubKey, T2TOOLS + 0.45, 0.4, 1.3);
  ["jira", "chat", "conf", "git"].forEach((k, i) => pulse(toolLines[k], T2TOOLS + 0.5 + i * 0.1, T2TOOLS + 1.2 + i * 0.1));
  const T2AG = W("C2", "coordinates");
  for (const k of Object.keys(agLines)) {
    drawIn(agLines[k], T2AG, T2AG + 0.8);
  }
  pop(ag.ba.badge, T2AG + 0.1, 0.45, 0.85);
  pop(ag.eng.badge, T2AG + 0.3, 0.45, 0.85);
  pop(ag.qc.badge, T2AG + 0.5, 0.45, 0.85);
  ["ba", "eng", "qc"].forEach((k, i) => pulse(agLines[k], T2AG + 0.5 + i * 0.1, T2AG + 1.2 + i * 0.1));
  hubFlash.push([T2AG + 0.4, T2AG + 0.9]);
  fadeIn(boundary, W("C2", "own") - 0.2, 0.8);
  fadeIn(boundaryLabel, W("C2", "machines"), 0.6);

  // ------------------------------------------------------------------ C3 · a ticket; rules, cards and history pick the command
  pop(ticket, S("C3", 0.1), 0.5, 0.9);
  setPill(S("C3", 0.1), "To Do");
  tileFlash.jira.push([S("C3", 0.1), S("C3", 0.7)]);
  seg(flow, "o", [[S("C3", 0.4), 0], [S("C3", 0.9), 1, "out"]]);
  seg(flow, "y", [[S("C3", 0.4), 10], [S("C3", 1.0), 40, "out"]]);
  const T3CLICK = S("C3", 1.0);
  click(T3CLICK, PILL[0], PILL[1], [640, 330]);
  fadeOut(cursor, T3CLICK + 0.4, 0.25);
  setPill(T3CLICK + 0.05, "Requirements");
  flowEv.push([T3CLICK + 0.1, "a p p p p p"]);
  pulse(toolLines.jira, T3CLICK + 0.15, T3CLICK + 0.8);
  hubFlash.push([T3CLICK + 0.75, T3CLICK + 1.2]);

  // The three panels pop on "checks your rules", the command slip leaves on "calls".
  const T3 = { rules: W("C3", "checks") - 0.15, slip: W("C3", "calls") - 0.2 };
  T3.dim = T3.rules - 0.05;
  T3.cards = T3.rules + 0.3;
  T3.hist = T3.rules + 0.6;
  T3.conv = T3.slip - 0.1;
  T3.out = T3.slip + 0.5;
  const panelDefs = [
    {
      x: 100,
      num: 1,
      title: L("Rules", "Quy tắc"),
      body: [
        L("Requirements — BA writes them", "Requirements — BA viết yêu cầu"),
        "Planning — Engineering + QC",
        "Implement — Engineering",
        L("Testing — QC runs the tests", "Testing — QC chạy test"),
        L("Review — people merge", "Review — con người merge"),
        L("Questions → #ba · ask Minh (BA)", "Câu hỏi → #ba · hỏi Minh (BA)"),
      ]
        .map((l, i) => `<div class="pline${i === 0 ? " p-hl" : ""}${i === 5 ? " p-ask" : ""}">${l}</div>`)
        .join(""),
      t: T3.rules,
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
      t: T3.cards,
    },
    {
      x: 1280,
      num: 3,
      title: L("History · LD-6", "Lịch sử · LD-6"),
      body: `<div class="hrow">${L("Ticket created", "Tạo ticket")}<span class="when">2d</span></div><div class="hrow">${L("Moved to Requirements", "Chuyển sang Requirements")}<span class="when">${L("now", "vừa xong")}</span></div><div class="hrow p-hl">${L(
        "Requirements: none yet",
        "Bản yêu cầu: chưa có"
      )}</div><div class="tag-new p-tag">→ ${L("start new", "bắt đầu mới")}</div>`,
      t: T3.hist,
    },
  ];
  for (const p of panelDefs) {
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
      classWindows(el, "hl", [[hlAt, T3.out + 0.5]]);
    }
    for (const el of n.querySelectorAll(".p-hl2")) {
      classWindows(el, "hl", [[hlAt + 0.35, T3.out + 0.5]]);
    }
    const tag = n.querySelector(".p-tag");
    if (tag) {
      tag.style.opacity = "0";
      hook((t) => {
        tag.style.opacity = t >= hlAt + 0.4 ? "1" : "0";
      });
    }
    fadeOut(n, T3.out, 0.45);
  }
  const SLIP3 = [960, 760];
  // From the bottom edge of each panel to the slip, so no line crosses panel text.
  [
    `M370,700 C370,762 620,760 ${SLIP3[0] - 136},${SLIP3[1]}`,
    `M960,700 L960,${SLIP3[1] - 26}`,
    `M1550,700 C1550,762 1300,760 ${SLIP3[0] + 136},${SLIP3[1]}`,
  ].forEach((d, i) => {
    const p = path(overSvg, d, "converge", 1, true);
    drawIn(p, T3.conv + i * 0.08, T3.conv + 0.45 + i * 0.08);
    fadeOut(p, T3.out, 0.4);
  });
  const t3arrive = slip({ role: "ba", cmd: "/ba-requirement", t0: T3.slip, hold: T3.out - T3.slip, from: SLIP3, target: MC.ba, k: FAST });
  mState.ba.push([t3arrive, "run"]);

  // ------------------------------------------------------------------ C4 · questions go where people talk
  // Anchored to the VO words: "questions", "asks", "Jira", "team chat", "answer", "confirm", "records".
  mState.ba.push([W("C4", "The"), "wait"]);
  const T4Q = W("C4", "questions");
  const qBubble = div(over, { cls: "bubble", ...box(MC.ba[0], MC.ba[1] - 92, 200, 48), o: 0, html: L("3 questions", "3 câu hỏi") });
  pop(qBubble, W("C4", "agent") - 0.1, 0.35, 0.7);
  toC(qBubble, T4Q, T4Q + 0.6, HUB[0], 445);
  fadeOut(qBubble, T4Q + 0.8, 0.3);
  hubFlash.push([T4Q + 0.6, T4Q + 1.1]);
  const ruleChip = div(over, {
    cls: "rulechip",
    ...box(880, 800, 400, 40),
    o: 0,
    html: L("Rules: questions → #ba · ask Minh (BA)", "Quy tắc: câu hỏi → #ba · hỏi Minh (BA)"),
  });
  pop(ruleChip, W("C4", "Agent"), 0.4, 0.85);
  fadeOut(ruleChip, W("C4", "They"), 0.35);
  const T4ASK = W("C4", "asks");
  pulse(toolLines.jira, T4ASK, T4ASK + 1.0, true);
  pulse(toolLines.chat, T4ASK + 0.12, T4ASK + 1.12, true);
  classWindows(people[0], "ping", [[W("C4", "right"), W("C4", "records") + 0.3]]);

  // Jira: the questions as one comment on the ticket; people reply in its thread. No @mention:
  // only Teams asks mention people (apps/web/content/docs/integrations/microsoft-teams.mdx).
  const jComment = div(over, {
    cls: "jcomment",
    w: 380,
    h: 94,
    x: 462,
    y: TOOL_Y.jira - 70,
    o: 0,
    origin: "0 50%",
    html: `<div class="jc-top"><b>LD-6</b>${L("comment", "comment")} · AgentFlow</div><div class="jc-body">${L(
      "3 questions about the requirements.<br>Reply in this thread.",
      "3 câu hỏi về bản yêu cầu.<br>Trả lời trong thread này."
    )}</div>`,
  });
  const T4J = W("C4", "Jira") - 0.1;
  pop(jComment, T4J, 0.4, 0.85);
  tileFlash.jira.push([T4J, T4J + 0.7]);

  // Chat: one thread per case and channel; the post @mentions the people asked. The thread opens on
  // "team chat" and steps through the chat apps while the messages come in.
  const T4OPEN = W("C4", "team") - 0.15;
  seg(jComment, "o", [[T4OPEN + 0.3, 1], [T4OPEN + 0.9, 0.4]]);
  const T4APP = ["teams", "slack", "zalo", "telegram", "whatsapp", "teams"].map((k, i) => [k, T4OPEN + i * 0.5]);
  const activeApp = (t) => {
    let cur = null;
    for (const [k, at] of T4APP) {
      if (t >= at) {
        cur = k;
      }
    }
    return cur;
  };
  const CHAT = { x: 1100, y: 262, w: 780, h: 600 };
  const MSGS = [
    {
      who: "bot",
      t: T4OPEN + 0.45,
      html: `${mention("Minh")} ${L("3 questions on LD-6 · Requirements", "3 câu hỏi cho LD-6 · Requirements")}<ol><li>${L(
        "Show leave that isn't approved yet?",
        "Có hiện nghỉ chưa được duyệt không?"
      )}</li><li>${L("Filter by team or by office?", "Lọc theo team hay theo văn phòng?")}</li><li>${L(
        "Week view, month view, or both?",
        "Xem theo tuần, tháng hay cả hai?"
      )}</li></ol>`,
    },
    {
      who: "minh",
      t: W("C4", "They") - 0.2,
      html: `${mention("AgentFlow")} ${L("1. No, approved only · 2. By team · 3. Both", "1. Không, chỉ nghỉ đã duyệt · 2. Theo team · 3. Cả hai")}`,
    },
    {
      who: "bot",
      t: W("C4", "confirm") - 0.2,
      cls: "sum",
      html: `${L("Summary: approved leave only · by team · week and month views.", "Tóm tắt: chỉ nghỉ đã duyệt · theo team · xem theo tuần và tháng.")} ${mention("Minh")} ${L("confirm?", "xác nhận?")}`,
    },
    { who: "minh", t: W("C4", "confirm") + 0.45, cls: "ok", html: `${mention("AgentFlow")} ${L("Confirmed ✓", "Xác nhận ✓")}` },
  ];
  const WHO = {
    bot: { name: "AgentFlow", role: "", av: `<img src="${MARK}" alt="">` },
    minh: { name: "Minh", role: "BA", av: ICON.person },
  };
  const chatWin = div(over, {
    cls: "chatwin",
    w: CHAT.w,
    h: CHAT.h,
    x: 250 - CHAT.w / 2,
    y: TOOL_Y.chat - CHAT.h / 2,
    s: 0.3,
    o: 0,
    html: `<div class="chat-head"><div class="chat-chan"><span class="hash">#</span>ba<small>LeaveDesk</small></div><div class="chat-apps">${APPS.map((a) => appChip(a)).join("")}</div></div><div class="chat-body">${MSGS.map(
      (m) =>
        `<div class="msg ${m.who === "bot" ? "bot" : ""} ${m.cls || ""}"><div class="av">${WHO[m.who].av}</div><div><div class="who">${WHO[m.who].name}${
          WHO[m.who].role ? `<span>${WHO[m.who].role}</span>` : ""
        }</div><div class="txt">${m.html}</div></div></div>`
    ).join("")}<div class="recorded">✓ ${L("Recorded on LD-6 · confirmed by Minh", "Đã ghi nhận vào LD-6 · Minh xác nhận")}</div></div>`,
  });
  fadeIn(chatWin, T4OPEN, 0.3);
  to(chatWin, T4OPEN, T4OPEN + 0.6, { x: CHAT.x, y: CHAT.y, s: 1 }, "out");
  const msgEls = Array.from(chatWin.querySelectorAll(".msg"));
  const recorded = chatWin.querySelector(".recorded");
  const T4REC = W("C4", "records") - 0.1;
  reveal(msgEls.map((el, i) => ({ el, t: MSGS[i].t })).concat([{ el: recorded, t: T4REC }]));
  const winApps = Array.from(chatWin.querySelectorAll(".app"));
  hook((t) => {
    const k = activeApp(t);
    for (const el of winApps) {
      el.classList.toggle("on", el.dataset.app === k);
    }
    for (const el of tools.chat.apps) {
      el.classList.toggle("on", el.dataset.app === k && t < VE("C4", 0.4));
    }
    const a = APPS.find((x) => x.k === k) || APPS[0];
    chatWin.style.setProperty("--ac", a.c);
    toastIc.style.setProperty("--ac", a.c);
    if (toastIc.textContent !== a.name[0]) {
      toastIc.textContent = a.name[0];
    }
  });
  tileFlash.chat.push([T4OPEN, VE("C4", 0.3)]);
  tileText.chat.push([MSGS[0].t, L("#ba · 3 questions", "#ba · 3 câu hỏi")]);
  tileText.chat.push([T4REC, L("#ba · confirmed ✓", "#ba · đã xác nhận ✓")]);
  const toast = div(over, {
    cls: "toast",
    w: 380,
    h: 66,
    x: 1500,
    y: 140,
    o: 0,
    html: `<div class="ic"></div><div><div class="t1">${L("AgentFlow mentioned you", "AgentFlow nhắc đến bạn")}</div><div class="t2">Minh · #ba · ${L("3 questions on LD-6", "3 câu hỏi cho LD-6")}</div></div>`,
  });
  const toastIc = toast.querySelector(".ic");
  const T4TOAST = MSGS[0].t + 0.05;
  pop(toast, T4TOAST, 0.4, 0.85);
  seg(toast, "x", [[T4TOAST, 1560], [T4TOAST + 0.4, 1500, "out"]]);
  fadeOut(toast, MSGS[1].t + 0.3, 0.35);
  const t4ans = docTravel("answer", [[1180, 780], [HUB[0] + 40, HUB[1] + 10], HUB], T4REC + 0.1, 0.3);
  hubFlash.push([t4ans - 0.1, t4ans + 0.4]);
  const T4CLOSE = Math.max(VE("C4", 0.02), t4ans + 0.05);
  to(chatWin, T4CLOSE, T4CLOSE + 0.45, { x: 250 - CHAT.w / 2, y: TOOL_Y.chat - CHAT.h / 2, s: 0.3 }, "inOut");
  fadeOut(chatWin, T4CLOSE + 0.1, 0.35);
  fadeOut(jComment, T4CLOSE, 0.35);
  // The thread covers the infrastructure frame; hide the frame so its edge and label don't peek out.
  for (const n of [boundary, boundaryLabel]) {
    seg(n, "o", [[T4OPEN, 1], [T4OPEN + 0.3, 0], [T4CLOSE + 0.25, 0], [T4CLOSE + 0.65, 1]]);
  }

  // ------------------------------------------------------------------ C7 · people merge
  mState.qc.push([S("C7", 0.3), null]);
  setPill(S("C7", 0.1), "Review");
  flowEv.push([S("C7", 0.15), "d d d d a p"]);
  const prScrim = div(over, { cls: "scrim", ...box(960, 625, 940, 300), o: 0 });
  fadeIn(prScrim, S("C7", 0.15), 0.4);
  fadeOut(prScrim, END("C7", -0.15), 0.35);
  superText(L("Agents never merge.", "Agent không tự merge."), S("C7", 0.2), END("C7", -0.25), 960, 520, 700);
  // The merges land on "People do."; the clicks stay 0.7 s apart so the two cursor moves don't overlap.
  const T7MERGE = W("C7", "People") - 0.35;
  const prDefs = [
    ["eng", 540, "Pull request #6 · leavedesk-app", "Code"],
    ["qc", 980, "Pull request · leavedesk-qa", L("Tests", "Test")],
  ];
  prDefs.forEach(([k, x, head, what], i) => {
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
    pop(n, S("C7", 0.35 + i * 0.15), 0.45, 0.9);
    const pillEl = n.querySelector(".pr-pill");
    const tMerge = T7MERGE + i * 0.7;
    click(tMerge, x + 400 - 58, 600 + 150 - 32, i === 0 ? [980, 900] : null);
    classWindows(n, "merged", [[tMerge + 0.05, 1e9]]);
    hook((t) => {
      const txt = t >= tMerge + 0.05 ? L("Merged", "Đã merge") : L("In review", "Đang review");
      if (pillEl.textContent !== txt) {
        pillEl.textContent = txt;
      }
    });
    fadeOut(n, END("C7", -0.15), 0.35);
  });
  const T7DONE = T7MERGE + 0.7;
  fadeOut(cursor, T7DONE + 0.25, 0.3);
  tileText.git.push([T7DONE + 0.1, L("2 PRs merged ✓", "2 PR đã merge ✓")]);
  setPill(T7DONE + 0.3, "Done");
  flowEv.push([T7DONE + 0.35, "d d d d d d"]);

  // ------------------------------------------------------------------ C8 · many projects, around the clock, three kinds of start
  // Anchored to the VO words: "many projects", "at once", "day and night", "a ticket", "an email",
  // "a schedule", "And you see what needs a person".
  const GRID = { cw: 410, gx: 24, gy: 32, x0: 321, x1: 40, y0: 168 };
  GRID.k = GRID.cw / 1920;
  GRID.ch = 1080 * GRID.k;
  const cellXY = (i, x0) => [x0 + (i % 3) * (GRID.cw + GRID.gx), GRID.y0 + Math.floor(i / 3) * (GRID.ch + GRID.gy)];
  const T8 = {
    zoom: S("C8", 0.05),
    cards: W("C8", "Flow"),
    count: W("C8", "many"),
    par: W("C8", "once") - 0.1,
    clock: W("C8", "day") - 0.1,
    ticket: W("C8", "ticket") - 0.05,
    email: W("C8", "email") - 0.05,
    sched: W("C8", "schedule") - 0.05,
    shift: W("C8", "And") - 0.15,
  };
  T8.zoomEnd = T8.zoom + 1.4;
  T8.attn = T8.shift + 0.35;
  T8.popOut = T8.shift + 0.2;
  to(world, T8.zoom, T8.zoomEnd, { x: GRID.x0, y: GRID.y0, s: GRID.k }, "inOut");
  to(world, T8.shift, T8.shift + 0.8, { x: GRID.x1 }, "inOut");

  // A workflow starts from a ticket (t), an email (m) or a schedule (s).
  const TRG = {
    t: {
      c: "#4c9aff",
      at: T8.ticket,
      icon: `<svg viewBox="0 0 16 16"><path d="M2 4.5h12v2.3a1.5 1.5 0 0 0 0 2.9v2.3H2V9.7a1.5 1.5 0 0 0 0-2.9z"/></svg>`,
    },
    m: {
      c: "#ffb454",
      at: T8.email,
      icon: `<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M2.6 4.6 8 8.7l5.4-4.1"/></svg>`,
    },
    s: {
      c: "#5eead4",
      at: T8.sched,
      icon: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.9"/><path d="M8 4.9V8l2.2 1.5"/></svg>`,
    },
  };
  const PROJ = [
    { name: "LeaveDesk", key: "LD", wf: 24 },
    { name: "Payments", key: "PAY", wf: 31, lanes: [["Delivery", "t"], ["Bug triage", "t"], ["PR review", "t"], ["Release notes", "s"]] },
    {
      name: L("Mobile app", "Ứng dụng mobile"),
      key: "MOB",
      wf: 18,
      lanes: [["Delivery", "t"], ["Crash triage", "m"], ["UI tests", "s"], ["Store review", "m"]],
    },
    { name: "Data platform", key: "DATA", wf: 27, lanes: [["Pipeline fix", "t"], ["Delivery", "t"], ["Data checks", "s"], ["Docs sync", "s"]] },
    { name: "Website", key: "WEB", wf: 12, lanes: [["Delivery", "t"], ["Content", "m"], ["SEO audit", "s"], ["A11y check", "s"]] },
    { name: "HR portal", key: "HR", wf: 22, lanes: [["Delivery", "t"], ["Policy Q&A", "m"], ["Bug triage", "t"], ["Onboarding", "m"]] },
    { name: "Support bot", key: "SUP", wf: 35, lanes: [["Ticket triage", "m"], ["Answers", "m"], ["Escalations", "t"], ["Delivery", "t"]] },
    { name: "Billing", key: "BILL", wf: 16, lanes: [["Invoices", "m"], ["Delivery", "t"], ["Bug triage", "t"], ["Nightly audit", "s"]] },
    {
      name: L("Internal tools", "Công cụ nội bộ"),
      key: "OPS",
      wf: 29,
      lanes: [["Delivery", "t"], ["Access requests", "m"], ["Cleanup", "s"], ["PR review", "t"]],
    },
  ];
  // One example of each start, shown on its lane while the VO names it.
  const TRG_POP = [
    { card: 1, lane: 0, tg: "t", p1: L("New ticket · PAY-41", "Ticket mới · PAY-41"), p2: L("starts Delivery", "chạy Delivery") },
    {
      card: 6,
      lane: 0,
      tg: "m",
      p1: L("New email · support@acme.com", "Email mới · support@acme.com"),
      p2: L("starts Ticket triage", "chạy Ticket triage"),
    },
    {
      card: 7,
      lane: 3,
      tg: "s",
      p1: L("Schedule · every day 02:00", "Lịch · 02:00 mỗi ngày"),
      p2: L("starts Nightly audit", "chạy Nightly audit"),
    },
  ];
  const LANE_C = ["var(--ba)", "var(--eng-l)", "var(--qc-l)", "#01b8fc"];
  const laneTop = (li) => 46 + li * 34;
  const wallCards = [];
  const wallLabels = [];
  PROJ.forEach((p, i) => {
    const [x, y] = cellXY(i, GRID.x0);
    const label = div(wall, {
      cls: "proj-label",
      w: GRID.cw,
      h: 22,
      x,
      y: y - 26,
      o: 0,
      html: `${p.name}<span>${p.key}<em class="wfc"> · <b class="wfn">0</b> ${L("workflows", "workflow")}</em></span>`,
    });
    const tLab = i === 0 ? T8.zoom + 0.8 : T8.cards + 0.1 + i * 0.09;
    fadeIn(label, tLab, 0.4);
    to(label, T8.shift, T8.shift + 0.8, { x: cellXY(i, GRID.x1)[0] }, "inOut");
    wallLabels.push({ el: label.querySelector(".wfn"), wrap: label.querySelector(".wfc"), n: p.wf });
    if (i === 0) {
      wallCards.push(null);
      return;
    }
    const lanes = p.lanes
      .map(
        ([ln, tg], li) =>
          `<div class="lane" style="top:${laneTop(li)}px;--c:${LANE_C[(i + li) % 4]};--fc:${TRG[tg].c}"><i class="trg">${TRG[tg].icon}</i><div class="wn">${ln}</div><div class="tr"></div><i class="ch"></i><i class="ch"></i></div>`
      )
      .join("");
    const card = div(wall, {
      cls: "proj",
      w: GRID.cw,
      h: GRID.ch,
      x,
      y,
      o: 0,
      html: `<div class="pflow">${"<i></i>".repeat(6)}</div>${lanes}<div class="pmore">+${p.wf - 4} ${L("more workflows", "workflow khác")}</div><div class="pagents"><i style="--c:var(--ba)"></i><i style="--c:var(--eng-l)"></i><i style="--c:var(--qc-l)"></i></div>`,
    });
    pop(card, T8.cards + i * 0.09, 0.5, 0.88);
    to(card, T8.shift, T8.shift + 0.8, { x: cellXY(i, GRID.x1)[0] }, "inOut");
    classWindows(card, "glow", [[T8.par, T8.par + 0.9]]);
    wallCards.push(card);
    // Every lane of a kind lights up when the VO names that kind, rippling across the wall.
    Array.from(card.querySelectorAll(".lane")).forEach((laneEl, li) => {
      const tg = p.lanes[li][1];
      const t0 = TRG[tg].at + i * 0.035;
      const wins = [[t0, t0 + 0.9]];
      if (TRG_POP.some((pp) => pp.card === i && pp.lane === li)) {
        wins.push([TRG[tg].at, T8.popOut + 0.35]);
      }
      classWindows(laneEl, "fire", wins);
    });
    const cells = Array.from(card.querySelectorAll(".pflow i"));
    const chips = Array.from(card.querySelectorAll(".ch"));
    const dots = Array.from(card.querySelectorAll(".pagents i"));
    const speed = 0.38 + (i % 4) * 0.09;
    hook((t) => {
      const step = Math.floor(t * speed * 1.6 + i * 1.7) % 7;
      cells.forEach((c, ci) => {
        c.className = ci < step ? "d" : ci === step ? "a" : "";
      });
      chips.forEach((c, ci) => {
        const u = (t * (0.16 + ((i + ci) % 5) * 0.03) + ci * 0.37 + i * 0.11) % 1;
        c.style.left = `${142 + u * 200}px`;
      });
      dots.forEach((d, di) => {
        d.classList.toggle("run", Math.sin(t * (1.3 + di * 0.4) + i * 2.1 + di) > -0.2);
      });
    });
  });
  for (const pp of TRG_POP) {
    const below = pp.lane === 0;
    const ly = laneTop(pp.lane);
    const n = div(wallCards[pp.card], {
      cls: `trgpop ${below ? "below" : "above"}`,
      x: 4,
      y: below ? ly + 34 : ly - 62,
      o: 0,
      origin: below ? "10% 0" : "10% 100%",
      html: `<i class="ti">${TRG[pp.tg].icon}</i><div><div class="p1">${pp.p1}</div><div class="p2">${pp.p2}</div></div>`,
    });
    n.style.setProperty("--fc", TRG[pp.tg].c);
    pop(n, TRG[pp.tg].at, 0.4, 0.8);
    fadeOut(n, T8.popOut, 0.35);
  }
  hook((t) => {
    const p = prog(t, T8.count, T8.count + 1.1);
    // The per-card count appears with "Dozens of workflows each", not as a waiting "0".
    const o = String(prog(t, T8.count - 0.1, T8.count + 0.3));
    for (const lb of wallLabels) {
      lb.wrap.style.opacity = o;
      lb.el.textContent = String(Math.round(lb.n * p));
    }
  });
  const STATS = [
    [9, L("projects", "project"), T8.zoom + 0.6],
    [214, L("workflows", "workflow"), T8.count],
    [38, L("cases running", "case đang chạy"), T8.par],
    [21, L("agents online", "agent online"), T8.par + 0.3],
  ];
  const statsEl = div(wall, {
    cls: "wall-head",
    w: 1840,
    h: 60,
    x: 40,
    y: 62,
    o: 0,
    html: `${STATS.map(([, lbl]) => `<div class="stat"><b>0</b>${lbl}</div>`).join("")}<span class="demo">${L("demo data", "dữ liệu mẫu")}</span>`,
  });
  fadeIn(statsEl, T8.zoom + 0.5, 0.5);
  const statEls = Array.from(statsEl.querySelectorAll(".stat"));
  const statNums = statEls.map((el) => el.querySelector("b"));
  hook((t) => {
    // Each stat appears when its count starts (on its VO words), so no "0" waits on screen.
    STATS.forEach(([n, , t0], i) => {
      statEls[i].style.opacity = String(prog(t, t0 - 0.1, t0 + 0.3));
      statNums[i].textContent = String(Math.round(n * prog(t, t0, t0 + 1.0)));
    });
  });

  // 24/7: a time-lapse clock; it reaches 02:00 when the scheduled audit starts.
  const wallClock = div(wall, {
    cls: "clock24",
    h: 56,
    x: 40,
    y: 64,
    o: 0,
    html: `<svg class="dial" viewBox="0 0 46 46"><circle cx="23" cy="23" r="20"/><line x1="23" y1="23" x2="23" y2="13"/><line x1="23" y1="23" x2="23" y2="7"/></svg><div><span class="day"></span><b class="tm"></b></div><span class="tag">24/7</span>`,
  });
  pop(wallClock, T8.clock, 0.4, 0.85);
  const CLOCK_RATE = (17 * 60) / (T8.sched - T8.clock);
  const clockAt = (t) => {
    if (t <= T8.sched) {
      return 9 * 60 + Math.max(0, t - T8.clock) * CLOCK_RATE;
    }
    if (t <= T8.sched + 0.6) {
      return 26 * 60 + (t - T8.sched) * 3;
    }
    return 26 * 60 + 1.8 + (t - T8.sched - 0.6) * CLOCK_RATE;
  };
  const DAYS = [L("Mon", "Thứ 2"), L("Tue", "Thứ 3"), L("Wed", "Thứ 4")];
  const [hourHand, minHand] = Array.from(wallClock.querySelectorAll("line"));
  const dayEl = wallClock.querySelector(".day");
  const timeEl = wallClock.querySelector(".tm");
  hook((t) => {
    const m = clockAt(t);
    const h = Math.floor(m / 60) % 24;
    const txt = `${String(h).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
    if (timeEl.textContent !== txt) {
      timeEl.textContent = txt;
    }
    dayEl.textContent = DAYS[Math.floor(m / 1440)];
    hourHand.setAttribute("transform", `rotate(${((m / 720) * 360).toFixed(1)} 23 23)`);
    minHand.setAttribute("transform", `rotate(${(((m % 60) / 60) * 360).toFixed(1)} 23 23)`);
    wallClock.classList.toggle("night", h >= 19 || h < 6);
  });

  const ATTN = [
    ["wait", L("Waiting for a person", "Chờ người"), "LD-12", "LeaveDesk · Delivery", "5m", APPS[0], 0],
    ["dec", L("Pending decision", "Chờ quyết định"), "PAY-7", "Payments · Release notes", "12m", null, 1],
    ["wait", L("Waiting for a person", "Chờ người"), "DATA-5", "Data platform · Pipeline fix", "26m", APPS[2], 3],
    ["blk", L("Blocked task", "Task bị chặn"), "MOB-33", `${L("Mobile app", "Ứng dụng mobile")} · UI tests`, "1h", null, 2],
  ];
  const attn = div(wall, {
    cls: "attn",
    w: 530,
    x: 1350,
    y: GRID.y0 - 26,
    o: 0,
    html: `<div class="attn-title">${L("Needs attention", "Cần người xử lý")}</div>${ATTN.map(
      ([k, kind, key, where, age, app]) =>
        `<div class="attn-row"><div class="k1"><span class="kind ${k}">${kind}</span><span class="key">${key}</span><span class="age">${age}</span></div><div class="k2">${where}${
          app ? ` · ${L("asked in", "đã hỏi trên")} ${appChip(app)}` : ""
        }</div></div>`
    ).join("")}`,
  });
  fadeIn(attn, T8.attn, 0.4);
  seg(attn, "x", [[T8.attn, 1500], [T8.attn + 0.5, 1350, "out"]]);
  const attnRows = Array.from(attn.querySelectorAll(".attn-row"));
  const attnAt = (i) => T8.attn + 0.35 + i * 0.36;
  reveal(attnRows.map((el, i) => ({ el, t: attnAt(i) })), 8);
  ATTN.forEach((row, i) => {
    const card = wallCards[row[6]];
    if (card) {
      classWindows(card, "att", [[attnAt(i), 1e9]]);
    }
  });
  const ldRing = div(wall, { cls: "ld-ring", w: GRID.cw + 6, h: GRID.ch + 6, x: GRID.x0 - 3, y: GRID.y0 - 3, o: 0 });
  seg(ldRing, "o", [[attnAt(0), 0], [attnAt(0) + 0.25, 1]]);
  seg(ldRing, "x", [[T8.shift, GRID.x0 - 3], [T8.shift + 0.8, GRID.x1 - 3, "inOut"]]);
  [world, wall].forEach((n) => fadeOut(n, S("C9", 0.0), 0.5));

  // ------------------------------------------------------------------ C9 · logo + line
  const LANES = [
    ["#00CCFE", "M-60,250 C320,250 470,345 640,352"],
    ["#5f86ff", "M-60,400 C320,400 470,384 650,384"],
    ["#a978ee", "M-60,560 C320,560 470,420 640,414"],
  ];
  LANES.forEach(([color, d], i) => {
    const p = path(endSvg, d, "line", 1, true);
    p.style.stroke = color;
    p.style.strokeWidth = "6";
    drawIn(p, S("C9", 0.3 + i * 0.12), S("C9", 1.1 + i * 0.12));
    fadeOut(p, S("C9", 1.45), 0.5);
  });
  const logo = div(ending, {
    w: 700,
    h: 106,
    x: 610,
    y: 330,
    o: 0,
    html: `<img src="${LOGO}" alt="AgentFlow" style="width:700px;height:106px;display:block">`,
  });
  pop(logo, S("C9", 1.05), 0.7, 0.86);
  const triad = [
    [`<span class="agents">${L("Agents do the work.", "Agent làm việc.")}</span>`, V("C9", 0.0)],
    [`<span class="af">${L("AgentFlow coordinates.", "AgentFlow điều phối.")}</span>`, V("C9", 0.36)],
    [`<span class="ppl">${L("People decide.", "Con người quyết định.")}</span>`, V("C9", 0.7)],
  ];
  triad.forEach(([html, t], i) => {
    const n = div(ending, { cls: "triad", ...box(960, 520 + i * 76, 1400, 70), o: 0, html });
    pop(n, t - 0.05, 0.5, 0.92);
  });
  const cta = div(ending, {
    cls: "cta",
    ...box(960, 800, 1000, 80),
    o: 0,
    html: `Self-hosted · ${L("Open source (MIT)", "Mã nguồn mở (MIT)")}<small>CTA / URL — ${L("to be decided", "chưa chốt")}</small>`,
  });
  fadeIn(cta, V("C9", 0.78), 0.6);

  // ------------------------------------------------------------------ map visibility (one track, in time order)
  anim(map, {
    o: [
      [0, 1],
      [T3.dim, 1],
      [T3.dim + 0.4, 0.14],
      [T3.out, 0.14],
      [T3.out + 0.5, 1],
      [S("C7", 0.1), 1],
      [S("C7", 0.5), 0.3],
      [S("C8", 0.0), 0.3],
      [S("C8", 0.45), 1],
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
    let cls = "tk-pill";
    if (v === "Done") {
      cls += " done";
    } else if (v && v !== "To Do") {
      cls += " prog";
    }
    ticketPill.className = cls;
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
      if (t >= ev[0] - 0.05 && t < ev[0] + 1.25 * ev[2]) {
        active = ev;
      }
    }
    gateLights.forEach((el, i) => {
      let st = "";
      if (active) {
        const states = active[1];
        const bad = states.indexOf("bad");
        const shown = t >= active[0] + i * 0.15 * active[2];
        if (shown && (bad === -1 || i <= bad) && states[i]) {
          st = states[i];
        }
      }
      el.className = `gate-light${st ? ` ${st}` : ""}`;
      let mark = "";
      if (st === "ok") {
        mark = "✓";
      } else if (st === "bad") {
        mark = "✕";
      }
      el.textContent = mark;
    });
  });

  // ------------------------------------------------------------------ app screens (U scenes)
  // A U scene plays a motion clip of the real app (assets/ui/<clip>.webm, tools/ui-clip.mjs) in a
  // browser frame over a plain backdrop. The clip follows t: it is seeked on every captured frame
  // (window.__settle waits for the seek) and kept in sync while the preview plays.
  const UI_FRAME = { x: 192, y: 40, w: 1536, h: 864, bar: 38 };
  const CLIP_LEN = 5;
  const UI_CAMERA = {
    connections: [[0.15, 0.5, 0.5, 1], [1.0, 0.44, 0.3, 1.65], [2.6, 0.44, 0.3, 1.65], [3.4, 0.66, 0.3, 1.65]],
    workflows: [[0.1, 0.5, 0.5, 1], [0.8, 0.51, 0.42, 1.4], [2.9, 0.51, 0.42, 1.4], [3.6, 0.64, 0.36, 1.4]],
    agents: [[0.1, 0.5, 0.5, 1], [0.9, 0.42, 0.38, 1.5], [2.4, 0.42, 0.38, 1.5], [3.1, 0.45, 0.33, 1.65]],
    runs: [[0.1, 0.5, 0.5, 1], [0.8, 0.53, 0.4, 1.3], [2.9, 0.53, 0.4, 1.3], [3.8, 0.45, 0.3, 1.35]],
    home: [[0, 0.43, 0.3, 1.62], [1.2, 0.43, 0.31, 1.7]],
  };
  const CAPTURE = new URLSearchParams(location.search).has("capture");
  const uiVideos = [];
  function syncVideo(video, local, on) {
    if (!on) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }
    if (window.__playing && !CAPTURE) {
      if (video.paused && local < CLIP_LEN - 0.05) {
        video.play().catch(() => {
          // observability: autoplay can be refused; the seek below still shows the right frame
        });
      }
      if (Math.abs(video.currentTime - local) > 0.2) {
        video.currentTime = local;
      }
      return;
    }
    if (!video.paused) {
      video.pause();
    }
    if (Math.abs(video.currentTime - local) > 0.001) {
      video.currentTime = local;
    }
  }
  for (const sc of TL.scenes.filter((s) => s.clip)) {
    const t0 = sc.start;
    const t1 = sc.end;
    const layer = div(stage, { cls: "ui-scene", w: 1920, h: 1080, x: 0, y: 0, o: 0 });
    layer.innerHTML = `<div class="ui-frame" style="left:${UI_FRAME.x}px;top:${UI_FRAME.y}px;width:${UI_FRAME.w}px;height:${UI_FRAME.h + UI_FRAME.bar}px"><div class="ui-bar"><i></i><i></i><i></i><span>app.acme.example/${sc.clip}</span></div><div class="ui-view"><video muted playsinline preload="auto" src="assets/ui/${sc.clip}.webm"></video></div></div>`;
    const frame = layer.querySelector(".ui-frame");
    const video = layer.querySelector("video");
    uiVideos.push(video);
    fadeIn(layer, t0, 0.35);
    fadeOut(layer, t1 - 0.3, 0.3);
    hook((t) => {
      const on = t >= t0 - 0.05 && t <= t1;
      layer.style.visibility = on ? "visible" : "hidden";
      const enter = prog(t, t0, t0 + 0.7);
      const drift = clamp((t - t0) / (t1 - t0));
      frame.style.transform = `scale(${(lerp(0.94, 1, enter) * lerp(1, 1.015, drift)).toFixed(4)})`;
      const local = clamp(t - t0 - 0.25, 0, CLIP_LEN - 1 / 30);
      video.style.transform = cameraTransform(UI_CAMERA[sc.clip], t - t0 - 0.25);
      syncVideo(video, local, on);
    });
  }
  const whenReady = (v) =>
    new Promise((resolve) => {
      if (v.readyState >= 2 && !v.seeking) {
        resolve();
        return;
      }
      const done = () => resolve();
      v.addEventListener("seeked", done, { once: true });
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      setTimeout(done, 4000);
    });
  window.__uiReady = Promise.all(uiVideos.map(whenReady));
  window.__settle = () => Promise.all(uiVideos.map(whenReady));

  // Camera inside each app clip: [clip time, centre x, centre y, zoom], centre as a fraction of the
  // page. It starts on the whole page, pushes in where the clip moves and follows the pointer. The
  // clips are 2560 wide, so up to about 1.65× stays sharp. Home stays on the Attention card (the
  // activity chart below it is in tokens).
  function cameraTransform(keys, ct) {
    if (!keys) {
      return "";
    }
    let [, cx, cy, z] = keys[0];
    for (let i = 1; i < keys.length; i++) {
      const [ta, xa, ya, za] = keys[i - 1];
      const [tb, xb, yb, zb] = keys[i];
      if (ct >= ta) {
        const p = prog(ct, ta, tb, "inOut");
        cx = lerp(xa, xb, p);
        cy = lerp(ya, yb, p);
        z = lerp(za, zb, p);
      }
    }
    const W = UI_FRAME.w;
    const H = UI_FRAME.h;
    const tx = Math.min(0, Math.max(W * (1 - z), W * (0.5 - cx * z)));
    const ty = Math.min(0, Math.max(H * (1 - z), H * (0.5 - cy * z)));
    return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
  }

  // ------------------------------------------------------------------ headlines
  // v4 has no voice: each scene's line (tools/script.json en/vi) is on screen for the whole scene.
  const cap = div(stage, { cls: "caption", w: 1920, h: 110, x: 0, y: 940, html: "<span></span>" });
  const capSpan = cap.querySelector("span");
  hook((t) => {
    const sc = TL.scenes.find((s) => t >= s.start && t < s.end && s[LANG]);
    const a = sc ? Math.min(1, (t - sc.start - 0.2) / 0.35, (sc.end - 0.15 - t) / 0.3) : 0;
    const txt = sc ? sc[LANG] : "";
    if (capSpan.textContent !== txt) {
      capSpan.textContent = txt;
    }
    cap.style.opacity = String(clamp(a));
    cap.style.visibility = a > 0 ? "visible" : "hidden";
    capSpan.style.transform = `translateY(${(10 * (1 - clamp(a))).toFixed(1)}px)`;
  });

  window.SCENE_LANG = LANG;
})();
