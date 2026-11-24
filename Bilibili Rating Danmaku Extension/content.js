(() => {
  let isRunning = false;
  let shouldStop = false;
  let lastLog = "编辑器已就绪。";
  let lastProgress = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectMode() {
    const search = window.location.search || "";
    if (
      search.includes("scene=chapter") ||
      document.querySelector(".chapter-manager-list")
    ) {
      return "chapter";
    }
    if (
      search.includes("scene=custom") ||
      document.querySelector(".editor-right-tab-item")
    ) {
      return "rating";
    }
    if (window.location.pathname.startsWith("/video/")) {
      return "video_page";
    }
    return "unknown";
  }

  function notifyPopup(type, text, progress, done = false) {
    lastLog = text;
    if (typeof progress === "number") lastProgress = progress;
    chrome.runtime
      .sendMessage({
        type,
        text,
        progress,
        done
      })
      .catch(() => {});
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function parseHMSToSeconds(hms) {
    const parts = hms.trim().split(":").map((n) => parseInt(n, 10));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  async function waitForSelector(selector, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(100);
    }
    return null;
  }

  async function waitUntilGone(selector, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!document.querySelector(selector)) return true;
      await sleep(120);
    }
    return false;
  }

  // ==================== 评分弹幕执行器 ====================
  function getExistingStartSeconds() {
    const cards = document.querySelectorAll(
      ".editor-right-list-item .editor-right-card-head"
    );
    const times = [];
    cards.forEach((head) => {
      const timeEl = head.querySelector(
        ".editor-right-time:not(.editor-right-time-next)"
      );
      if (timeEl) times.push(parseHMSToSeconds(timeEl.textContent));
    });
    return times;
  }

  function findFreeSecond(preferredSec, existingStarts, duration) {
    const isOccupied = (sec) =>
      existingStarts.some((s) => Math.abs(sec - s) < 5);

    if (!isOccupied(preferredSec)) return preferredSec;

    const maxSec = Math.max(Math.floor(duration || 3600), preferredSec + 60);
    for (let s = 1; s < maxSec; s += 5) {
      if (!isOccupied(s)) return s;
    }
    return preferredSec;
  }

  async function ensureRatingTab() {
    const tabs = Array.from(document.querySelectorAll(".editor-right-tab-item"));
    const ratingTab = tabs.find((el) => el.textContent.includes("评分弹幕"));
    if (!ratingTab) {
      throw new Error("未找到「评分弹幕」标签页，请确认当前在弹幕配置编辑器中。");
    }
    if (!ratingTab.classList.contains("editor-active")) {
      ratingTab.click();
      await sleep(300);
    }
  }

  async function seekVideoTo(sec) {
    const video = document.querySelector("video");
    if (!video) return;
    if (Math.abs(video.currentTime - sec) < 0.5) return;
    video.currentTime = sec;
    await sleep(250);
  }

  async function addSingleRating(item) {
    const existingStarts = getExistingStartSeconds();
    if (existingStarts.includes(item.seconds)) {
      return { skipped: true, reason: "该时间点已存在评分卡片" };
    }

    const video = document.querySelector("video");
    const safeSeekSec = findFreeSecond(
      item.seconds,
      existingStarts,
      video?.duration
    );
    await seekVideoTo(safeSeekSec);

    const addButtons = Array.from(document.querySelectorAll(".editor-right-add"));
    const addRatingBtn = addButtons.find((el) =>
      el.textContent.includes("添加评分弹幕")
    );
    if (!addRatingBtn) {
      throw new Error("未找到「添加评分弹幕」按钮。");
    }
    addRatingBtn.click();

    const unfoldCard = await waitForSelector(
      ".editor-right-card.editor-unfold",
      3000
    );
    if (!unfoldCard) {
      throw new Error("未能展开新评分卡片（可能当前时间段重叠或数量已达上限）。");
    }

    const [hh, mm, ss] = item.time.split(":");
    const timeInputs = unfoldCard.querySelectorAll(".editor-right-time input");
    if (timeInputs.length >= 3) {
      setNativeValue(timeInputs[0], hh);
      setNativeValue(timeInputs[1], mm);
      setNativeValue(timeInputs[2], ss);
    }

    const titleInput = unfoldCard.querySelector('input[placeholder="请输入标题"]');
    if (!titleInput) {
      throw new Error("未找到标题输入框。");
    }
    setNativeValue(titleInput, item.title);
    await sleep(120);

    const firstRadio = unfoldCard.querySelector("input.score-skin-radio");
    if (firstRadio && !firstRadio.checked) {
      const label = unfoldCard.querySelector(`label[for="${firstRadio.id}"]`);
      if (label) label.click();
      else firstRadio.click();
    }

    const submitBtn = Array.from(
      document.querySelectorAll(".editor-right-btn button.bili-button--primary")
    ).find((btn) => btn.textContent.includes("提交"));

    if (!submitBtn) {
      throw new Error("未找到「提交」按钮。");
    }
    submitBtn.click();

    const saved = await waitUntilGone(".editor-right-btn", 6000);
    if (!saved) {
      throw new Error("提交超时，请检查标题是否超过字符限制或时间是否冲突。");
    }

    await sleep(250);
    return { skipped: false };
  }

  async function runRatingBatch(items) {
    isRunning = true;
    shouldStop = false;
    const logs = [];

    try {
      await ensureRatingTab();

      for (let i = 0; i < items.length; i++) {
        if (shouldStop) {
          logs.push("已手动停止。");
          notifyPopup(
            "BATCH_PROGRESS",
            logs.join("\n"),
            Math.round((i / items.length) * 100),
            true
          );
          return;
        }

        const item = items[i];
        const progress = Math.round((i / items.length) * 100);
        notifyPopup(
          "BATCH_PROGRESS",
          `[${i + 1}/${items.length}] 正在添加 ${item.time} ${item.title}...`,
          progress,
          false
        );

        try {
          const res = await addSingleRating(item);
          if (res.skipped) {
            logs.push(`⏭ ${item.time} ${item.title}（${res.reason}）`);
          } else {
            logs.push(`✅ ${item.time} ${item.title}`);
          }
        } catch (err) {
          logs.push(`❌ ${item.time} ${item.title}：${err.message}`);
        }
      }

      notifyPopup("BATCH_PROGRESS", `完成！\n${logs.join("\n")}`, 100, true);
    } catch (err) {
      notifyPopup(
        "BATCH_PROGRESS",
        `执行中止：${err.message}`,
        lastProgress,
        true
      );
    } finally {
      isRunning = false;
      shouldStop = false;
    }
  }

  // ==================== 章节导航条执行器 ====================
  async function runChapterApply({ chapterText, autoSave, keepDefaultExpand }) {
    isRunning = true;
    try {
      const openBtn = await waitForSelector(".chapter-manager-text-editor-btn", 3000);
      if (!openBtn) {
        throw new Error("未找到「章节文本编辑器」按钮，请确认已打开章节管理页面。");
      }
      openBtn.click();

      const textarea = await waitForSelector(
        ".text-editor-modal textarea.text-area",
        3000
      );
      if (!textarea) {
        throw new Error("未能打开章节文本编辑器弹窗。");
      }

      setNativeValue(textarea, chapterText);
      await sleep(200);

      const convertBtn = document.querySelector(
        ".text-editor-modal button.save-button"
      );
      if (!convertBtn) {
        throw new Error("未找到「转换成章节列表」按钮。");
      }
      convertBtn.click();

      const modalClosed = await waitUntilGone(".text-editor-modal", 4000);
      if (!modalClosed) {
        throw new Error("转换未关闭弹窗，请检查文本格式或时间间隔是否 ≥ 5 秒。");
      }

      await sleep(300);

      // 同步「播放器默认展示章节」勾选状态
      const checkbox = document.querySelector(".chapter-manager-checkbox");
      if (checkbox && typeof keepDefaultExpand === "boolean") {
        const isSelected = checkbox.classList.contains(
          "chapter-manager-checkbox-selected"
        );
        if (isSelected !== keepDefaultExpand) {
          checkbox.click();
          await sleep(150);
        }
      }

      const itemCount = document.querySelectorAll(
        ".chapter-manager-list-item"
      ).length;

      if (autoSave) {
        const saveBtn = document.querySelector(
          "button.chapter-manager-save-btn"
        );
        if (!saveBtn) {
          throw new Error(`已转换 ${itemCount} 条章节，但未找到「保存」按钮。`);
        }
        saveBtn.click();
        await sleep(600);
        notifyPopup(
          "CHAPTER_PROGRESS",
          `✅ 已一键转换 ${itemCount} 条章节并点击「保存」！`,
          100,
          true
        );
      } else {
        notifyPopup(
          "CHAPTER_PROGRESS",
          `✅ 已转换 ${itemCount} 条章节到列表，请核对后手动点击「保存」。`,
          100,
          true
        );
      }
    } catch (err) {
      notifyPopup("CHAPTER_PROGRESS", `❌ 导入失败：${err.message}`, 0, true);
    } finally {
      isRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const mode = detectMode();
    if (msg.type === "GET_STATUS") {
      if (mode === "unknown") return false;
      sendResponse({
        mode,
        running: isRunning,
        lastLog,
        progress: lastProgress
      });
      return true;
    }
    if (msg.type === "START_BATCH") {
      if (mode !== "rating") return false;
      if (!isRunning) {
        runRatingBatch(msg.items || []);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "STOP_BATCH") {
      shouldStop = true;
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "APPLY_CHAPTERS") {
      if (mode !== "chapter") return false;
      if (!isRunning) {
        runChapterApply(msg);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "OPEN_CHAPTER_EDITOR") {
      if (mode !== "video_page") return false;
      const btn = document.querySelector(
        'a.video-owner-state-item.chapter-manage, a[data-tooltip="章节管理"]'
      );
      if (btn) {
        btn.click();
        sendResponse({ opened: true });
      } else {
        sendResponse({ opened: false });
      }
      return true;
    }
    if (msg.type === "OPEN_RATING_EDITOR") {
      if (mode !== "video_page") return false;
      const btn = document.querySelector(
        'a.video-owner-state-item.danmu-manage, a[data-tooltip*="弹幕"], a[href*="PlayerSetting"]'
      );
      if (btn) {
        btn.click();
        sendResponse({ opened: true });
      } else {
        sendResponse({ opened: false });
      }
      return true;
    }
    return false;
  });
})();
