// ==UserScript==
// @name         Margonem – Alarm nieaktywności (Zzz)
// @namespace    majcinai
// @version      1.0.0
// @description  Głośne, widoczne ostrzeżenie przed stanem nieaktywności: dźwięk, pulsująca ramka, animacja Zzz, migający tytuł karty.
// @author       majcinai
// @homepageURL  https://github.com/majcinai/alarmstasis
// @supportURL   https://github.com/majcinai/alarmstasis/issues
// @updateURL    https://raw.githubusercontent.com/majcinai/alarmstasis/main/alarmstasis.user.js
// @downloadURL  https://raw.githubusercontent.com/majcinai/alarmstasis/main/alarmstasis.user.js
// @match        https://*.margonem.pl/*
// @match        https://margonem.pl/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    volume: 0.35,          // 0..1
    beepEveryMs: 4000,     // odstęp dźwięku przy ostrzeżeniu
    urgentBelowSec: 15,    // poniżej tylu sekund – szybciej i głośniej
    urgentBeepEveryMs: 1500,
    stasisBeepEveryMs: 10000, // gdy już jesteś w stanie nieaktywności
    notify: true,          // powiadomienie systemowe, gdy karta jest w tle
  };

  // ---------- STYL ----------
  const css = `
  @keyframes afkPulse { 0%,100% { box-shadow: inset 0 0 0 4px rgba(255,60,60,.9), inset 0 0 40px rgba(255,0,0,.45);} 50% { box-shadow: inset 0 0 0 8px rgba(255,200,0,.95), inset 0 0 90px rgba(255,0,0,.75);} }
  @keyframes afkZ { 0% { transform: translate(0,0) scale(.6) rotate(-10deg); opacity:0 } 15% {opacity:1} 100% { transform: translate(60px,-160px) scale(1.6) rotate(15deg); opacity:0 } }
  @keyframes afkShake { 0%,100%{transform:translate(-50%,-50%)} 25%{transform:translate(calc(-50% - 4px),-50%) rotate(-1deg)} 75%{transform:translate(calc(-50% + 4px),-50%) rotate(1deg)} }
  @keyframes afkBlink { 50% { opacity:.35 } }

  .afk-alarm-frame { position:absolute; inset:0; pointer-events:none; z-index:9999; animation: afkPulse 1s ease-in-out infinite; background: rgba(40,0,60,.25); }
  .afk-alarm-frame.urgent { animation-duration:.45s; background: rgba(90,0,0,.30); }
  .afk-alarm-frame.stasis { animation-duration:2s; background: rgba(0,0,0,.55); }

  .afk-alarm-box { position:absolute; left:50%; top:28%; transform:translate(-50%,-50%); text-align:center;
    font: 700 22px/1.3 Georgia, serif; color:#fff; padding:16px 26px; border-radius:12px;
    background: rgba(20,0,30,.85); border:3px solid #ffcc33; text-shadow:0 0 8px #000, 0 0 3px #f00;
    animation: afkShake .6s ease-in-out infinite; white-space:nowrap; }
  .afk-alarm-box .afk-sec { display:block; font-size:54px; color:#ffdd44; animation: afkBlink 1s steps(1) infinite; }
  .afk-alarm-frame.urgent .afk-alarm-box .afk-sec { color:#ff4444; animation-duration:.4s; }
  .afk-alarm-box .afk-hint { display:block; font-size:14px; color:#ddd; font-weight:400; margin-top:4px; }

  .afk-z { position:absolute; font: 900 40px Georgia, serif; color:#aee4ff; text-shadow:0 0 10px #39f, 0 0 2px #000;
    animation: afkZ 2.4s ease-out infinite; }
  .afk-z:nth-child(1){ left:20%; bottom:20%; animation-delay:0s }
  .afk-z:nth-child(2){ left:30%; bottom:25%; animation-delay:.8s; font-size:30px }
  .afk-z:nth-child(3){ left:65%; bottom:22%; animation-delay:.4s; font-size:48px }
  .afk-z:nth-child(4){ left:75%; bottom:28%; animation-delay:1.3s; font-size:28px }
  .afk-z:nth-child(5){ left:48%; bottom:15%; animation-delay:1.8s }

  /* powiększ też oryginalny napis gry */
  .stasis-incoming-overlay__text { font-size: 20px !important; color:#ffdd44 !important; }
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // ---------- DŹWIĘK ----------
  let ctx = null;
  const getCtx = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  // przeglądarka wymaga interakcji – odblokuj audio przy pierwszym kliknięciu/klawiszu
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, getCtx, { capture: true, passive: true }));

  function tone(freq, start, dur, vol, type = 'square') {
    const c = getCtx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const sounds = {
    warn:   () => { const v = CFG.volume; tone(880, 0, .15, v); tone(660, .18, .15, v); tone(880, .36, .25, v); },
    urgent: () => { const v = Math.min(1, CFG.volume * 1.5); for (let i = 0; i < 4; i++) tone(1200, i * .12, .09, v); },
    stasis: () => { const v = CFG.volume; tone(440, 0, .5, v, 'sine'); tone(330, .5, .5, v, 'sine'); tone(220, 1, .9, v, 'sine'); },
  };

  // ---------- TYTUŁ KARTY ----------
  let titleTimer = null, savedTitle = null;
  function blinkTitle(text) {
    if (titleTimer) return;
    savedTitle = document.title;
    let on = false;
    titleTimer = setInterval(() => { on = !on; document.title = on ? text : savedTitle; }, 700);
  }
  function stopTitle() {
    if (!titleTimer) return;
    clearInterval(titleTimer); titleTimer = null;
    if (savedTitle !== null) document.title = savedTitle;
  }

  // ---------- NAKŁADKA ----------
  let frame = null;
  function ensureFrame() {
    const host = document.querySelector('.game-layer');
    if (!host) return null;
    if (!frame || !host.contains(frame)) {
      frame = document.createElement('div');
      frame.className = 'afk-alarm-frame';
      frame.innerHTML = `<div class="afk-zs">${'<span class="afk-z">Z</span>'.repeat(5)}</div>
        <div class="afk-alarm-box"><span class="afk-title"></span><span class="afk-sec"></span><span class="afk-hint">Wykonaj ruch postacią!</span></div>`;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(frame);
    }
    return frame;
  }
  function hideFrame() { if (frame) { frame.remove(); frame = null; } }

  // ---------- STAN ----------
  const visible = sel => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
  const secondsLeft = () => {
    const t = document.querySelector('.stasis-incoming-overlay__text');
    const m = t && t.textContent.match(/(\d+)\s*s/);
    return m ? +m[1] : null;
  };

  let mode = 'none', lastBeep = 0, notified = false;

  function tick() {
    const now = Date.now();
    let newMode = 'none';
    if (visible('.stasis-overlay')) newMode = 'stasis';
    else if (visible('.stasis-incoming-overlay')) newMode = 'warn';

    if (newMode === 'none') {
      if (mode !== 'none') { hideFrame(); stopTitle(); notified = false; }
      mode = 'none';
      return;
    }

    const f = ensureFrame(); if (!f) return;
    const sec = secondsLeft();
    const urgent = newMode === 'warn' && sec !== null && sec <= CFG.urgentBelowSec;

    f.classList.toggle('urgent', urgent);
    f.classList.toggle('stasis', newMode === 'stasis');
    f.querySelector('.afk-title').textContent = newMode === 'stasis' ? 'STAN NIEAKTYWNOŚCI' : 'Zaraz zaśniesz!';
    f.querySelector('.afk-sec').textContent = newMode === 'stasis' ? 'Zzz…' : (sec !== null ? sec + 's' : '!');

    if (mode !== newMode) { lastBeep = 0; }
    const every = newMode === 'stasis' ? CFG.stasisBeepEveryMs : (urgent ? CFG.urgentBeepEveryMs : CFG.beepEveryMs);
    if (now - lastBeep >= every) {
      lastBeep = now;
      sounds[newMode === 'stasis' ? 'stasis' : (urgent ? 'urgent' : 'warn')]();
    }

    blinkTitle(newMode === 'stasis' ? '💤 NIEAKTYWNY!' : `⚠️ AFK za ${sec ?? '?'}s!`);

    if (CFG.notify && !notified && document.hidden && 'Notification' in window) {
      notified = true;
      const send = () => new Notification('Margonem', { body: newMode === 'stasis' ? 'Jesteś w stanie nieaktywności!' : `Za ${sec}s wejdziesz w stan nieaktywności!` });
      if (Notification.permission === 'granted') send();
      else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && send());
    }
    mode = newMode;
  }

  setInterval(tick, 300);

  // test ręczny w konsoli: afkAlarmTest()
  window.afkAlarmTest = () => { getCtx(); sounds.warn(); setTimeout(sounds.urgent, 1200); setTimeout(sounds.stasis, 2400); };
})();