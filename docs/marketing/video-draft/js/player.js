// Player chrome for the animatic: clock (audio-driven when the scratch VO plays), scrubber,
// scene jumps, EN/VI switch, captions and VO toggles, and a capture API for headless frames.
(function () {
  "use strict";
  const TL = window.TIMELINE;
  const params = new URLSearchParams(location.search);
  const capture = params.has("capture");
  const lang = window.SCENE_LANG;
  const DUR = TL.duration;
  const { clamp } = E;

  const stage = document.getElementById("stage");
  const viewport = document.getElementById("viewport");
  const audio = document.getElementById("vo");
  const playBtn = document.getElementById("play");
  const timeEl = document.getElementById("time");
  const scrub = document.getElementById("scrub");
  const voBtn = document.getElementById("vo-btn");
  const ccBtn = document.getElementById("cc-btn");
  const langBtn = document.getElementById("lang-btn");
  const scenesEl = document.getElementById("scenes");

  if (capture) {
    document.body.classList.add("capture");
  }

  function fit() {
    if (capture) {
      stage.style.transform = "none";
      stage.style.left = "0px";
      stage.style.top = "0px";
      return;
    }
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    const s = Math.min(w / 1920, h / 1080);
    stage.style.transform = `scale(${s})`;
    stage.style.left = `${(w - 1920 * s) / 2}px`;
    stage.style.top = `${(h - 1080 * s) / 2}px`;
  }
  window.addEventListener("resize", fit);
  fit();

  let t = clamp(parseFloat(params.get("t") || "0") || 0, 0, DUR);
  let playing = false;
  let lastNow = performance.now();
  let voOn = Boolean(TL.audio) && !capture && lang === "en" && params.get("vo") !== "0";
  if (TL.audio && !capture) {
    audio.src = TL.audio;
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function seek(nt) {
    t = clamp(nt, 0, DUR);
    if (voOn) {
      try {
        audio.currentTime = t;
      } catch {
        // observability: the audio element may not be ready yet; the clock still moves
      }
    }
  }
  function play() {
    if (t >= DUR - 0.05) {
      seek(0);
    }
    playing = true;
    lastNow = performance.now();
    if (voOn) {
      audio.currentTime = t;
      audio.play().catch(() => {
        voOn = false;
        updateButtons();
      });
    }
    updateButtons();
  }
  function pause() {
    playing = false;
    audio.pause();
    updateButtons();
  }
  function updateButtons() {
    playBtn.textContent = playing ? "❚❚ Pause" : "▶ Play";
    voBtn.classList.toggle("on", voOn);
    voBtn.disabled = !TL.audio;
    ccBtn.classList.toggle("on", !stage.classList.contains("nocc"));
    langBtn.textContent = lang === "vi" ? "VI → EN" : "EN → VI";
  }

  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  scrub.addEventListener("input", () => seek((scrub.value / 1000) * DUR));
  voBtn.addEventListener("click", () => {
    voOn = !voOn;
    if (voOn && playing) {
      audio.currentTime = t;
      audio.play().catch(() => {
        voOn = false;
        updateButtons();
      });
    } else {
      audio.pause();
    }
    updateButtons();
  });
  ccBtn.addEventListener("click", () => {
    stage.classList.toggle("nocc");
    updateButtons();
  });
  langBtn.addEventListener("click", () => {
    const next = new URLSearchParams(location.search);
    next.set("lang", lang === "vi" ? "en" : "vi");
    next.set("t", t.toFixed(2));
    location.search = next.toString();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.code === "ArrowRight") {
      seek(t + 3);
    } else if (e.code === "ArrowLeft") {
      seek(t - 3);
    } else if (e.code === "Home") {
      seek(0);
    }
  });

  const sceneBtns = TL.scenes.map((sc) => {
    const b = document.createElement("button");
    b.textContent = `${sc.id} · ${sc.title}`;
    b.title = sc[lang];
    b.addEventListener("click", () => seek(sc.start + 0.01));
    scenesEl.appendChild(b);
    return b;
  });
  const note = document.createElement("span");
  note.id = "note";
  note.textContent =
    lang === "vi"
      ? "Lời đọc tạm: giọng TTS tiếng Anh của Windows (máy chưa có giọng tiếng Việt). Phụ đề là kịch bản VI."
      : "Scratch VO: Windows TTS. Captions show the script.";
  scenesEl.appendChild(note);

  let lastScene = -1;
  function frame(now) {
    if (playing) {
      if (voOn && !audio.paused && !audio.ended) {
        t = audio.currentTime;
      } else {
        t += (now - lastNow) / 1000;
      }
      if (t >= DUR) {
        t = DUR;
        pause();
      }
    }
    lastNow = now;
    E.render(t);
    timeEl.textContent = `${fmt(t)} / ${fmt(DUR)}`;
    if (document.activeElement !== scrub) {
      scrub.value = String(Math.round((t / DUR) * 1000));
    }
    let cur = 0;
    TL.scenes.forEach((sc, i) => {
      if (t >= sc.start) {
        cur = i;
      }
    });
    if (cur !== lastScene) {
      sceneBtns.forEach((b, i) => b.classList.toggle("cur", i === cur));
      lastScene = cur;
    }
    requestAnimationFrame(frame);
  }

  updateButtons();
  E.render(t);
  if (!capture) {
    requestAnimationFrame(frame);
  }

  // Capture API (tools/shoot.mjs, tools/render-webm.mjs).
  const images = Array.from(document.images);
  window.__duration = DUR;
  window.__render = (tt) => {
    t = tt;
    E.render(tt);
  };
  window.__ready = Promise.all([
    document.fonts.ready,
    ...images.map((img) => (img.decode ? img.decode().catch(() => null) : null)),
  ]).then(() => true);
})();
