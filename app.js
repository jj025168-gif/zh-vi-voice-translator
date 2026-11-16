"use strict";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synthesis = window.speechSynthesis || null;
const STORAGE = {
  messages: "zhvi-conversation-v1",
  phrases: "zhvi-phrases-v1",
  settings: "zhvi-settings-v1",
};
const MAX_MESSAGES = 200;
const MAX_QUERY_BYTES = 500;
const LANG = { a: "zh-TW", b: "vi-VN" };
const PHRASES = [
  ["你好。", "Xin chào."],
  ["你吃飽了嗎？", "Bạn ăn no chưa?"],
  ["謝謝你。", "Cảm ơn bạn."],
  ["不客氣。", "Không có gì."],
  ["請等一下。", "Xin chờ một chút."],
  ["我聽不懂，請再說一次。", "Tôi không hiểu, xin hãy nói lại một lần nữa."],
  ["請說慢一點。", "Xin hãy nói chậm hơn một chút."],
  ["你需要幫忙嗎？", "Bạn có cần giúp đỡ không?"],
  ["我們現在出發。", "Bây giờ chúng ta đi nhé."],
  ["再見。", "Tạm biệt."],
];

const ui = {
  a: {
    conversation: document.getElementById("conversation-a"),
    status: document.getElementById("status-a"),
    interim: document.getElementById("interim-a"),
    mic: document.getElementById("mic-a"),
    keyboard: document.getElementById("keyboard-a"),
    composer: document.getElementById("composer-a"),
    text: document.getElementById("text-a"),
    warning: document.getElementById("recognition-warning-a"),
  },
  b: {
    conversation: document.getElementById("conversation-b"),
    status: document.getElementById("status-b"),
    interim: document.getElementById("interim-b"),
    mic: document.getElementById("mic-b"),
    keyboard: document.getElementById("keyboard-b"),
    composer: document.getElementById("composer-b"),
    text: document.getElementById("text-b"),
    warning: document.getElementById("recognition-warning-b"),
  },
  phrasesDialog: document.getElementById("phrases-dialog"),
  historyDialog: document.getElementById("history-dialog"),
  settingsDialog: document.getElementById("settings-dialog"),
  phraseDirection: document.getElementById("phrase-direction"),
  phraseList: document.getElementById("phrases-list"),
  historyList: document.getElementById("history-list"),
  voiceWarning: document.getElementById("voice-warning"),
  voiceZh: document.getElementById("voice-zh"),
  voiceVi: document.getElementById("voice-vi"),
  previewZh: document.getElementById("preview-zh"),
  previewVi: document.getElementById("preview-vi"),
  email: document.getElementById("email"),
  rateZh: document.getElementById("rate-zh"),
  rateVi: document.getElementById("rate-vi"),
  fontSize: document.getElementById("font-size"),
  autoSpeak: document.getElementById("auto-speak"),
  apiKey: document.getElementById("api-key"),
  model: document.getElementById("model"),
  relationship: document.getElementById("relationship"),
  toneNote: document.getElementById("tone-note"),
  layout: document.getElementById("layout"),
  testEngine: document.getElementById("test-engine"),
  engineStatus: document.getElementById("engine-status"),
};

const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const RELATIONSHIPS = {
  couple: "情侶或夫妻（男方稱 anh，女方稱 em，語氣親暱自然）",
  friends: "朋友（依年齡用 anh/em 或 bạn/mình，輕鬆自然）",
  colleagues: "同事（客氣但不生硬，依年齡用 anh/chị/em）",
  family: "家人（依輩分選擇正確的家庭稱謂）",
  new: "剛認識（禮貌、保持距離，可用 anh/chị 與 em 或 tôi/bạn）",
};
const LAYOUTS = ["face", "side"];

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Private browsing and storage quotas can prevent saving; the page stays usable.
  }
}

const savedMessages = readStored(STORAGE.messages, []);
let messages = Array.isArray(savedMessages)
  ? savedMessages.filter((item) => item && (item.source === "a" || item.source === "b") && typeof item.original === "string")
    .slice(-MAX_MESSAGES)
    .map((item) => item.status === "translating" ? { ...item, status: "failed", errorCode: "translate" } : item)
  : [];
const savedPhrases = readStored(STORAGE.phrases, null);
let phrases = Array.isArray(savedPhrases)
  ? savedPhrases.filter((item) => item && typeof item.zh === "string" && typeof item.vi === "string")
  : PHRASES.map(([zh, vi]) => ({ id: makeId(), zh, vi }));
const storedSettingsValue = readStored(STORAGE.settings, {});
const storedSettings = storedSettingsValue && typeof storedSettingsValue === "object" ? storedSettingsValue : {};
let settings = {
  fontSize: boundedNumber(storedSettings.fontSize, 22, 36, 24),
  rateZh: boundedNumber(storedSettings.rateZh, 0.5, 1.5, 0.9),
  rateVi: boundedNumber(storedSettings.rateVi, 0.5, 1.5, 0.9),
  voiceZh: typeof storedSettings.voiceZh === "string" ? storedSettings.voiceZh : "",
  voiceVi: typeof storedSettings.voiceVi === "string" ? storedSettings.voiceVi : "",
  autoSpeak: storedSettings.autoSpeak !== false,
  email: typeof storedSettings.email === "string" ? storedSettings.email : "",
  apiKey: typeof storedSettings.apiKey === "string" ? storedSettings.apiKey.trim() : "",
  model: CLAUDE_MODELS.includes(storedSettings.model) ? storedSettings.model : CLAUDE_MODELS[0],
  relationship: Object.prototype.hasOwnProperty.call(RELATIONSHIPS, storedSettings.relationship) ? storedSettings.relationship : "couple",
  toneNote: typeof storedSettings.toneNote === "string" ? storedSettings.toneNote.slice(0, 200) : "",
  layout: LAYOUTS.includes(storedSettings.layout) ? storedSettings.layout : "face",
};

