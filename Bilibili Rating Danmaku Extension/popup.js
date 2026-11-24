const pageStatus = document.getElementById("pageStatus");
const quickJumpBar = document.getElementById("quickJumpBar");
const jumpRatingBtn = document.getElementById("jumpRatingBtn");
const jumpChapterBtn = document.getElementById("jumpChapterBtn");
const tabRatingBtn = document.getElementById("tabRatingBtn");
const tabChapterBtn = document.getElementById("tabChapterBtn");
const panelRating = document.getElementById("panelRating");
const panelChapter = document.getElementById("panelChapter");

// 评分弹幕元素
const tracklistInput = document.getElementById("tracklistInput");
const addAlbumRating = document.getElementById("addAlbumRating");
const avoidOverlap = document.getElementById("avoidOverlap");
const ratingLangRadios = document.querySelectorAll('input[name="ratingLang"]');
const ratingPreviewOutput = document.getElementById("ratingPreviewOutput");
const parseSummary = document.getElementById("parseSummary");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const syncToChapterBtn = document.getElementById("syncToChapterBtn");
const progressBar = document.getElementById("progressBar");
const logBox = document.getElementById("logBox");

// 章节导航条元素
const chapterSourceInput = document.getElementById("chapterSourceInput");
const syncToRatingBtn = document.getElementById("syncToRatingBtn");
const chapterLangRadios = document.querySelectorAll('input[name="chapterLang"]');
const autoCompressTitle = document.getElementById("autoCompressTitle");
const autoSaveChapter = document.getElementById("autoSaveChapter");
const keepDefaultExpand = document.getElementById("keepDefaultExpand");
const chapterOutput = document.getElementById("chapterOutput");
const chapterCheckSummary = document.getElementById("chapterCheckSummary");
const copyChapterBtn = document.getElementById("copyChapterBtn");
const applyChapterBtn = document.getElementById("applyChapterBtn");
const chapterLogBox = document.getElementById("chapterLogBox");

let activeTabId = null;
let currentMode = "unknown";
let currentTabUrl = "";

function switchTab(tabName) {
  const isRating = tabName === "rating";
  tabRatingBtn.classList.toggle("active", isRating);
  tabChapterBtn.classList.toggle("active", !isRating);
  panelRating.classList.toggle("active", isRating);
  panelChapter.classList.toggle("active", !isRating);
}

tabRatingBtn.addEventListener("click", () => switchTab("rating"));
tabChapterBtn.addEventListener("click", () => switchTab("chapter"));

function getSelectedLang(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "zh";
}

