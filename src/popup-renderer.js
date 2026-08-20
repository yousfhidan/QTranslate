/* ============================================================
   Popup Renderer — مكتوب من الصفر
   ============================================================ */

// ─── الثوابت ──────────────────────────────────────────────────
const LANGS = {
  ar: { name: '🇸🇦 عربي', dir: 'rtl' },
  en: { name: '🇺🇸 English', dir: 'ltr' },
  zh: { name: '🇨🇳 中文', dir: 'ltr' },
  fr: { name: '🇫🇷 Français', dir: 'ltr' },
  es: { name: '🇪🇸 Español', dir: 'ltr' },
};

// ─── الحالة ───────────────────────────────────────────────────
let srcText = '';
let tgtText = '';
let isPinned = false;
let timerID = null;
let timerSecs = 0;
let showingOrig = false;

// ─── العناصر ──────────────────────────────────────────────────
const elLoading = document.getElementById('state-loading');
const elResult = document.getElementById('state-result');
const elOriginal = document.getElementById('state-original');
const elError = document.getElementById('state-error');
const elSrc = document.getElementById('pl-src');
const elTgt = document.getElementById('pl-tgt');
const elEngine = document.getElementById('pop-engine');
const elTimerBar = document.getElementById('timer-fill');
const elTimerTxt = document.getElementById('pop-timer-text');

// ─── عرض الحالات ──────────────────────────────────────────────
function showLoading() {
  elLoading.style.display = 'flex';
  elResult.style.display = 'none';
  elError.style.display = 'none';
  elOriginal.style.display = 'none';
}

function showResult(text, dir) {
  elLoading.style.display = 'none';
  elError.style.display = 'none';
  elResult.style.display = 'block';
  elResult.textContent = text;
  elResult.style.direction = dir;
  elResult.style.textAlign = dir === 'rtl' ? 'right' : 'left';
}

function showError(msg) {
  elLoading.style.display = 'none';
  elResult.style.display = 'none';
  elError.style.display = 'block';
  elError.textContent = '⚠️ ' + msg;
}

// ─── كشف اللغة ────────────────────────────────────────────────
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[àâçéèêëîïôûùü]/i.test(text)) return 'fr';
  if (/[áéíóúñ]/i.test(text)) return 'es';
  return 'en';
}

// ─── Fetch مع timeout يدوي ────────────────────────────────────
function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// ─── محركات الترجمة ───────────────────────────────────────────
async function googleTranslate(text, from, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchTimeout(url, 7000);
  if (!res.ok) throw new Error('Google HTTP ' + res.status);
  const data = await res.json();
  const out = data[0].map(i => i[0]).filter(Boolean).join('');
  if (!out) throw new Error('Google empty');
  return out;
}

async function myMemoryTranslate(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const res = await fetchTimeout(url, 9000);
  if (!res.ok) throw new Error('MyMemory HTTP ' + res.status);
  const data = await res.json();
  if (data.responseStatus === 200 && data.responseData.translatedText)
    return data.responseData.translatedText;
  throw new Error('MyMemory failed');
}

// ─── الترجمة الرئيسية ─────────────────────────────────────────
async function translate(text) {
  showLoading();
  stopTimer();
  srcText = text;
  tgtText = '';

  const from = detectLang(text);
  const to = (from === 'ar') ? 'en' : 'ar';   // عربي→إنجليزي وإنجليزي→عربي تلقائياً

  elSrc.textContent = LANGS[from]?.name || from;
  elTgt.textContent = LANGS[to]?.name || to;

  try {
    // جرب Google أولاً
    try {
      tgtText = await googleTranslate(text, from, to);
      elEngine.textContent = 'Google Translate';
    } catch (e1) {
      console.warn('[popup] Google failed:', e1.message);
      // جرب MyMemory كبديل
      tgtText = await myMemoryTranslate(text, from, to);
      elEngine.textContent = 'MyMemory';
    }

    showResult(tgtText, LANGS[to]?.dir || 'ltr');
    resizeWindow();
    startTimer(15);

  } catch (err) {
    console.error('[popup] All engines failed:', err.message);
    showError(err.message || 'تعذرت الترجمة');
  }
}