let state = "idle";
let activeSide = null;
let recognition = null;
let recognitionToken = 0;
let watchdog = null;
let errorResetTimer = null;
let voiceCache = [];
let voiceWarningBase = "";
let speechToken = 0;
let speechWatchdog = null;
let previewStartTimer = null;
let recognitionStopping = false;
const notices = { a: "", b: "" };
const interimText = { a: "", b: "" };

function makeId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function saveMessages() {
  messages = messages.slice(-MAX_MESSAGES);
  writeStored(STORAGE.messages, messages);
}

function savePhrases() {
  writeStored(STORAGE.phrases, phrases);
}

function saveSettings() {
  writeStored(STORAGE.settings, settings);
}

function words(side, key) {
  const copy = {
    a: {
      idle: "點一下說中文",
      listening: "聆聽中…再點一次結束",
      translating: "翻譯中…",
      speaking: "正在播放…",
      error: "發生錯誤，請再試一次。",
      pending: "等待翻譯…",
      replay: "再念一次",
      save: "加入常用句",
      saved: "已加入常用句",
      retry: "重試",
      microphoneBusy: "語音還在播放，請再試一次。",
      noSpeech: "沒有聽到聲音，請再試一次。",
      permission: "請到設定開啟麥克風權限與 Siri／聽寫。",
      network: "網路有問題，請檢查連線後重試。",
      recognition: "語音辨識發生錯誤，請再試一次。",
      timeout: "翻譯逾時，請重試。",
      quota: "今天的免費翻譯額度用完了。",
      translate: "翻譯失敗，請重試。",
      speech: "無法播放語音。請關閉 iPhone 靜音開關、調高音量，再按播放鍵重試。",
      unsupported: "此瀏覽器不支援語音辨識，請使用鍵盤輸入。",
      empty: "請先輸入文字。",
      added: "已加入常用句。",
      duplicate: "這句已在常用句中。",
      copy: "複製",
      copied: "已複製中文與越南文，可貼到 LINE。",
      copyFailed: "無法複製，請長按文字自行選取。",
      apiKey: "Claude API 金鑰無效或已失效，請到設定檢查。",
      rateLimit: "AI 翻譯請求太頻繁或額度不足，請稍後再試。",
      refused: "AI 拒絕翻譯這句，請換個說法。",
    },
    b: {
      idle: "Nhấn để nói tiếng Việt",
      listening: "Đang nghe…nhấn lần nữa để dừng",
      translating: "Đang dịch…",
      speaking: "Đang phát âm thanh…",
      error: "Đã xảy ra lỗi. Vui lòng thử lại.",
      pending: "Đang chờ bản dịch…",
      replay: "Đọc lại",
      save: "Thêm vào câu thường dùng",
      saved: "Đã thêm vào câu thường dùng",
      retry: "Thử lại",
      microphoneBusy: "Âm thanh vẫn đang phát. Vui lòng thử lại.",
      noSpeech: "Không nghe thấy giọng nói. Vui lòng thử lại.",
      permission: "Hãy bật quyền dùng micrô và Siri/Đọc chính tả trong Cài đặt.",
      network: "Có lỗi mạng. Hãy kiểm tra kết nối rồi thử lại.",
      recognition: "Nhận dạng giọng nói bị lỗi. Vui lòng thử lại.",
      timeout: "Dịch quá thời gian. Vui lòng thử lại.",
      quota: "Đã hết hạn mức dịch miễn phí hôm nay.",
      translate: "Dịch thất bại. Vui lòng thử lại.",
      speech: "Không thể phát âm thanh. Hãy tắt chế độ im lặng của iPhone, tăng âm lượng rồi bấm nút phát để thử lại.",
      unsupported: "Trình duyệt này không hỗ trợ nhận dạng giọng nói. Hãy dùng bàn phím.",
      empty: "Hãy nhập nội dung trước.",
      added: "Đã thêm vào câu thường dùng.",
      duplicate: "Câu này đã có trong danh sách thường dùng.",
      copy: "Sao chép",
      copied: "Đã sao chép tiếng Trung và tiếng Việt, có thể dán vào LINE.",
      copyFailed: "Không thể sao chép. Hãy nhấn giữ văn bản để tự chọn.",
      apiKey: "Khóa API Claude không hợp lệ hoặc đã hết hạn. Hãy kiểm tra trong Cài đặt.",
      rateLimit: "Yêu cầu dịch AI quá nhiều hoặc hết hạn mức. Hãy thử lại sau.",
      refused: "AI từ chối dịch câu này. Hãy nói cách khác.",
    },
  };
  return copy[side][key] || copy[side].error;
}

function setState(next, side = null) {
  state = next;
  activeSide = side;
  for (const name of ["a", "b"]) {
    document.getElementById(`side-${name}`).dataset.state = name === side ? next : "idle";
  }
  renderStatus();
}