function setSelectedLang(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function toSeconds(timeStr) {
  const parts = timeStr.split(":").map((n) => parseInt(n, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatHMS(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getRatingUnitLength(str) {
  let units = 0;
  for (const ch of str) {
    units += ch.charCodeAt(0) <= 0x7f ? 0.5 : 1;
  }
  return units;
}

function getCharLength(str) {
  return str.length;
}

function stripVersionSuffix(title) {
  return title
    .replace(/\s*[（(\[][^()（）\[\]]*[）)\]]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSubtitle(title) {
  return title.split(/\s*[~～—–]\s*|\s+-\s+/)[0].trim() || title;
}

function truncateByMeasure(str, maxLimit, measureFn) {
  if (measureFn(str) <= maxLimit) return str;
  const chars = Array.from(str);
  let acc = "";
  const ellipsisCost = measureFn("…");
  for (const ch of chars) {
    if (measureFn(acc + ch) + ellipsisCost > maxLimit) break;
    acc += ch;
  }
  return acc.trimEnd() + "…";
}

function formatByChosenLang({ prefix = "", origName = "", zhName = "", lang, maxLimit, measureFn, allowCompress = true }) {
  const orig = (origName || "").trim();
  const zh = (zhName || "").trim();
  const body = lang === "en" ? (orig || zh) : (zh || orig);
  const rawFull = `${prefix}${body}`;

  if (!allowCompress || measureFn(rawFull) <= maxLimit) {
    return rawFull;
  }

  const noVersion = stripVersionSuffix(body);
  if (noVersion && measureFn(`${prefix}${noVersion}`) <= maxLimit) {
    return `${prefix}${noVersion}`;
  }

  const noSub = stripSubtitle(noVersion || body);
  if (noSub && measureFn(`${prefix}${noSub}`) <= maxLimit) {
    return `${prefix}${noSub}`;
  }

  return truncateByMeasure(`${prefix}${noSub || noVersion || body}`, maxLimit, measureFn);
}

function mergeMultilineTracks(raw) {
  const rawLines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const merged = [];
  const pureTimeRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  const hasTimeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (/^(序号|编号|#)\s*[\/|\t]/.test(line)) continue;

    if (
      !hasTimeRegex.test(line) &&
      i + 1 < rawLines.length &&
      pureTimeRegex.test(rawLines[i + 1])
    ) {
      merged.push(`${rawLines[i + 1]} ${line}`);
      i++;
      continue;
    }

    if (
      pureTimeRegex.test(line) &&
      i + 1 < rawLines.length &&
      !hasTimeRegex.test(rawLines[i + 1])
    ) {
      merged.push(`${line} ${rawLines[i + 1]}`);
      i++;
      continue;
    }

    merged.push(line);
  }
  return merged;
}

function splitOrigAndZh(text) {
  const clean = text.trim();
  if (!clean) return { origName: "", zhName: "" };

  const parenZhMatch = clean.match(
    /^(.+?)\s*[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[）)]\s*$/
  );
  if (parenZhMatch) {
    return {
      origName: parenZhMatch[1].trim(),
      zhName: parenZhMatch[2].trim()
    };
  }

  const dashZhMatch = clean.match(
    /^(.+?)\s+[-—–]\s+([^\r\n]*[\u4e00-\u9fff][^\r\n]*)$/
  );
  if (dashZhMatch) {
    return {
      origName: dashZhMatch[1].trim(),
      zhName: dashZhMatch[2].trim()
    };
  }

  const spaceZhMatch = clean.match(
    /^([A-Za-z0-9\s'&.,!?+~()\[\]-]+?)\s+([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef].+)$/
  );
  if (spaceZhMatch) {
    return {
      origName: spaceZhMatch[1].trim(),
      zhName: spaceZhMatch[2].trim()
    };
  }

  const hasCjk = /[\u4e00-\u9fff]/.test(clean);
  const hasLatinOrKana = /[A-Za-z\u3040-\u30ff]/.test(clean);
  if (hasCjk && !hasLatinOrKana) {
    return { origName: "", zhName: clean };
  }
  return { origName: clean, zhName: "" };
}

function parseSharedTracks(raw) {
  const lines = mergeMultilineTracks(raw);
  const tracks = [];
  const timeTokenRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/;

  for (const trimmed of lines) {
    const timeMatch = trimmed.match(timeTokenRegex);
    if (!timeMatch) continue;

    const seconds = toSeconds(timeMatch[1]);
    const withoutTime = trimmed.replace(timeMatch[0], " ").trim();

    let cols = withoutTime
      .split(/\s*[\/|\t]\s*/)
      .map((c) => c.replace(/\s*[-—–]+\s*$/, "").trim())
      .filter(Boolean);

    let seq = tracks.length + 1;
    if (cols.length >= 2 && /^\d+[.、)]?$/.test(cols[0])) {
      seq = parseInt(cols[0], 10);
      cols = cols.slice(1);
    } else if (cols.length >= 1) {
      const leadSeq = cols[0].match(/^(\d+)[.、)\s]+(.+)$/);
      if (leadSeq) {
        seq = parseInt(leadSeq[1], 10);
        cols[0] = leadSeq[2].trim();
      }
    }

    let origName = "";
    let zhName = "";

    if (cols.length >= 2) {
      origName = cols[0];
      zhName = cols[1];
    } else if (cols.length === 1) {
      const splitRes = splitOrigAndZh(cols[0]);
      origName = splitRes.origName;
      zhName = splitRes.zhName;
    }

    if (origName || zhName) {
      tracks.push({
        seq,
        seconds,
        hms: formatHMS(seconds),
        origName,
        zhName
      });
    }
  }

  return tracks;
}

// ==================== 评分弹幕逻辑（上限 12 字） ====================
function generateRatingLines(raw) {
  const tracks = parseSharedTracks(raw);
  const lang = getSelectedLang("ratingLang");
  const lines = [];

  if (addAlbumRating.checked && tracks.length > 0) {
    lines.push("00:00:05 专辑评分");
  }

  tracks.forEach((item, idx) => {
    let sec = item.seconds;
    if (idx === 0 && addAlbumRating.checked && avoidOverlap.checked && sec <= 10) {
      sec = 11;
    }
    const title = formatByChosenLang({
      prefix: "",
      origName: item.origName,
      zhName: item.zhName,
      lang,
      maxLimit: 12,
      measureFn: getRatingUnitLength,
      allowCompress: true
    });
    lines.push(`${formatHMS(sec)} ${title}`);
  });

  return lines.join("\n");
}

function parseRatingPreviewItems(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (!m) continue;
    const sec = toSeconds(m[1]);
    items.push({
      seconds: sec,
      time: formatHMS(sec),
      title: m[2].trim()
    });
  }
  return items;
}

function validateRatingPreview(text) {
  const items = parseRatingPreviewItems(text);
  const overLimit = items.filter((i) => getRatingUnitLength(i.title) > 12);
  if (overLimit.length > 0) {
    parseSummary.textContent = `预计 ${items.length} 条｜⚠ ${overLimit.length} 条超 12 字（如「${overLimit[0].title}」）`;
    parseSummary.className = "summary summary-err";
  } else {
    parseSummary.textContent = `预计添加 ${items.length} 条评分弹幕（均 ≤ 12 字）`;
    parseSummary.className = "summary";
  }
  return items;
}

function handleRatingSourceChange() {
  const previewText = generateRatingLines(tracklistInput.value);
  ratingPreviewOutput.value = previewText;
  validateRatingPreview(previewText);
  chrome.storage.local.set({
    savedTracklist: tracklistInput.value,
    savedRatingPreview: previewText,
    savedRatingLang: getSelectedLang("ratingLang"),
    savedAddAlbum: addAlbumRating.checked,
    savedAvoidOverlap: avoidOverlap.checked
  });
}

// ==================== 章节编排逻辑（上限 16 字） ====================
function formatChapterTitle(index, track, lang) {
  return formatByChosenLang({
    prefix: `${index}. `,
    origName: track.origName,
    zhName: track.zhName,
    lang,
    maxLimit: 16,
    measureFn: getCharLength,
    allowCompress: autoCompressTitle.checked
  });
}

function buildClosingTitle(index, remainingTracks) {
  const n = remainingTracks.length;
  return `${index}. 收尾${n}首见评论区`;
}

function generateChapterPlan(tracks) {
  if (tracks.length === 0) return "";
  const lang = getSelectedLang("chapterLang");
  const chapters = [];

  if (tracks.length <= 10) {
    tracks.forEach((t, idx) => {
      const sec = idx === 0 ? 0 : t.seconds;
      chapters.push({
        hms: formatHMS(sec),
        title: formatChapterTitle(idx + 1, t, lang)
      });
    });
  } else {
    for (let i = 0; i < 9; i++) {
      const t = tracks[i];
      const sec = i === 0 ? 0 : t.seconds;
      chapters.push({
        hms: formatHMS(sec),
        title: formatChapterTitle(i + 1, t, lang)
      });
    }
    const remaining = tracks.slice(9);
    chapters.push({
      hms: formatHMS(remaining[0].seconds),
      title: buildClosingTitle(10, remaining)
    });
  }

  return chapters.map((c) => `${c.hms} ${c.title}`).join("\n");
}

function validateChapterText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    chapterCheckSummary.textContent = "章数 0/10 · 最长标题 0 字 · 最小间隔 0 秒";
    chapterCheckSummary.className = "summary";
    return { valid: false, items: [] };
  }

  const parsed = [];
  let maxLen = 0;
  const issues = [];
  const overLines = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (!m) {
      issues.push(`第 ${i + 1} 行格式无效`);
      continue;
    }
    const sec = toSeconds(m[1]);
    const hms = formatHMS(sec);
    const title = m[2].trim();
    if (title.length > maxLen) maxLen = title.length;
    if (title.length > 16) overLines.push(i + 1);
    parsed.push({ seconds: sec, hms, title });
  }

  let minGap = parsed.length >= 2 ? Infinity : 0;
  for (let i = 1; i < parsed.length; i++) {
    const gap = parsed[i].seconds - parsed[i - 1].seconds;
    if (gap < minGap) minGap = gap;
  }
  if (minGap === Infinity) minGap = 0;

  if (parsed.length > 10) issues.push("章数超 10");
  if (parsed.length > 0 && parsed[0].seconds !== 0) issues.push("首章需为 00:00:00");
  if (overLines.length > 0) issues.push(`第 ${overLines.join("、")} 行超 16 字`);
  if (parsed.length >= 2 && minGap < 5) issues.push("存在间隔 < 5 秒");

  const statusText = `章数 ${parsed.length}/10 · 最长标题 ${maxLen}/16 字 · 最小间隔 ${minGap} 秒`;

  if (issues.length > 0) {
    chapterCheckSummary.textContent = `${statusText}｜⚠ ${issues.join("，")}`;
    chapterCheckSummary.className = "summary summary-err";
  } else {
    chapterCheckSummary.textContent = `${statusText}｜✅ 校验通过`;
    chapterCheckSummary.className = "summary summary-ok";
  }

  return { valid: issues.length === 0 && parsed.length > 0, items: parsed };
}

function handleChapterSourceChange() {
  const tracks = parseSharedTracks(chapterSourceInput.value);
  const chapterText = generateChapterPlan(tracks);
  chapterOutput.value = chapterText;
  validateChapterText(chapterText);
  chrome.storage.local.set({
    savedChapterSource: chapterSourceInput.value,
    savedChapterOutput: chapterText,
    savedChapterLang: getSelectedLang("chapterLang"),
    savedAutoCompressTitle: autoCompressTitle.checked,
    savedAutoSaveChapter: autoSaveChapter.checked,
    savedKeepDefaultExpand: keepDefaultExpand.checked
  });
}

// ==================== 页面状态检测 ====================
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  currentTabUrl = url;
  const isChapterUrl =
    url.includes("ChapterSetting") || url.includes("scene=chapter");
  const isRatingUrl =
    url.includes("PlayerSetting") ||
    url.includes("scene=custom") ||
    (url.includes("bilibili.com/web/player/") && !isChapterUrl);
  const isVideoUrl = url.includes("bilibili.com/video/");

  if (isVideoUrl && tab) {
    activeTabId = tab.id;
    quickJumpBar.classList.remove("hidden");
    pageStatus.textContent = "视频播放页";
    pageStatus.className = "badge badge-warn";
    startBtn.disabled = true;
    applyChapterBtn.disabled = true;
    return;
  }

  quickJumpBar.classList.add("hidden");

  if (!tab || (!isChapterUrl && !isRatingUrl)) {
    pageStatus.textContent = "未在编辑器页面";
    pageStatus.className = "badge badge-warn";
    startBtn.disabled = true;
    applyChapterBtn.disabled = true;
    return;
  }

  activeTabId = tab.id;
  switchTab(isChapterUrl ? "chapter" : "rating");

  try {
    const res = await chrome.tabs.sendMessage(activeTabId, { type: "GET_STATUS" });
    currentMode = res?.mode || (isChapterUrl ? "chapter" : "rating");
    pageStatus.textContent = res?.running
      ? "运行中..."
      : currentMode === "chapter"
        ? "章节编辑器就绪"
        : "评分编辑器就绪";
    pageStatus.className = "badge badge-ok";

    startBtn.disabled = Boolean(res?.running) || currentMode !== "rating";
    stopBtn.disabled = !res?.running;
    applyChapterBtn.disabled = Boolean(res?.running) || currentMode !== "chapter";

    if (res?.lastLog) {
      if (currentMode === "chapter") chapterLogBox.textContent = res.lastLog;
      else logBox.textContent = res.lastLog;
    }
    if (typeof res?.progress === "number") {
      progressBar.style.width = `${res.progress}%`;
    }
  } catch {
    pageStatus.textContent = "请刷新编辑器页";
    pageStatus.className = "badge badge-warn";
    startBtn.disabled = true;
    applyChapterBtn.disabled = true;
  }
}

// ==================== 事件绑定 ====================
async function openEditorFromVideoPage(target) {
  if (!activeTabId) return;
  try {
    const res = await chrome.tabs.sendMessage(activeTabId, {
      type: target === "chapter" ? "OPEN_CHAPTER_EDITOR" : "OPEN_RATING_EDITOR"
    });
    if (res?.opened) return;
  } catch {
    // 兜底用 BV 号直接跳转
  }
  const bvMatch = currentTabUrl.match(/BV[0-9A-Za-z]+/);
  if (bvMatch) {
    const bvid = bvMatch[0];
    const editorPath = target === "chapter" ? "ChapterSetting" : "PlayerSetting";
    chrome.tabs.create({
      url: `https://member.bilibili.com/platform/upload-manager/article/${editorPath}?bvid=${bvid}&from=player`
    });
  }
}

jumpRatingBtn.addEventListener("click", () => openEditorFromVideoPage("rating"));
jumpChapterBtn.addEventListener("click", () => openEditorFromVideoPage("chapter"));

syncToChapterBtn.addEventListener("click", () => {
  chapterSourceInput.value = tracklistInput.value;
  handleChapterSourceChange();
  switchTab("chapter");
});

syncToRatingBtn.addEventListener("click", () => {
  tracklistInput.value = chapterSourceInput.value;
  handleRatingSourceChange();
  switchTab("rating");
});

tracklistInput.addEventListener("input", handleRatingSourceChange);
addAlbumRating.addEventListener("change", handleRatingSourceChange);
avoidOverlap.addEventListener("change", handleRatingSourceChange);
ratingLangRadios.forEach((r) => r.addEventListener("change", handleRatingSourceChange));

ratingPreviewOutput.addEventListener("input", () => {
  validateRatingPreview(ratingPreviewOutput.value);
  chrome.storage.local.set({ savedRatingPreview: ratingPreviewOutput.value });
});

startBtn.addEventListener("click", async () => {
  const items = validateRatingPreview(ratingPreviewOutput.value);
  if (items.length === 0) {
    logBox.textContent = "未识别到有效的评分弹幕条目，请检查格式。";
    return;
  }
  if (!activeTabId) return;

  startBtn.disabled = true;
  stopBtn.disabled = false;
  progressBar.style.width = "0%";
  logBox.textContent = `准备开始添加共 ${items.length} 条评分弹幕...`;

  try {
    await chrome.tabs.sendMessage(activeTabId, {
      type: "START_BATCH",
      items
    });
  } catch (err) {
    logBox.textContent = `发送指令失败：${err.message}`;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener("click", async () => {
  if (!activeTabId) return;
  await chrome.tabs.sendMessage(activeTabId, { type: "STOP_BATCH" });
  stopBtn.disabled = true;
  logBox.textContent = "已请求停止，当前条目完成后将中止。";
});

chapterSourceInput.addEventListener("input", handleChapterSourceChange);
chapterLangRadios.forEach((r) => r.addEventListener("change", handleChapterSourceChange));
autoCompressTitle.addEventListener("change", handleChapterSourceChange);
chapterOutput.addEventListener("input", () => {
  validateChapterText(chapterOutput.value);
  chrome.storage.local.set({ savedChapterOutput: chapterOutput.value });
});
autoSaveChapter.addEventListener("change", () => {
  chrome.storage.local.set({ savedAutoSaveChapter: autoSaveChapter.checked });
});
keepDefaultExpand.addEventListener("change", () => {
  chrome.storage.local.set({ savedKeepDefaultExpand: keepDefaultExpand.checked });
});

copyChapterBtn.addEventListener("click", async () => {
  if (!chapterOutput.value) return;
  await navigator.clipboard.writeText(chapterOutput.value);
  copyChapterBtn.textContent = "已复制";
  setTimeout(() => (copyChapterBtn.textContent = "复制章节"), 1500);
});

applyChapterBtn.addEventListener("click", async () => {
  const check = validateChapterText(chapterOutput.value);
  if (!check.items || check.items.length === 0) {
    chapterLogBox.textContent = "请先输入并生成有效的章节文本。";
    return;
  }
  if (!check.valid) {
    chapterLogBox.textContent = "当前章节文本存在校验错误（请先修正超长标题、首章时间或间隔问题）。";
    return;
  }
  if (!activeTabId) return;

  applyChapterBtn.disabled = true;
  chapterLogBox.textContent = `正在导入 ${check.items.length} 条章节到编辑器...`;

  try {
    await chrome.tabs.sendMessage(activeTabId, {
      type: "APPLY_CHAPTERS",
      chapterText: chapterOutput.value,
      autoSave: autoSaveChapter.checked,
      keepDefaultExpand: keepDefaultExpand.checked
    });
  } catch (err) {
    chapterLogBox.textContent = `发送指令失败：${err.message}`;
    applyChapterBtn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "BATCH_PROGRESS") {
    progressBar.style.width = `${msg.progress}%`;
    logBox.textContent = msg.text;
    if (msg.done) {
      startBtn.disabled = currentMode !== "rating";
      stopBtn.disabled = true;
      pageStatus.textContent = "评分编辑器就绪";
    }
  }
  if (msg.type === "CHAPTER_PROGRESS") {
    chapterLogBox.textContent = msg.text;
    if (msg.done) {
      applyChapterBtn.disabled = currentMode !== "chapter";
      pageStatus.textContent = "章节编辑器就绪";
    }
  }
});

chrome.storage.local.get(
  [
    "savedTracklist",
    "savedRatingPreview",
    "savedRatingLang",
    "savedAddAlbum",
    "savedAvoidOverlap",
    "savedChapterSource",
    "savedChapterOutput",
    "savedChapterLang",
    "savedAutoCompressTitle",
    "savedAutoSaveChapter",
    "savedKeepDefaultExpand"
  ],
  (data) => {
    if (typeof data.savedTracklist === "string") tracklistInput.value = data.savedTracklist;
    if (typeof data.savedRatingPreview === "string") ratingPreviewOutput.value = data.savedRatingPreview;
    if (data.savedRatingLang === "en" || data.savedRatingLang === "zh") {
      setSelectedLang("ratingLang", data.savedRatingLang);
    }
    if (typeof data.savedAddAlbum === "boolean") addAlbumRating.checked = data.savedAddAlbum;
    if (typeof data.savedAvoidOverlap === "boolean") avoidOverlap.checked = data.savedAvoidOverlap;
    if (typeof data.savedChapterSource === "string") chapterSourceInput.value = data.savedChapterSource;
    if (typeof data.savedChapterOutput === "string") chapterOutput.value = data.savedChapterOutput;
    if (data.savedChapterLang === "en" || data.savedChapterLang === "zh") {
      setSelectedLang("chapterLang", data.savedChapterLang);
    }
    if (typeof data.savedAutoCompressTitle === "boolean") autoCompressTitle.checked = data.savedAutoCompressTitle;
    if (typeof data.savedAutoSaveChapter === "boolean") autoSaveChapter.checked = data.savedAutoSaveChapter;
    if (typeof data.savedKeepDefaultExpand === "boolean") keepDefaultExpand.checked = data.savedKeepDefaultExpand;

    if (tracklistInput.value) {
      handleRatingSourceChange();
    } else {
      validateRatingPreview(ratingPreviewOutput.value);
    }

    if (chapterSourceInput.value) {
      handleChapterSourceChange();
    } else {
      validateChapterText(chapterOutput.value);
    }
    checkActiveTab();
  }
);
