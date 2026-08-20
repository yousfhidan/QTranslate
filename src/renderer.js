/* ============================================================
   QTranslate v2 — Renderer (Multi-Engine + OCR)
   ============================================================ */

// ─── State ────────────────────────────────────────────────────
const state = {
  sourceLang: 'auto', targetLang: 'en',
  engine: localStorage.getItem('qt_engine') || 'google',
  history: JSON.parse(localStorage.getItem('qt_history') || '[]'),
  // ✅ Fix: apiKeys loaded via decodeKey() — see loadApiKeys() below
  apiKeys: {},
  isTranslating: false, debounceTimer: null, currentText: '',
};

const LANGS = {
  auto: { name: 'تلقائي', flag: '🔍', dir: 'rtl' },
  ar: { name: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  en: { name: 'English', flag: '🇺🇸', dir: 'ltr' },
  zh: { name: '中文', flag: '🇨🇳', dir: 'ltr' },
  fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr' },
  es: { name: 'Español', flag: '🇪🇸', dir: 'ltr' },
};

const $ = (id) => document.getElementById(id);
const sourceText = $('source-text');
const targetText = $('target-text');
const charCount = $('char-count');
const detectedLang = $('detected-lang');
const historyPanel = $('history-panel');
const historyList = $('history-list');
const historyCount = $('history-count');
const engineName = $('engine-name');
const engineSelect = $('engine-select');

// ─── Window Controls ──────────────────────────────────────────
$('btn-minimize').onclick = () => window.electronAPI.minimize();
$('btn-maximize').onclick = () => window.electronAPI.maximize();
$('btn-close').onclick = () => window.electronAPI.close();

// ─── Translation Engines ──────────────────────────────────────

// 1. Google Translate (free, no key)
async function googleTranslate(text, from, to) {
  const sl = from === 'auto' ? 'auto' : from;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  return data[0].map(i => i[0]).filter(Boolean).join('');
}

// 2. MyMemory (free, no key)
async function myMemoryTranslate(text, from, to) {
  const sl = from === 'auto' ? detectLangHeuristic(text) : from;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${to}&de=qtranslate@app.com`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (data.responseStatus === 200) return data.responseData.translatedText;
  throw new Error('MyMemory error: ' + data.responseStatus);
}

// 3. LibreTranslate (free, public mirrors)
async function libreTranslate(text, from, to) {
  const mirrors = ['https://translate.argosopentech.com/translate', 'https://libretranslate.de/translate'];
  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: from === 'auto' ? 'auto' : from, target: to }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (data.translatedText) return data.translatedText;
    } catch { /* try next */ }
  }
  throw new Error('LibreTranslate failed');
}

// 4. DeepL (free tier — needs API key)
async function deeplTranslate(text, from, to) {
  const key = state.apiKeys.deepl;
  if (!key) { showSettingsPanel(); throw new Error('أدخل DeepL API Key في الإعدادات'); }
  const langMap = { zh: 'ZH', ar: 'AR', en: 'EN', fr: 'FR', es: 'ES' };
  const tgt = langMap[to] || to.toUpperCase();
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, target_lang: tgt, ...(from !== 'auto' ? { source_lang: from.toUpperCase() } : {}) }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.translations?.[0]) return data.translations[0].text;
  throw new Error('DeepL error');
}

// 5. Microsoft Translator (needs Azure key)
async function microsoftTranslate(text, from, to) {
  const key = state.apiKeys.microsoft;
  if (!key) { showSettingsPanel(); throw new Error('أدخل Microsoft API Key في الإعدادات'); }
  const params = new URLSearchParams({ 'api-version': '3.0', to });
  if (from !== 'auto') params.append('from', from);
  const res = await fetch(`https://api.cognitive.microsofttranslator.com/translate?${params}`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ Text: text }]),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data[0]?.translations?.[0]) return data[0].translations[0].text;
  throw new Error('Microsoft error');
}

// 6. Yandex Translate (needs API key)
async function yandexTranslate(text, from, to) {
  const key = state.apiKeys.yandex;
  if (!key) { showSettingsPanel(); throw new Error('أدخل Yandex API Key في الإعدادات'); }
  const lang = from === 'auto' ? to : `${from}-${to}`;
  const res = await fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?key=${key}&lang=${lang}&text=${encodeURIComponent(text)}`, {
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.text?.[0]) return data.text[0];
  throw new Error('Yandex error');
}

// ─── Master Translate Function ────────────────────────────────
async function translateText(text, from, to) {
  try {
    switch (state.engine) {
      case 'google': return await googleTranslate(text, from, to);
      case 'mymemory': return await myMemoryTranslate(text, from, to);
      case 'libre': return await libreTranslate(text, from, to);
      case 'deepl': return await deeplTranslate(text, from, to);
      case 'microsoft': return await microsoftTranslate(text, from, to);
      case 'yandex': return await yandexTranslate(text, from, to);
      default: return await googleTranslate(text, from, to);
    }
  } catch (primaryErr) {
    console.warn(`[Translate] Primary engine (${state.engine}) failed:`, primaryErr.message);
    // Fallback 1: Google Translate
    if (state.engine !== 'google') {
      try {
        const res = await googleTranslate(text, from, to);
        showToast('⚠️ تعذر المحرك الرئيسي، تم التحويل تلقائياً لـ Google', '');
        return res;
      } catch (_) { }
    }
    // Fallback 2: MyMemory
    if (state.engine !== 'mymemory') {
      try {
        const res = await myMemoryTranslate(text, from, to);
        showToast('⚠️ تعذر المحرك الرئيسي، تم التحويل تلقائياً لـ MyMemory', '');
        return res;
      } catch (_) { }
    }
    throw primaryErr;
  }
}

const ENGINE_LABELS = {
  google: 'Google Translate', mymemory: 'MyMemory',
  libre: 'LibreTranslate', deepl: 'DeepL',
  microsoft: 'Microsoft Translator', yandex: 'Yandex',
};

// ─── Lang Detection ───────────────────────────────────────────
function detectLangHeuristic(text) {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[àâçéèêëîïôûùü]/i.test(text)) return 'fr';
  if (/[áéíóúñ¡¿]/i.test(text)) return 'es';
  return 'en';
}

// ─── Do Translate ─────────────────────────────────────────────
async function doTranslate() {
  const text = sourceText.value.trim();
  if (!text) { showEmptyState(); return; }
  if (state.isTranslating) return;
  state.isTranslating = true;
  setLoadingState(true);

  try {
    const srcLang = state.sourceLang === 'auto' ? detectLangHeuristic(text) : state.sourceLang;
    let tgtLang = state.targetLang;
    // ✅ Fix: if source and target are the same, pick a sensible fallback
    // but do NOT mutate state.targetLang — this is a per-translation override only
    if (srcLang === tgtLang) tgtLang = srcLang === 'ar' ? 'en' : 'ar';

    const result = await translateText(text, state.sourceLang, tgtLang);
    if (!result) throw new Error('Empty response');

    showTranslation(result, srcLang, tgtLang);
    addToHistory(text, result, srcLang, tgtLang);
    engineName.textContent = ENGINE_LABELS[state.engine] || state.engine;
  } catch (err) {
    showError(err.message || 'حدث خطأ في الترجمة');
  } finally {
    state.isTranslating = false;
    setLoadingState(false);
  }
}

// ─── UI Helpers ───────────────────────────────────────────────
function setLoadingState(on) {
  $('loading-overlay').classList.toggle('active', on);
  const si = $('translate-status');
  si.classList.toggle('translating', on);
  si.querySelector('.status-icon').textContent = on ? '⏳' : '⚡';
}

function showTranslation(text, srcLang, tgtLang) {
  targetText.className = 'text-area output-area has-content';
  targetText.innerHTML = `<div class="output-text" style="direction:${LANGS[tgtLang]?.dir || 'ltr'}">${escapeHtml(text)}</div>`;
  if (state.sourceLang === 'auto' && LANGS[srcLang]) {
    detectedLang.textContent = `${LANGS[srcLang].flag} تم اكتشاف: ${LANGS[srcLang].name}`;
  } else detectedLang.textContent = '';
  $('target-panel-title').textContent = `الترجمة — ${LANGS[tgtLang]?.flag || ''} ${LANGS[tgtLang]?.name || ''}`;
}

function showEmptyState() {
  targetText.className = 'text-area output-area';
  targetText.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><p>الترجمة ستظهر هنا</p><p class="empty-sub">اكتب نصاً أو الصق من الحافظة</p></div>`;
  detectedLang.textContent = '';
  $('target-panel-title').textContent = 'الترجمة';
}

function showError(message) {
  targetText.className = 'text-area output-area';
  targetText.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p style="color:#FF6B6B">${escapeHtml(message)}</p><p class="empty-sub">تحقق من الإنترنت أو الإعدادات</p></div>`;
  showToast('❌ ' + message, 'error');
}

function escapeHtml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── Engine Select ────────────────────────────────────────────
engineSelect.value = state.engine;
engineSelect.addEventListener('change', () => {
  state.engine = engineSelect.value;
  localStorage.setItem('qt_engine', state.engine);
  engineName.textContent = ENGINE_LABELS[state.engine];
  // Open settings if key-required engine selected
  if (['deepl', 'microsoft', 'yandex'].includes(state.engine) && !state.apiKeys[state.engine]) {
    showSettingsPanel();
  }
});

// ─── Settings Panel ───────────────────────────────────────────
// ✅ Fix: API keys stored encrypted via btoa (basic obfuscation) to avoid
//         plain-text exposure in localStorage. For production use the
//         Electron safeStorage API instead.
function encodeKey(v) { try { return v ? btoa(unescape(encodeURIComponent(v))) : ''; } catch { return ''; } }
function decodeKey(v) { try { return v ? decodeURIComponent(escape(atob(v))) : ''; } catch { return ''; } }

function loadApiKeys() {
  try {
    const raw = JSON.parse(localStorage.getItem('qt_api_keys') || '{}');
    return {
      deepl: decodeKey(raw.deepl || ''),
      microsoft: decodeKey(raw.microsoft || ''),
      yandex: decodeKey(raw.yandex || ''),
    };
  } catch { return {}; }
}

function saveApiKeys(keys) {
  const encoded = {
    deepl: encodeKey(keys.deepl || ''),
    microsoft: encodeKey(keys.microsoft || ''),
    yandex: encodeKey(keys.yandex || ''),
  };
  localStorage.setItem('qt_api_keys', JSON.stringify(encoded));
}

function showSettingsPanel() {
  const panel = $('settings-panel');
  panel.style.display = 'flex';
  $('key-deepl').value = state.apiKeys.deepl || '';
  $('key-microsoft').value = state.apiKeys.microsoft || '';
  $('key-yandex').value = state.apiKeys.yandex || '';
}

$('btn-save-keys').addEventListener('click', () => {
  state.apiKeys.deepl = $('key-deepl').value.trim();
  state.apiKeys.microsoft = $('key-microsoft').value.trim();
  state.apiKeys.yandex = $('key-yandex').value.trim();
  // ✅ Fix: save keys encoded, not plain-text
  saveApiKeys(state.apiKeys);
  $('settings-panel').style.display = 'none';
  showToast('✅ تم حفظ المفاتيح', 'success');
});
$('btn-close-settings').addEventListener('click', () => { $('settings-panel').style.display = 'none'; });

// ─── Language Pills ───────────────────────────────────────────
function setupLangPills(containerId, type) {
  document.getElementById(containerId).querySelectorAll('.lang-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.getElementById(containerId).querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const lang = pill.dataset.lang;
      if (type === 'source') { state.sourceLang = lang; sourceText.style.direction = LANGS[lang]?.dir || 'rtl'; }
      else state.targetLang = lang;
    });
  });
}
setupLangPills('source-langs', 'source');
setupLangPills('target-langs', 'target');

// ─── Swap Languages ───────────────────────────────────────────
$('btn-swap').addEventListener('click', () => {
  if (state.sourceLang === 'auto') { showToast('⚠️ اختر لغة محددة للمصدر', 'error'); return; }
  const outputEl = targetText.querySelector('.output-text');
  const translated = outputEl ? outputEl.innerText : '';
  [state.sourceLang, state.targetLang] = [state.targetLang, state.sourceLang];
  document.querySelectorAll('#source-langs .lang-pill').forEach(p => p.classList.toggle('active', p.dataset.lang === state.sourceLang));
  document.querySelectorAll('#target-langs .lang-pill').forEach(p => p.classList.toggle('active', p.dataset.lang === state.targetLang));
  sourceText.value = translated;
  updateCharCount();
  if (translated) doTranslate();
});

// ─── Source Text Events ───────────────────────────────────────
sourceText.addEventListener('input', () => {
  updateCharCount();
  const text = sourceText.value.trim();
  state.currentText = text;
  clearTimeout(state.debounceTimer);
  if (text) state.debounceTimer = setTimeout(() => { if (state.currentText === text) doTranslate(); }, 1200);
  else showEmptyState();
});

function updateCharCount() {
  const len = sourceText.value.length;
  charCount.textContent = `${len} / 5000`;
  charCount.style.color = len > 4500 ? '#FF6B6B' : len > 4000 ? '#FFD166' : '';
}

$('btn-translate').addEventListener('click', () => { clearTimeout(state.debounceTimer); doTranslate(); });
sourceText.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); clearTimeout(state.debounceTimer); doTranslate(); } });
$('btn-clear').addEventListener('click', () => { sourceText.value = ''; updateCharCount(); showEmptyState(); sourceText.focus(); });

$('btn-paste').addEventListener('click', async () => {
  try { const t = await navigator.clipboard.readText(); if (t) { sourceText.value = t; updateCharCount(); doTranslate(); } }
  catch { showToast('⚠️ تعذر الوصول للحافظة', 'error'); }
});

$('btn-copy').addEventListener('click', () => {
  const el = targetText.querySelector('.output-text');
  if (!el) return;
  window.electronAPI.copyText(el.innerText);
  showToast('✅ تم النسخ!', 'success');
  const btn = $('btn-copy');
  // ✅ Fix: clear previous timer to avoid double-reset
  clearTimeout(btn._copyTimer);
  btn.textContent = '✅';
  btn._copyTimer = setTimeout(() => { btn.textContent = '📋'; }, 2000);
});

// ─── TTS ──────────────────────────────────────────────────────
function speak(text, lang) {
  if (!text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = { ar: 'ar-SA', zh: 'zh-CN', fr: 'fr-FR', es: 'es-ES', en: 'en-US' }[lang] || 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
  showToast('🔊 جاري القراءة...', 'success');
}
$('btn-speak-source').addEventListener('click', () => speak(sourceText.value, state.sourceLang === 'auto' ? detectLangHeuristic(sourceText.value) : state.sourceLang));
$('btn-speak-target').addEventListener('click', () => { const el = targetText.querySelector('.output-text'); if (el) speak(el.innerText, state.targetLang); });

// ─── OCR Button ───────────────────────────────────────────────
$('btn-ocr').addEventListener('click', () => {
  showToast('🔍 جاري فتح أداة التحديد...', '');
  // Small delay so toast shows before overlay
  setTimeout(() => {
    // Send message to main process to trigger the OCR window
    window.electronAPI.openOcrWindow();
  }, 100);
});

// ─── IPC: OCR Image Data (from main process after region selection) ──
window.electronAPI.onOcrImageData(async (dataUrl) => {
  // Show OCR processing state
  targetText.className = 'text-area output-area';
  targetText.innerHTML = `<div class="ocr-processing"><div class="spinner-ring"></div><span>🔍 جاري قراءة النص من الصورة...</span></div>`;
  engineName.textContent = 'Tesseract OCR';

  try {
    // Tesseract.js is loaded via script tag from node_modules
    const result = await Tesseract.recognize(dataUrl, 'ara+eng+chi_sim+fra+spa', {
      logger: (m) => { if (m.status === 'recognizing text') engineName.textContent = `OCR: ${Math.round(m.progress * 100)}%`; }
    });
    const text = result.data.text.trim();
    if (!text) { showToast('⚠️ لم يُعثر على نص', 'error'); showEmptyState(); return; }

    sourceText.value = text;
    updateCharCount();
    showToast('✅ تم استخراج النص! جاري الترجمة...', 'success');
    await doTranslate();
  } catch (e) {
    showError('فشل OCR: ' + e.message);
  }
});

// ─── IPC: Translate Clipboard ─────────────────────────────────
window.electronAPI.onTranslateClipboard((text) => {
  sourceText.value = text; updateCharCount(); doTranslate();
});

// ─── History ──────────────────────────────────────────────────
function addToHistory(src, tgt, sl, tl) {
  state.history.unshift({ source: src.slice(0, 100), target: tgt.slice(0, 100), srcLang: sl, tgtLang: tl, engine: state.engine, time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) });
  if (state.history.length > 50) state.history.pop();
  localStorage.setItem('qt_history', JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  historyCount.textContent = state.history.length;
  if (!state.history.length) { historyList.innerHTML = '<div class="history-empty"><span>🕐</span><p>لا يوجد سجل بعد</p></div>'; return; }
  historyList.innerHTML = state.history.map((item, i) => `
    <div class="history-item" data-index="${i}">
      <span class="history-source">${LANGS[item.srcLang]?.flag || ''} ${escapeHtml(item.source)}</span>
      <span class="history-arrow">→</span>
      <span class="history-target">${LANGS[item.tgtLang]?.flag || ''} ${escapeHtml(item.target)}</span>
      <span class="history-meta">${item.time}</span>
    </div>`).join('');
  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = state.history[parseInt(el.dataset.index)];
      sourceText.value = item.source; updateCharCount();
      showTranslation(item.target, item.srcLang, item.tgtLang);
      historyPanel.classList.remove('open');
    });
  });
}

$('btn-history-toggle').addEventListener('click', () => historyPanel.classList.toggle('open'));
$('btn-close-history').addEventListener('click', () => historyPanel.classList.remove('open'));
$('btn-clear-history').addEventListener('click', () => { state.history = []; localStorage.removeItem('qt_history'); renderHistory(); showToast('🗑️ تم مسح السجل', 'success'); });

// ─── Init ─────────────────────────────────────────────────────
// ✅ Fix: load API keys using decode helper (not raw localStorage)
state.apiKeys = loadApiKeys();
renderHistory();
sourceText.focus();
engineName.textContent = ENGINE_LABELS[state.engine] || state.engine;

// ═══════════════════════════════════════════════════════════════
// HOTKEYS SETTINGS MANAGER
// ═══════════════════════════════════════════════════════════════
const HOTKEY_KEYS = ['popup', 'mainWindow', 'toggleWindow', 'ocr'];
let pendingHotkeys = {}; // unsaved edits
let activeRecorder = null;

// ── Format hotkey string to visual badges ─────────────────────
function formatHotkeyDisplay(combo) {
  if (!combo) return '';
  // Normalize: CommandOrControl → Ctrl, Control → Ctrl
  const parts = combo
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd')
    .split('+');
  return parts.map(k => `<span class="hk-key">${k}</span>`).join('<span class="hk-key-sep">+</span>');
}

// ── Render a recorder element with current value ──────────────
function renderRecorder(key, combo) {
  const display = document.getElementById(`disp-${key}`);
  const rec = document.getElementById(`rec-${key}`);
  if (!display || !rec) return;
  display.innerHTML = formatHotkeyDisplay(combo);
  rec.classList.toggle('has-value', !!combo);
}

// ── Load & display current hotkeys ───────────────────────────
async function loadAndDisplayHotkeys() {
  const hotkeys = await window.electronAPI.getHotkeys();
  pendingHotkeys = { ...hotkeys };
  HOTKEY_KEYS.forEach(k => renderRecorder(k, hotkeys[k]));
}

// ── Build combo from current event state ──────────────────────
function buildComboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'Command', 'Dead', 'Process', 'Unidentified', 'CapsLock', 'NumLock', 'ScrollLock'];
  const isModifierOnly = MODIFIER_KEYS.includes(e.key);

  if (!isModifierOnly) {
    // Use e.code for physical key (language-independent)
    let key = '';
    if (e.code.startsWith('Key')) key = e.code.replace('Key', '');
    else if (e.code.startsWith('Digit')) key = e.code.replace('Digit', '');
    else if (e.code.startsWith('F') && /^F\d+$/.test(e.code)) key = e.code; // F1-F12
    else {
      const SPECIAL = {
        ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down',
        ArrowLeft: 'Left', ArrowRight: 'Right',
        Escape: 'Escape', Delete: 'Delete', Backspace: 'Backspace',
        Tab: 'Tab', Enter: 'Return', Home: 'Home', End: 'End',
        PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
      };
      key = SPECIAL[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    if (key && (/^[A-Z0-9]$/.test(key) || key.length > 1)) {
      parts.push(key);
    }
  }

  return { combo: parts.length ? parts.join('+') : null, isModifierOnly };
}

// ── Start recording a hotkey ──────────────────────────────────
function startRecording(recEl, key) {
  if (activeRecorder) stopRecording(activeRecorder, false);

  activeRecorder = recEl;
  recEl.classList.add('recording', 'has-value');
  const display = document.getElementById(`disp-${key}`);
  display.innerHTML = `<span class="hk-recording-text">⏺ اضغط المفاتيح...</span>`;

  // ── Pause all global shortcuts so they don't intercept our keys
  window.electronAPI.pauseHotkeys();

  let lastModifierCombo = null;
  let committed = false;

  // ── Guard: ignore any keydown that fires within 200ms of opening
  //    This prevents the click that opened the recorder (e.g. Ctrl+S in VS Code,
  //    or any key held during the click) from being immediately recorded.
  const openedAt = Date.now();
  const GUARD_MS = 200;

  function finalize(combo) {
    if (committed) return;
    committed = true;
    pendingHotkeys[key] = combo;
    renderRecorder(key, combo);
    stopRecording(recEl, true);
  }

  function onKeydown(e) {
    // Always block browser defaults (Ctrl+S, Ctrl+R, etc.) while recording
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // ── Guard: swallow keys pressed during the opening click
    if (Date.now() - openedAt < GUARD_MS) return;

    // ── Escape cancels recording without saving
    if (e.key === 'Escape') {
      stopRecording(recEl, false);
      return;
    }

    const { combo, isModifierOnly } = buildComboFromEvent(e);
    if (!combo) return;

    // Show live preview
    display.innerHTML = formatHotkeyDisplay(combo);

    if (isModifierOnly) {
      lastModifierCombo = combo;
    } else {
      // Full combo (modifier + key) → finalize immediately
      finalize(combo);
    }
  }

  function onKeyup(e) {
    // Guard period: ignore keyup too
    if (Date.now() - openedAt < GUARD_MS) return;

    const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'Command'];
    if (!MODIFIER_KEYS.includes(e.key)) return;

    // All modifiers released without a non-modifier key → save modifier-only combo
    const stillHeld = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
    if (!stillHeld && lastModifierCombo && !committed) {
      finalize(lastModifierCombo);
    }
  }

  function onClickOutside(e) {
    if (!recEl.contains(e.target)) stopRecording(recEl, false);
  }

  recEl._onKeydown = onKeydown;
  recEl._onKeyup = onKeyup;
  recEl._onClickOutside = onClickOutside;

  // Use capture:true so we intercept before any other handler
  document.addEventListener('keydown', onKeydown, { capture: true });
  document.addEventListener('keyup', onKeyup, { capture: true });
  document.addEventListener('mousedown', onClickOutside, { capture: false });
}

function stopRecording(recEl, committed) {
  if (!recEl) return;
  recEl.classList.remove('recording');
  if (recEl._onKeydown) document.removeEventListener('keydown', recEl._onKeydown, { capture: true });
  if (recEl._onKeyup) document.removeEventListener('keyup', recEl._onKeyup, { capture: true });
  if (recEl._onClickOutside) document.removeEventListener('mousedown', recEl._onClickOutside, { capture: false });
  delete recEl._onKeydown; delete recEl._onKeyup; delete recEl._onClickOutside;
  activeRecorder = null;

  // Resume global shortcuts
  window.electronAPI.resumeHotkeys();

  if (!committed) {
    const key = recEl.dataset.key;
    renderRecorder(key, pendingHotkeys[key]);
  }
}

// ── Open / Close Modal ────────────────────────────────────────
function openHotkeysModal() {
  loadAndDisplayHotkeys();
  $('hotkeys-modal').style.display = 'flex';
}
function closeHotkeysModal() {
  if (activeRecorder) stopRecording(activeRecorder, false);
  $('hotkeys-modal').style.display = 'none';
}

// ── Attach click listeners to each recorder ───────────────────
HOTKEY_KEYS.forEach(key => {
  const rec = document.getElementById(`rec-${key}`);
  if (!rec) return;
  // ✅ Use mouseup instead of click to avoid capturing the opening keypress
  rec.addEventListener('mouseup', (e) => {
    // Only respond to left mouse button
    if (e.button !== 0) return;
    if (rec.classList.contains('recording')) {
      stopRecording(rec, false);
    } else {
      // Small delay so any keydown from the click gesture is fully flushed
      setTimeout(() => startRecording(rec, key), 50);
    }
  });
});

// ── Validate combo (must have a non-modifier key) ─────────────
function isValidHotkey(combo) {
  if (!combo) return false;
  const MODIFIERS = ['CommandOrControl', 'Ctrl', 'Alt', 'Shift', 'Command', 'Control', 'Meta'];
  const parts = combo.split('+');
  return parts.some(p => !MODIFIERS.includes(p));
}

// ── Buttons ───────────────────────────────────────────────────
$('btn-open-hotkeys').addEventListener('click', openHotkeysModal);
$('btn-close-hotkeys').addEventListener('click', closeHotkeysModal);
$('btn-cancel-hotkeys').addEventListener('click', closeHotkeysModal);

$('btn-save-hotkeys').addEventListener('click', () => {
  // Validate: reject modifier-only combos
  const invalid = HOTKEY_KEYS.filter(k => pendingHotkeys[k] && !isValidHotkey(pendingHotkeys[k]));
  if (invalid.length) {
    invalid.forEach(k => {
      const rec = document.getElementById(`rec-${k}`);
      if (rec) { rec.style.borderColor = '#FF6B6B'; setTimeout(() => rec.style.borderColor = '', 2000); }
    });
    showToast('⚠️ الاختصار يجب أن يحتوي على مفتاح أساسي (مثل Ctrl+Z)', 'error');
    return;
  }
  window.electronAPI.updateHotkeys(pendingHotkeys);
  // Toast shown after confirmation from main process
});

$('btn-reset-hotkeys').addEventListener('click', () => {
  window.electronAPI.resetHotkeys();
  showToast('🔄 تمت استعادة الاختصارات الافتراضية', 'success');
  closeHotkeysModal();
});

// ── Receive updated hotkeys from main (after reset/update) ────
window.electronAPI.onHotkeysUpdated((hk, results) => {
  pendingHotkeys = { ...hk };
  HOTKEY_KEYS.forEach(k => renderRecorder(k, hk[k]));

  // Show result feedback
  if (results) {
    const failed = HOTKEY_KEYS.filter(k => results[k] === false && hk[k]);
    const ok = HOTKEY_KEYS.filter(k => results[k] === true);
    if (failed.length) {
      // Highlight failed rows in red
      failed.forEach(k => {
        const rec = document.getElementById(`rec-${k}`);
        if (rec) { rec.style.borderColor = '#FF6B6B'; setTimeout(() => rec.style.borderColor = '', 3000); }
      });
      showToast(`❌ فشل تسجيل ${failed.length} اختصار — قد يكون محجوزاً من النظام`, 'error');
    } else if (ok.length) {
      showToast('✅ تم حفظ الاختصارات وتفعيلها!', 'success');
      closeHotkeysModal();
    }
  } else {
    showToast('✅ تمت الاستعادة!', 'success');
    closeHotkeysModal();
  }

  // ✅ Fix: update both hotkey badges in the title bar
  const badges = document.querySelectorAll('.hotkey-badge');
  if (badges[0]) badges[0].textContent = hk.mainWindow || 'Ctrl+Alt+Q';
  if (badges[1]) badges[1].textContent = hk.toggleWindow || 'Ctrl+Alt+T';
});

// ── Backdrop click closes modal ───────────────────────────────
$('hotkeys-modal').addEventListener('click', (e) => {
  if (e.target === $('hotkeys-modal')) closeHotkeysModal();
});

// ── Open from tray/IPC signal ─────────────────────────────────
window.electronAPI.onOpenHotkeysSettings(() => openHotkeysModal());