function renderStatus() {
  for (const side of ["a", "b"]) {
    const panel = ui[side];
    const ownActivity = activeSide === side;
    panel.status.textContent = ownActivity && state !== "idle"
      ? (state === "error" ? notices[side] : words(side, state))
      : notices[side] || words(side, "idle");
    panel.interim.textContent = interimText[side];
    panel.interim.hidden = !interimText[side];
    panel.mic.disabled = !Recognition || (state !== "idle" && !(state === "listening" && ownActivity && !recognitionStopping));
    panel.keyboard.disabled = state !== "idle";
    panel.mic.classList.toggle("is-listening", ownActivity && state === "listening");
    panel.mic.setAttribute("aria-pressed", ownActivity && state === "listening" ? "true" : "false");
    panel.mic.textContent = ownActivity && state === "listening" ? words(side, "listening") : words(side, "idle");
    panel.mic.setAttribute("aria-label", panel.mic.textContent);
  }
}

function showError(side, key) {
  clearTimeout(errorResetTimer);
  notices[side] = words(side, key);
  setState("error", side);
  errorResetTimer = setTimeout(() => {
    if (state === "error" && activeSide === side) setState("idle");
  }, 250);
}

function clearNotice(side) {
  notices[side] = "";
  renderStatus();
}

function renderConversations() {
  const savedKeys = new Set(phrases.map((phrase) => `${phrase.zh}\u0000${phrase.vi}`));
  for (const side of ["a", "b"]) {
    const container = ui[side].conversation;
    const fragment = document.createDocumentFragment();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "empty-conversation";
      empty.textContent = side === "a" ? "對話會顯示在這裡。" : "Cuộc trò chuyện sẽ hiện ở đây.";
      fragment.append(empty);
    }
    messages.forEach((message, index) => {
      const card = document.createElement("article");
      card.className = `message from-${message.source}${index === messages.length - 1 ? " is-latest" : ""}`;
      const content = document.createElement("p");
      content.className = "message-text";
      content.textContent = message[side === "a" ? "zh" : "vi"] || words(side, "pending");
      card.append(content);

      if (message.status === "failed") {
        const error = document.createElement("p");
        error.className = "message-error";
        error.textContent = words(side, message.errorCode || "translate");
        card.append(error);
      }

      const actions = document.createElement("div");
      actions.className = "message-actions";
      const spokenText = side === "a" ? message.zh : message.vi;
      if (spokenText) actions.append(actionButton(words(side, "replay"), "replay", message.id, side));
      if (message.zh && message.vi) {
        const saved = savedKeys.has(`${message.zh}\u0000${message.vi}`);
        const button = actionButton(words(side, saved ? "saved" : "save"), "save", message.id, side);
        button.disabled = saved;
        actions.append(button);
      }
      if (message.status === "failed") actions.append(actionButton(words(side, "retry"), "retry", message.id, side));
      if (message.zh || message.vi) actions.append(actionButton(words(side, "copy"), "copy", message.id, side));
      card.append(actions);
      fragment.append(card);
    });
    container.replaceChildren(fragment);
    container.scrollTop = container.scrollHeight;
  }
  if (ui.historyDialog.open) renderHistory();
}

// Copies both languages so the text can be pasted into LINE as one message.
// Clipboard writes must stay inside the click handler on iOS, so no awaits
// before navigator.clipboard.writeText; execCommand is the fallback for
// browsers without the async API or over plain HTTP.
function copyMessage(message, side) {
  const text = [message.zh, message.vi].filter(Boolean).join("\n");
  const done = (ok) => {
    notices[side] = words(side, ok ? "copied" : "copyFailed");
    renderStatus();
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(legacyCopy(text)));
    return;
  }
  done(legacyCopy(text));
}

function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_error) { ok = false; }
  area.remove();
  return ok;
}

function actionButton(label, action, id, side) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-action";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  button.dataset.side = side;
  return button;
}

function renderVoiceWarning(extra = "") {
  ui.voiceWarning.textContent = [voiceWarningBase, extra].filter(Boolean).join(" ");
}

function availableVoices(language) {
  if (language === "zh-TW") {
    const chinese = voiceCache.filter((voice) => voice.lang && /^zh/i.test(voice.lang));
    const traditional = chinese.filter((voice) => /^zh[-_](?:tw|hant)(?:[-_]|$)/i.test(voice.lang));
    return traditional.length ? traditional : chinese;
  }
  return voiceCache.filter((voice) => voice.lang && /^vi/i.test(voice.lang));
}