// ─── تغيير حجم النافذة ────────────────────────────────────────
function resizeWindow() {
  requestAnimationFrame(() => {
    const wrap = document.querySelector('.popup-wrap');
    const h = Math.min(Math.max(wrap.scrollHeight, 110), 320);
    const w = Math.min(Math.max(elResult.scrollWidth + 60, 300), 540);
    window.popupAPI.resize(Math.round(w), Math.round(h));
  });
}

// ─── مؤقت الإغلاق التلقائي ────────────────────────────────────
function startTimer(secs) {
  if (isPinned) return;
  stopTimer();
  timerSecs = secs;

  elTimerBar.style.transition = 'none';
  elTimerBar.style.width = '100%';
  elTimerTxt.textContent = timerSecs + 's';
  elTimerTxt.classList.remove('urgent');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    elTimerBar.style.transition = `width ${timerSecs}s linear`;
    elTimerBar.style.width = '0%';
  }));

  timerID = setInterval(() => {
    timerSecs--;
    elTimerTxt.textContent = timerSecs + 's';
    if (timerSecs <= 5) elTimerTxt.classList.add('urgent');
    if (timerSecs <= 0) { stopTimer(); window.popupAPI.close(); }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerID);
  timerID = null;
  elTimerTxt.textContent = '';
  elTimerBar.style.transition = 'none';
  elTimerBar.style.width = '100%';
}

// ─── أحداث الماوس على النافذة ─────────────────────────────────
document.querySelector('.popup-wrap').addEventListener('mouseenter', () => {
  if (isPinned) return;
  stopTimer();
  elTimerTxt.textContent = '⏸';
});
document.querySelector('.popup-wrap').addEventListener('mouseleave', () => {
  if (isPinned) return;
  startTimer(10);
});

// ─── الأزرار ──────────────────────────────────────────────────
document.getElementById('btn-close').onclick = () => window.popupAPI.close();

document.getElementById('btn-pin').onclick = () => {
  isPinned = !isPinned;
  document.getElementById('btn-pin').classList.toggle('active', isPinned);
  window.popupAPI.pin();
  if (isPinned) stopTimer();
  else startTimer(10);
};

document.getElementById('btn-expand').onclick = () => window.popupAPI.openMain(srcText);

document.getElementById('btn-copy').onclick = () => {
  if (!tgtText) return;
  window.popupAPI.copyText(tgtText);
  const btn = document.getElementById('btn-copy');
  btn.textContent = '✅';
  setTimeout(() => { btn.textContent = '📋'; }, 1500);
};

document.getElementById('btn-toggle-src').onclick = () => {
  showingOrig = !showingOrig;
  document.getElementById('btn-toggle-src').classList.toggle('active', showingOrig);
  if (showingOrig) {
    elOriginal.textContent = srcText;
    elOriginal.style.display = 'block';
  } else {
    elOriginal.style.display = 'none';
  }
  resizeWindow();
};

document.getElementById('btn-tts').onclick = () => {
  if (!tgtText) return;
  const lang = elTgt.textContent.includes('عربي') ? 'ar-SA'
    : elTgt.textContent.includes('中文') ? 'zh-CN'
      : elTgt.textContent.includes('Français') ? 'fr-FR'
        : elTgt.textContent.includes('Español') ? 'es-ES' : 'en-US';
  const u = new SpeechSynthesisUtterance(tgtText);
  u.lang = lang; u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ─── Escape للإغلاق ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.popupAPI.close();
});

// ─── استقبال النص من main process ────────────────────────────
window.popupAPI.onTranslate((text) => {
  if (text && text.trim()) translate(text.trim());
});
