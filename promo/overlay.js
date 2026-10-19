// Promo overlay: captions, the recurring score widget and the closing postcard.
// Injected into planet.html by promo/render.mjs. Every style is a pure function of time t (seconds),
// set from frame(t); there are no CSS transitions or timers.
(() => {
  const timing = window.__promoTiming;
  const seg = Object.fromEntries(timing.segments.map(s => [s.id, s]));
  const ev = timing.events;

  const CAPTIONS = [
    { id: "hook", lines: ["你的人生，", "是一颗小星球"], size: 40 },
    { id: "dive", lines: ["健康、工作、娱乐和爱，", "都长在上面"], size: 30 },
    { id: "workshop", lines: ["工作堵着，", "烟囱就冒黑烟"], size: 30 },
    { id: "lanterns", lines: ["爱有几分，", "灯就亮几颗"], size: 30 },
    { id: "sky", lines: ["多久没好好", "看一次晚霞了？"], size: 30 }
  ];
  const WIDGETS = {
    workshop: { label: "工作 · 工坊", steps: ev.work },
    lanterns: { label: "爱 · 双生灯", steps: ev.bulbs },
    sky: { label: "娱乐 · 晚霞", steps: ev.play }
  };

  const style = document.createElement("style");
  style.textContent = `
    @font-face { font-family: "Promo Serif"; src: url("./promo/promo-serif-600.woff2") format("woff2"); font-weight: 600; }
    .hud-top, .labels, .hint, .interact-btn, .intro, .sheet, .sheet-backdrop, .loading, .toast, .joystick { display: none !important; }
    #promo { position: fixed; inset: 0; pointer-events: none; z-index: 50; font-family: "Promo Serif", serif; color: #2f3756; }
    #promo .cap { position: absolute; left: 36px; right: 36px; top: 96px; }
    #promo .cap div { font-weight: 600; letter-spacing: 0.06em; line-height: 1.32; text-shadow: 0 0 18px rgba(251, 243, 232, 0.85), 0 0 4px rgba(251, 243, 232, 0.6); will-change: transform, opacity; }
    #promo .widget { position: absolute; left: 32px; width: 268px; top: 214px; padding: 12px 16px 14px; border-radius: 16px; background: rgba(255, 251, 244, 0.9); box-shadow: 0 10px 30px rgba(35, 29, 43, 0.16); }
    #promo .w-top { display: flex; justify-content: space-between; align-items: baseline; }
    #promo .w-label { font-family: -apple-system, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; font-size: 14px; letter-spacing: 0.18em; color: #3f4560; }
    #promo .w-tag { font-family: -apple-system, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; font-size: 13px; letter-spacing: 0.1em; color: #4f5570; margin-left: 8px; padding: 1px 6px; border: 1px solid #c9bba8; border-radius: 6px; }
    #promo .w-num { font-size: 40px; line-height: 1; color: #a9471a; font-variant-numeric: tabular-nums; transform-origin: right bottom; }
    #promo .w-num small { font-size: 14px; color: #6b6f86; margin-left: 3px; }
    #promo .track { position: relative; height: 8px; margin-top: 12px; border-radius: 8px; background: #eadfd1; }
    #promo .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 8px; background: #c95a26; }
    #promo .dot { position: absolute; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: #c95a26; border: 4px solid #fff; box-shadow: 0 2px 8px rgba(35, 29, 43, 0.25); }
    #promo .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, #fbf3e8, #f6ecde); }
    #promo .card { position: absolute; left: 50%; top: 188px; width: 400px; margin-left: -200px; transform-origin: 50% 0; border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(35, 29, 43, 0.28); }
    #promo .card img { display: block; width: 100%; }
    #promo .link { position: absolute; left: 0; right: 0; top: 732px; text-align: center; }
    #promo .link b { display: inline-block; padding: 7px 18px 7px 22px; border-radius: 999px; background: #a9471a; color: #fff; font-family: -apple-system, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; font-size: 20px; font-weight: 700; letter-spacing: 0.2em; box-shadow: 0 6px 18px rgba(169, 71, 26, 0.28); }
    #promo .card-tag { position: absolute; top: 14px; right: 14px; padding: 3px 10px 3px 12px; border-radius: 999px; background: #c95a26; color: #fff; font-family: -apple-system, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; font-size: 13px; letter-spacing: 0.2em; }
    #promo .cta { position: absolute; left: 0; right: 0; top: 88px; text-align: center; }
    #promo .cta b { display: block; font-weight: 600; font-size: 36px; letter-spacing: 0.16em; padding-left: 0.16em; text-shadow: 0 0 18px rgba(251, 243, 232, 0.9); }
    #promo .cta span { display: block; margin-top: 8px; font-family: -apple-system, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; font-size: 12px; letter-spacing: 0.28em; color: #4f5570; text-shadow: 0 0 10px rgba(251, 243, 232, 0.9); }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "promo";
  root.innerHTML = `
    <div class="cap" id="pCap"></div>
    <div class="widget" id="pWidget">
      <div class="w-top"><span><span class="w-label" id="pLabel"></span><span class="w-tag">示例</span></span><span class="w-num" id="pNum"></span></div>
      <div class="track"><div class="fill" id="pFill"></div><div class="dot" id="pDot"></div></div>
    </div>
    <div class="scrim" id="pScrim"></div>
    <div class="card" id="pCard"><img id="pCardImg" alt=""><span class="card-tag">示例</span></div>
    <div class="cta" id="pCta"><b>测测你的小星球</b><span>约 3 分钟 · 6 个小站</span></div>
    <div class="link" id="pLink"><b>链接在评论区</b></div>
  `;
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
  const easeOutBack = x => {
    const c = 1.6;
    const u = clamp(x) - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };

  // Lines rise in with a stagger, hold, then lift away just before the segment ends.
  function lineStyle(t, start, end, index) {
    const tin = (t - start - 0.08 - index * 0.12) / 0.42;
    const tout = (t - (end - 0.32)) / 0.28;
    const a = easeOut(tin) * (1 - easeOut(tout));
    const y = (1 - easeOut(tin)) * 18 - easeOut(tout) * 10;
    return { opacity: a, transform: `translateY(${y.toFixed(2)}px)` };
  }

  // The integer score at time t: it steps on each tick in timing.json.
  function scoreAt(t, steps) {
    let n = steps.from;
    steps.steps.forEach((s, i) => { if (t >= s) n = steps.from + (i + 1) * Math.sign(steps.to - steps.from); });
    return n;
  }

  let lastCap = null;
  function frame(t) {
    const active = timing.segments.find(s => t >= s.start && t < s.end) || timing.segments[timing.segments.length - 1];

    // Captions.
    const cap = CAPTIONS.find(c => c.id === active.id);
    if (cap !== lastCap) {
      $("pCap").innerHTML = cap ? cap.lines.map(l => `<div style="font-size:${cap.size}px">${l}</div>`).join("") : "";
      lastCap = cap;
    }
    if (cap) {
      [...$("pCap").children].forEach((el, i) => Object.assign(el.style, lineStyle(t, active.start, active.end, i)));
    }
    // The hook's first frame must already be a finished picture, so its title is fully in at t = 0.
    if (active.id === "hook") {
      [...$("pCap").children].forEach(el => {
        const out = easeOut((t - (active.end - 0.32)) / 0.28);
        el.style.opacity = 1 - out;
        el.style.transform = `translateY(${(-t * 3 - out * 10).toFixed(2)}px)`;
      });
    }

    // The score widget travels through the three stops; its label swaps at each segment boundary.
    const w = WIDGETS[active.id];
    const firstW = seg.workshop.start;
    const lastW = seg.sky.end;
    const wIn = easeOutBack((t - firstW - 0.15) / 0.5);
    const wOut = easeOut((t - (lastW - 0.3)) / 0.3);
    // Between stops the card dips out with the caption, so the new label never arrives before its words.
    const dip = [seg.lanterns.start, seg.sky.start].reduce((k, b) => {
      if (t >= b - 0.32 && t < b) return k * (1 - easeOut((t - (b - 0.32)) / 0.28));
      if (t >= b && t < b + 0.5) return k * easeOut((t - b - 0.08) / 0.42);
      return k;
    }, 1);
    $("pWidget").style.opacity = clamp(wIn) * (1 - wOut) * dip;
    $("pWidget").style.transform = `translateY(${((1 - wIn) * 40 + wOut * 20).toFixed(2)}px)`;
    if (w) {
      $("pLabel").textContent = w.label;
      const n = scoreAt(t, w.steps);
      const prev = scoreAt(t - 1 / 30, w.steps);
      $("pNum").innerHTML = `${n}<small>/10</small>`;
      // Smooth the dot between steps so it glides rather than jumps.
      const stepTimes = w.steps.steps;
      let frac = w.steps.from / 10;
      stepTimes.forEach((s, i) => {
        const k = easeOut((t - s) / 0.14);
        frac += (k * Math.sign(w.steps.to - w.steps.from)) / 10;
      });
      $("pFill").style.width = `${(frac * 100).toFixed(2)}%`;
      $("pDot").style.left = `${(frac * 100).toFixed(2)}%`;
      const pop = n !== prev ? 1.12 : 1;
      $("pNum").style.transform = `scale(${pop})`;
    }

    // Closing: the postcard rises from below, overshoots a little and settles; the call to action follows.
    const card = easeOutBack((t - ev.card_rise) / (ev.card_land - ev.card_rise + 0.25));
    // After landing the card keeps growing slowly from its top edge, so the last beat never freezes
    // and the card never rises into the title above it.
    const settle = clamp((t - ev.card_land) / (timing.length - ev.card_land));
    $("pScrim").style.opacity = easeOut((t - ev.card_rise + 0.1) / 0.45);
    $("pCard").style.opacity = clamp((t - ev.card_rise) / 0.2);
    // The overshoot is kept small so the rising card never touches the title above it.
    const rise = (1 - card) * 760;
    $("pCard").style.transform = `translateY(${(rise < 0 ? rise * 0.15 : rise).toFixed(2)}px) rotate(${((1 - clamp(card)) * -4).toFixed(2)}deg) scale(${(1 + settle * 0.04).toFixed(4)})`;
    // Words wait until the card has landed, so nothing fades in over a moving card.
    const cta = easeOut((t - ev.cta - 0.1) / 0.45);
    $("pCta").style.opacity = cta;
    $("pCta").style.transform = `translateY(${((1 - cta) * 14).toFixed(2)}px)`;
    const link = easeOutBack((t - ev.cta - 0.3) / 0.45);
    $("pLink").style.opacity = clamp(link);
    $("pLink").style.transform = `translateY(${((1 - link) * 12).toFixed(2)}px)`;
  }

  window.__promo = {
    frame,
    setCard(src) {
      $("pCardImg").src = src;
    }
  };
})();