function populateVoiceSelect(select, voices, selectedURI) {
  const fragment = document.createDocumentFragment();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "自動 / Tự động";
  fragment.append(automatic);
  for (const voice of voices) {
    if (!voice.voiceURI) continue;
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = voices.some((voice) => voice.voiceURI && voice.voiceURI === selectedURI) ? selectedURI : "";
}

function updateVoices() {
  voiceCache = [];
  if (!synthesis || typeof synthesis.getVoices !== "function") {
    populateVoiceSelect(ui.voiceZh, [], settings.voiceZh);
    populateVoiceSelect(ui.voiceVi, [], settings.voiceVi);
    voiceWarningBase = "此瀏覽器不支援語音播放。 / Trình duyệt không hỗ trợ phát âm thanh.";
    renderVoiceWarning();
    return;
  }
  try { voiceCache = Array.from(synthesis.getVoices() || []).filter(Boolean); } catch (_error) { voiceCache = []; }
  const zhVoices = availableVoices("zh-TW");
  const viVoices = availableVoices("vi-VN");
  populateVoiceSelect(ui.voiceZh, zhVoices, settings.voiceZh);
  populateVoiceSelect(ui.voiceVi, viVoices, settings.voiceVi);
  const warnings = [];
  if (!findVoice("zh-TW")) warnings.push("找不到繁體中文語音；系統會嘗試自行選擇。 / Không tìm thấy giọng Trung phồn thể.");
  if (!findVoice("vi-VN")) warnings.push("找不到越南文語音；系統會嘗試自行選擇。 / Không tìm thấy giọng tiếng Việt.");
  if (zhVoices.length <= 1 || viVoices.length <= 1) {
    warnings.push("可用聲音較少；iPhone 可到「設定 → 輔助使用 → 朗讀內容 → 聲音」下載更多聲音。 / Có ít giọng đọc; trên iPhone, vào Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói để tải thêm giọng.");
  }
  voiceWarningBase = warnings.join(" ");
  renderVoiceWarning();
}

function findVoice(language, voiceURI = language.toLowerCase().startsWith("zh") ? settings.voiceZh : settings.voiceVi) {
  if (voiceURI) {
    const selected = voiceCache.find((voice) => voice.voiceURI === voiceURI);
    if (selected) return selected;
  }
  const normalized = language.toLowerCase();
  const exact = voiceCache.find((voice) => voice.lang && voice.lang.toLowerCase() === normalized);
  if (exact) return exact;
  if (normalized === "zh-tw") {
    return voiceCache.find((voice) => voice.lang && /^zh[-_]hant(?:[-_]|$)/i.test(voice.lang)) || null;
  }
  return voiceCache.find((voice) => voice.lang && /^vi(?:[-_]|$)/i.test(voice.lang)) || null;
}

// iOS Safari only allows speech output after speak() has run inside a user
// gesture. Speak an empty utterance there; it finishes instantly and must not
// be cancelled right away, or iOS may keep the audio session locked.
let speechUnlocked = false;
function unlockSpeech(language) {
  if (speechUnlocked || !synthesis || typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    const silent = new SpeechSynthesisUtterance("");
    silent.lang = language;
    silent.volume = 0;
    synthesis.speak(silent);
    speechUnlocked = true;
    return true;
  } catch (_error) {
    // The explicit playback below will expose a device-level failure.
    return false;
  }
}

// Keep a reference to the utterance being spoken: some engines garbage-collect
// it mid-sentence otherwise, and onend/onerror then never fire.
let currentUtterance = null;

function createSpeechUtterance(text, language, voice) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = language === "zh-TW" ? settings.rateZh : settings.rateVi;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;
  return utterance;
}

function playSpeech(text, language, voice, onEnd, onError, onTimeout = onEnd) {
  clearTimeout(speechWatchdog);
  const token = ++speechToken;
  let settled = false;
  const finish = (callback) => {
    if (token !== speechToken || settled) return;
    settled = true;
    clearTimeout(speechWatchdog);
    currentUtterance = null;
    callback();
  };
  // On iOS, speak() issued immediately after cancel() is often dropped silently.
  // Only cancel when something is actually queued, and then wait a moment.
  let needsCancel;
  let utterance;
  try {
    needsCancel = synthesis.speaking || synthesis.pending;
    if (needsCancel) synthesis.cancel();
    utterance = createSpeechUtterance(text, language, voice);
  } catch (_error) {
    finish(onError);
    return;
  }
  utterance.onend = () => finish(onEnd);
  // Our own cancel() increments the token first, so its error event is ignored.
  utterance.onerror = () => finish(onError);
  const start = () => {
    if (token !== speechToken || settled) return;
    try {
      currentUtterance = utterance;
      // Some iOS versions omit onend; a stalled preview must also report failure.
      speechWatchdog = setTimeout(() => {
        if (token !== speechToken || settled) return;
        finish(onTimeout);
        try { synthesis.cancel(); } catch (_error) { /* Nothing left to stop. */ }
      }, Math.min(120000, Math.max(15000, text.length * 700)));
      synthesis.speak(utterance);
      // iOS/Chrome sometimes leave the queue paused; resume is harmless otherwise.
      if (synthesis.paused) synthesis.resume();
    } catch (_error) {
      finish(onError);
    }
  };
  if (needsCancel) setTimeout(start, 150);
  else start();
}

function speakText(text, language, side) {
  if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") {
    notices[side] = words(side, "speech");
    setState("idle");
    return;
  }
  setState("speaking", side);
  playSpeech(text, language, findVoice(language),
    () => { if (state === "speaking" && activeSide === side) setState("idle"); },
    () => { if (state === "speaking" && activeSide === side) showError(side, "speech"); },
    () => { if (state === "speaking" && activeSide === side) setState("idle"); });
}

