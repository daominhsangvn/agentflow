// Player chrome for the animatic: clock (audio-driven when the scratch VO or the music plays),
// scrubber, scene jumps, EN/VI switch, captions, VO and music toggles, and a capture API for
// headless frames.
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
  const music = document.getElementById("music");
  const musicBtn = document.getElementById("music-btn");
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
  let musicOn = !capture && params.get("music") !== "0";
  if (!capture) {
    music.addEventListener("error", () => {
      // observability: no audio/music.wav yet (tools/make-music.mjs); the animatic plays without it
      musicOn = false;
      musicBtn.disabled = true;
      updateButtons();
    });
    music.src = "audio/music.wav";
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function seek(nt) {
    t = clamp(nt, 0, DUR);
    if (musicOn) {
      music.currentTime = t;
    }
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
    if (musicOn) {
      music.currentTime = t;
      music.play().catch(() => {
        musicOn = false;
        updateButtons();
      });
    }
    updateButtons();
  }
  function pause() {
    playing = false;
    audio.pause();
    music.pause();
    updateButtons();
  }
  function updateButtons() {
    playBtn.textContent = playing ? "❚❚ Pause" : "▶ Play";
    voBtn.classList.toggle("on", voOn);
    voBtn.disabled = !TL.audio;
    musicBtn.classList.toggle("on", musicOn);
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
  musicBtn.addEventListener("click", () => {
    musicOn = !musicOn;
    if (musicOn && playing) {
      music.currentTime = t;
      music.play().catch(() => {
        musicOn = false;
        updateButtons();
      });
    } else {
      music.pause();
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
      ? "Lời đọc tạm: giọng TTS tiếng Anh của Windows (máy chưa có giọng tiếng Việt). Nhạc: tự tạo (tools/make-music.mjs). Phụ đề là kịch bản VI."
      : "Scratch VO: Windows TTS. Music: original, generated (tools/make-music.mjs). Captions show the script.";
  scenesEl.appendChild(note);

  let lastScene = -1;
  function frame(now) {
    if (playing) {
      const clockEl = audioClock();
      if (clockEl) {
        t = clockEl.currentTime;
      } else {
        t += (now - lastNow) / 1000;
      }
      if (clockEl === audio && musicOn && Math.abs(music.currentTime - t) > 0.2) {
        music.currentTime = t;
      }
      if (t >= DUR) {
        t = DUR;
        pause();
      }
    }
    music.volume = musicVolume(t);
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

  // The playing VO drives the clock, else the playing music, else the frame clock.
  function audioClock() {
    if (voOn && !audio.paused && !audio.ended) {
      return audio;
    }
    if (musicOn && !music.paused && !music.ended) {
      return music;
    }
    return null;
  }
  // Under the voice the music sits lower and dips while a line is spoken, like tools/make-mp4.mjs.
  function musicVolume(tt) {
    if (!voOn) {
      return MUSIC_SOLO;
    }
    let inLine = 0;
    for (const sc of TL.scenes) {
      const down = clamp((tt - (sc.voStart - DUCK_RAMP)) / DUCK_RAMP);
      const up = clamp((sc.voStart + sc.voDur + DUCK_RAMP - tt) / DUCK_RAMP);
      inLine = Math.max(inLine, down * up);
    }
    return MUSIC_UNDER_VO * (1 - DUCK_DEPTH * inLine);
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

  // Music volume (0–1) with the VO on and alone, and the dip while a line is spoken (−7 dB over
  // 0.35 s ramps). Set from the measured loudness of audio/vo-en.wav (−20.4 LUFS) and
  // audio/music.wav (−16.4 LUFS): under the VO the music sits 7 dB below it, as in tools/make-mp4.mjs.
  const MUSIC_UNDER_VO = 0.28;
  const MUSIC_SOLO = 0.5;
  const DUCK_DEPTH = 1 - 10 ** (-7 / 20);
  const DUCK_RAMP = 0.35;
})();