function previewVoice(language, select) {
  if (state !== "idle") {
    renderVoiceWarning("請等目前操作結束後再試聽。 / Hãy đợi thao tác hiện tại kết thúc rồi nghe thử.");
    return;
  }
  if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") {
    renderVoiceWarning("無法試聽。 / Không thể nghe thử.");
    return;
  }
  renderVoiceWarning();
  const waitingForUnlock = previewStartTimer !== null;
  const justUnlocked = unlockSpeech(language);
  if (previewStartTimer !== null) clearTimeout(previewStartTimer);
  const start = () => {
    previewStartTimer = null;
    if (state !== "idle") return;
    const sample = language === "zh-TW" ? "你好，很高興認識你。" : "Xin chào, rất vui được gặp bạn.";
    playSpeech(sample, language, findVoice(language, select.value),
      () => {},
      () => renderVoiceWarning("試聽失敗，請檢查音量或換一個聲音。 / Không thể nghe thử; hãy kiểm tra âm lượng hoặc chọn giọng khác."),
      () => renderVoiceWarning("試聽逾時，請再試一次。 / Nghe thử quá lâu; hãy thử lại."));
  };
  // Let the silent utterance finish before canceling the queue on first use.
  if (justUnlocked || waitingForUnlock) previewStartTimer = setTimeout(start, 150);
  else start();
}

function recognitionErrorKey(code) {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") return "permission";
  if (code === "no-speech") return "noSpeech";
  if (code === "network") return "network";
  return "recognition";
}

function startListening(side) {
  if (!Recognition || state !== "idle") return;
  clearNotice(side);
  const token = ++recognitionToken;
  recognitionStopping = false;
  if (synthesis) {
    speechToken++;
    clearTimeout(speechWatchdog);
    synthesis.cancel();
    if (synthesis.speaking || synthesis.pending) {
      showError(side, "microphoneBusy");
      return;
    }
    unlockSpeech(side === "a" ? "vi-VN" : "zh-TW");
  }

  let current;
  try {
    current = new Recognition();
  } catch (_error) {
    showError(side, "recognition");
    return;
  }
  recognition = current;
  current.lang = LANG[side];
  current.interimResults = true;
  current.continuous = false;
  current.maxAlternatives = 1;
  let finalText = "";
  let receivedResult = false;
  let failed = false;

  current.onresult = (event) => {
    if (token !== recognitionToken) return;
    receivedResult = true;
    clearTimeout(watchdog);
    let final = "";
    let interim = "";
    for (let index = 0; index < event.results.length; index++) {
      const result = event.results[index];
      if (!result[0]) continue;
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    finalText = final.trim();
    interimText[side] = interim.trim() || finalText;
    renderStatus();
  };

  current.onerror = (event) => {
    if (token !== recognitionToken) return;
    failed = true;
    clearTimeout(watchdog);
    interimText[side] = "";
    recognition = null;
    recognitionStopping = false;
    recognitionToken++;
    showError(side, recognitionErrorKey(event.error));
  };

  current.onend = () => {
    if (token !== recognitionToken || failed) return;
    clearTimeout(watchdog);
    recognitionToken++;
    recognition = null;
    recognitionStopping = false;
    interimText[side] = "";
    if (finalText) {
      submitOriginal(side, finalText);
    } else {
      showError(side, "noSpeech");
    }
  };

  setState("listening", side);
  try {
    // iOS requires start() to remain in this synchronous click handler.
    current.start();
  } catch (_error) {
    recognition = null;
    recognitionToken++;
    showError(side, "recognition");
    return;
  }
  watchdog = setTimeout(() => {
    if (token !== recognitionToken || receivedResult) return;
    recognitionToken++;
    recognition = null;
    recognitionStopping = false;
    try { current.abort(); } catch (_error) { /* Already stopped. */ }
    interimText[side] = "";
    showError(side, "noSpeech");
  }, 8000);
}

function stopListening(side) {
  if (state !== "listening" || activeSide !== side || !recognition || recognitionStopping) return;
  recognitionStopping = true;
  renderStatus();
  try {
    recognition.stop();
  } catch (_error) {
    recognitionToken++;
    recognition = null;
    recognitionStopping = false;
    showError(side, "recognition");
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function splitForTranslation(text) {
  if (byteLength(text) <= MAX_QUERY_BYTES) return [text];
  const pieces = [];
  let piece = "";
  for (const character of text) {
    piece += character;
    if (/[。！？!?，,]/u.test(character)) {
      pieces.push(piece);
      piece = "";
    }
  }
  if (piece) pieces.push(piece);
  const chunks = [];
  let chunk = "";
  const flush = () => {
    if (chunk) chunks.push(chunk);
    chunk = "";
  };
  for (const part of pieces) {
    if (byteLength(chunk + part) <= MAX_QUERY_BYTES) {
      chunk += part;
      continue;
    }
    flush();
    if (byteLength(part) <= MAX_QUERY_BYTES) {
      chunk = part;
      continue;
    }
    // A single clause can exceed the API limit; split on code point boundaries.
    for (const character of part) {
      if (byteLength(chunk + character) > MAX_QUERY_BYTES) flush();
      chunk += character;
    }
  }
  flush();
  return chunks;
}

function isQuotaWarning(value) {
  return typeof value === "string" && /mymemory\s+warning|quota|daily\s+(?:free\s+)?limit|used\s+all\s+available\s+free\s+translations|translation\s+limit|too\s+many\s+requests/i.test(value);
}

/** Translation service boundary: Claude when a key is set, MyMemory otherwise. */
async function translate(text, from, to) {
  if (settings.apiKey) return translateWithClaude(text, from, to);
  return translateWithMyMemory(text, from, to);
}

function claudeSystemPrompt() {
  const lines = [
    "你是一位同時精通台灣繁體中文與越南文的口譯員，正在為兩個面對面聊天的人逐句即時翻譯。",
    "A 是男生，說台灣繁體中文。B 是女生，說越南文。",
    `兩人關係：${RELATIONSHIPS[settings.relationship]}。`,
  ];
  if (settings.toneNote.trim()) lines.push(`補充：${settings.toneNote.trim()}`);
  lines.push(
    "規則：",
    "1. 中文→越南文：譯成越南人日常口語，依兩人關係與性別選擇正確的人稱與稱呼；除非關係是剛認識，否則不要用生硬的 tôi／bạn。",
    "2. 越南文→中文：譯成台灣人日常會說的繁體中文口語，一律使用繁體字與台灣用語，不用簡體字。",
    "3. 保留原句的語氣（疑問、撒嬌、開玩笑、生氣、客氣），長度相當，不要加解釋、註解或引號。",
    "4. 原文來自語音辨識，若有明顯錯字或同音誤認，依上下文推測最合理的意思再翻譯。",
    "5. 只輸出譯文本身，不要輸出任何其他文字。",
  );
  return lines.join("\n");
}

function claudeContext(limit) {
  const recent = messages.filter((item) => item.status === "ok" && item.zh && item.vi).slice(-limit);
  if (!recent.length) return "";
  const lines = recent.map((item) => `${item.source === "a" ? "A（中文）" : "B（越南文）"}：${item.original}\n→ ${item.source === "a" ? item.vi : item.zh}`);
  return `先前的對話（供理解上下文與稱呼一致，不必重譯）：\n${lines.join("\n")}\n\n`;
}

async function translateWithClaude(text, from, to) {
  const toVietnamese = to === "vi";
  const instruction = toVietnamese
    ? "請把 A（男生）剛說的這句中文翻成越南文："
    : "請把 B（女生）剛說的這句越南文翻成繁體中文：";
  const body = {
    model: settings.model,
    max_tokens: 1024,
    system: claudeSystemPrompt(),
    messages: [{ role: "user", content: `${claudeContext(6)}${instruction}\n${text}` }],
    output_config: { effort: "low" },
  };
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2026-10-21",
    // The key lives only on this device; this header lets Safari call the API directly.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (settings.model !== "claude-haiku-5-5") {
    // Route rare safety refusals to a fallback model instead of failing the sentence.
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === "AbortError") throw new TranslationFailure("timeout");
    throw new TranslationFailure("network");
  }
  clearTimeout(timer);
  if (response.status === 401 || response.status === 403) throw new TranslationFailure("apiKey");
  if (response.status === 429 || response.status === 402) throw new TranslationFailure("rateLimit");
  if (response.status === 529 || response.status >= 500) throw new TranslationFailure("network");
  if (!response.ok) throw new TranslationFailure("translate");
  let data;
  try { data = await response.json(); } catch (_error) { throw new TranslationFailure("translate"); }
  if (data && data.stop_reason === "refusal") throw new TranslationFailure("refused");
  const translated = Array.isArray(data && data.content)
    ? data.content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("").trim()
    : "";
  if (!translated) throw new TranslationFailure("translate");
  return translated.replace(/^["「『]+|["」』]+$/g, "").trim();
}

async function translateWithMyMemory(text, from, to) {
  const output = [];
  for (const chunk of splitForTranslation(text)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(`${from}|${to}`)}`;
      if (settings.email.trim()) url += `&de=${encodeURIComponent(settings.email.trim())}`;
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 429) throw new TranslationFailure("quota");
      if (!response.ok) throw new TranslationFailure("translate");
      const data = await response.json();
      const translated = data && data.responseData && data.responseData.translatedText;
      if (data && (Number(data.responseStatus) === 429 || data.quotaFinished === true || isQuotaWarning(data.responseDetails) || isQuotaWarning(translated))) {
        throw new TranslationFailure("quota");
      }
      if (!data || Number(data.responseStatus) !== 200 || typeof translated !== "string" || !translated.trim()) {
        throw new TranslationFailure("translate");
      }
      const decoder = document.createElement("textarea");
      decoder.innerHTML = translated.trim();
      output.push(decoder.value);
    } catch (error) {
      if (error instanceof TranslationFailure) throw error;
      if (error && error.name === "AbortError") throw new TranslationFailure("timeout");
      throw new TranslationFailure("network");
    } finally {
      clearTimeout(timer);
    }
  }
  return output.join(" ").trim();
}

class TranslationFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function submitOriginal(side, text) {
  if (state !== "idle" && !(state === "listening" && activeSide === side)) return;
  const clean = text.trim();
  if (!clean) {
    notices[side] = words(side, "empty");
    renderStatus();
    return;
  }
  const message = {
    id: makeId(),
    source: side,
    original: clean,
    zh: side === "a" ? clean : "",
    vi: side === "b" ? clean : "",
    status: "translating",
  };
  messages.push(message);
  saveMessages();
  renderConversations();
  translateMessage(message);
}

async function translateMessage(message) {
  const side = message.source;
  if (state !== "idle" && state !== "listening") return;
  clearNotice(side);
  message.status = "translating";
  delete message.errorCode;
  saveMessages();
  renderConversations();
  setState("translating", side);
  try {
    const translated = await translate(message.original, side === "a" ? "zh-TW" : "vi", side === "a" ? "vi" : "zh-TW");
    if (side === "a") message.vi = translated;
    else message.zh = translated;
    message.status = "ok";
    saveMessages();
    renderConversations();
    if (settings.autoSpeak) speakText(translated, side === "a" ? "vi-VN" : "zh-TW", side);
    else setState("idle");
  } catch (error) {
    message.status = "failed";
    message.errorCode = error instanceof TranslationFailure ? error.code : "translate";
    saveMessages();
    renderConversations();
    showError(side, message.errorCode);
  }
}

function renderPhrases() {
  const fragment = document.createDocumentFragment();
  phrases.forEach((phrase) => {
    const row = document.createElement("div");
    row.className = "phrase-row";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "phrase-use";
    use.dataset.action = "use-phrase";
    use.dataset.id = phrase.id;
    const zh = document.createElement("span");
    zh.lang = "zh-TW";
    zh.textContent = phrase.zh;
    const vi = document.createElement("span");
    vi.lang = "vi-VN";
    vi.textContent = phrase.vi;
    use.append(zh, vi);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-action phrase-delete";
    remove.dataset.action = "delete-phrase";
    remove.dataset.id = phrase.id;
    remove.textContent = "刪除 / Xóa";
    row.append(use, remove);
    fragment.append(row);
  });
  ui.phraseList.replaceChildren(fragment);
}

function renderHistory() {
  const fragment = document.createDocumentFragment();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.textContent = "目前沒有紀錄。 / Chưa có lịch sử trò chuyện.";
    fragment.append(empty);
  }
  messages.forEach((message) => {
    const row = document.createElement("article");
    row.className = `history-row from-${message.source}`;
    const zh = document.createElement("p");
    zh.lang = "zh-TW";
    zh.textContent = message.zh || "（待翻譯）";
    const vi = document.createElement("p");
    vi.lang = "vi-VN";
    vi.textContent = message.vi || "(Đang chờ bản dịch)";
    row.append(zh, vi);
    fragment.append(row);
  });
  ui.historyList.replaceChildren(fragment);
}

function usePhrase(phrase) {
  if (state !== "idle") return;
  const side = ui.phraseDirection.value === "b" ? "b" : "a";
  unlockSpeech(side === "a" ? "vi-VN" : "zh-TW");
  const message = {
    id: makeId(), source: side,
    original: side === "a" ? phrase.zh : phrase.vi,
    zh: phrase.zh, vi: phrase.vi, status: "ok",
  };
  messages.push(message);
  saveMessages();
  renderConversations();
  ui.phrasesDialog.close();
  speakText(side === "a" ? phrase.vi : phrase.zh, side === "a" ? "vi-VN" : "zh-TW", side);
}

function applySettings() {
  document.documentElement.style.setProperty("--conversation-size", `${settings.fontSize}px`);
  document.body.classList.toggle("side-by-side", settings.layout === "side");
  ui.fontSize.value = String(settings.fontSize);
  ui.rateZh.value = String(settings.rateZh);
  ui.rateVi.value = String(settings.rateVi);
  ui.autoSpeak.checked = settings.autoSpeak;
  ui.email.value = settings.email;
  ui.apiKey.value = settings.apiKey;
  ui.model.value = settings.model;
  ui.relationship.value = settings.relationship;
  ui.toneNote.value = settings.toneNote;
  ui.layout.value = settings.layout;
  document.getElementById("font-size-value").textContent = `${settings.fontSize}px`;
  document.getElementById("rate-zh-value").textContent = `${settings.rateZh.toFixed(2).replace(/0$/, "")}×`;
  document.getElementById("rate-vi-value").textContent = `${settings.rateVi.toFixed(2).replace(/0$/, "")}×`;
  renderEngineStatus();
}

function renderEngineStatus(text, isError) {
  if (typeof text === "string") {
    ui.engineStatus.textContent = text;
  } else {
    ui.engineStatus.textContent = settings.apiKey
      ? `目前使用 Claude（${ui.model.options[ui.model.selectedIndex].text.split("（")[0]}）。`
      : "目前使用 MyMemory 免費翻譯。";
  }
  ui.engineStatus.classList.toggle("is-error", Boolean(isError));
}

async function testEngine() {
  if (state !== "idle") return;
  ui.testEngine.disabled = true;
  renderEngineStatus("測試中… / Đang thử…");
  try {
    const sample = await translate("你吃飽了嗎？", "zh-TW", "vi");
    renderEngineStatus(`成功：「你吃飽了嗎？」→「${sample}」`);
  } catch (error) {
    const code = error instanceof TranslationFailure ? error.code : "translate";
    renderEngineStatus(`失敗：${words("a", code)}`, true);
  } finally {
    ui.testEngine.disabled = false;
  }
}

function init() {
  applySettings();
  saveMessages();
  renderConversations();
  renderPhrases();
  renderStatus();
  if (!Recognition) {
    for (const side of ["a", "b"]) {
      ui[side].warning.textContent = words(side, "unsupported");
      ui[side].warning.hidden = false;
    }
  }
  updateVoices();
  if (synthesis && typeof synthesis.addEventListener === "function") synthesis.addEventListener("voiceschanged", updateVoices);
  else if (synthesis) synthesis.onvoiceschanged = updateVoices;

  for (const side of ["a", "b"]) {
    ui[side].mic.addEventListener("click", () => {
      if (state === "listening" && activeSide === side) stopListening(side);
      else startListening(side);
    });
    ui[side].keyboard.addEventListener("click", () => {
      if (state !== "idle") return;
      ui[side].composer.hidden = false;
      ui[side].text.focus();
    });
    ui[side].composer.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state !== "idle") return;
      const value = ui[side].text.value.trim();
      if (!value) {
        notices[side] = words(side, "empty");
        renderStatus();
        return;
      }
      unlockSpeech(side === "a" ? "vi-VN" : "zh-TW");
      ui[side].text.value = "";
      ui[side].composer.hidden = true;
      submitOriginal(side, value);
    });
    const cancel = document.getElementById(`cancel-${side}`);
    cancel.addEventListener("click", () => { ui[side].composer.hidden = true; });
    ui[side].conversation.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || state !== "idle") return;
      const message = messages.find((item) => item.id === button.dataset.id);
      if (!message) return;
      const action = button.dataset.action;
      if (action === "replay") {
        const text = side === "a" ? message.zh : message.vi;
        if (text) speakText(text, LANG[side], side);
      } else if (action === "retry" && message.status === "failed") {
        unlockSpeech(message.source === "a" ? "vi-VN" : "zh-TW");
        translateMessage(message);
      } else if (action === "copy") {
        copyMessage(message, side);
      } else if (action === "save" && message.zh && message.vi) {
        const exists = phrases.some((phrase) => phrase.zh === message.zh && phrase.vi === message.vi);
        notices[side] = words(side, exists ? "duplicate" : "added");
        if (!exists) {
          phrases.push({ id: makeId(), zh: message.zh, vi: message.vi });
          savePhrases();
          renderPhrases();
          renderConversations();
        }
        renderStatus();
      }
    });
  }

  document.getElementById("phrases-open").addEventListener("click", () => { renderPhrases(); ui.phrasesDialog.showModal(); });
  document.getElementById("history-open").addEventListener("click", () => { renderHistory(); ui.historyDialog.showModal(); });
  document.getElementById("settings-open").addEventListener("click", () => { updateVoices(); ui.settingsDialog.showModal(); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  ui.phraseList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const phrase = phrases.find((item) => item.id === button.dataset.id);
    if (!phrase) return;
    if (button.dataset.action === "use-phrase") usePhrase(phrase);
    if (button.dataset.action === "delete-phrase") {
      phrases = phrases.filter((item) => item.id !== phrase.id);
      savePhrases();
      renderPhrases();
      renderConversations();
    }
  });
  document.getElementById("clear-history").addEventListener("click", () => {
    if (!confirm("確定清空所有對話紀錄？ / Xóa toàn bộ lịch sử trò chuyện?")) return;
    messages = [];
    saveMessages();
    renderConversations();
    renderHistory();
  });
  ui.fontSize.addEventListener("input", () => { settings.fontSize = boundedNumber(ui.fontSize.value, 22, 36, 24); applySettings(); saveSettings(); });
  ui.voiceZh.addEventListener("change", () => { settings.voiceZh = ui.voiceZh.value; saveSettings(); renderVoiceWarning(); });
  ui.voiceVi.addEventListener("change", () => { settings.voiceVi = ui.voiceVi.value; saveSettings(); renderVoiceWarning(); });
  ui.previewZh.addEventListener("click", () => previewVoice("zh-TW", ui.voiceZh));
  ui.previewVi.addEventListener("click", () => previewVoice("vi-VN", ui.voiceVi));
  ui.rateZh.addEventListener("input", () => { settings.rateZh = boundedNumber(ui.rateZh.value, 0.5, 1.5, 0.9); document.getElementById("rate-zh-value").textContent = `${settings.rateZh.toFixed(2).replace(/0$/, "")}×`; saveSettings(); });
  ui.rateVi.addEventListener("input", () => { settings.rateVi = boundedNumber(ui.rateVi.value, 0.5, 1.5, 0.9); document.getElementById("rate-vi-value").textContent = `${settings.rateVi.toFixed(2).replace(/0$/, "")}×`; saveSettings(); });
  ui.apiKey.addEventListener("input", () => { settings.apiKey = ui.apiKey.value.trim(); saveSettings(); renderEngineStatus(); });
  ui.model.addEventListener("change", () => { settings.model = CLAUDE_MODELS.includes(ui.model.value) ? ui.model.value : CLAUDE_MODELS[0]; saveSettings(); renderEngineStatus(); });
  ui.relationship.addEventListener("change", () => { settings.relationship = Object.prototype.hasOwnProperty.call(RELATIONSHIPS, ui.relationship.value) ? ui.relationship.value : "couple"; saveSettings(); });
  ui.toneNote.addEventListener("input", () => { settings.toneNote = ui.toneNote.value.slice(0, 200); saveSettings(); });
  ui.layout.addEventListener("change", () => { settings.layout = LAYOUTS.includes(ui.layout.value) ? ui.layout.value : "face"; saveSettings(); applySettings(); });
  ui.testEngine.addEventListener("click", testEngine);
  ui.autoSpeak.addEventListener("change", () => { settings.autoSpeak = ui.autoSpeak.checked; saveSettings(); });
  ui.email.addEventListener("change", () => { settings.email = ui.email.validity.valid ? ui.email.value.trim() : ""; saveSettings(); });
}

init();
