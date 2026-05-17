function showToast(message, type = "info", timeout = 3000) {
  let container = document.getElementById("mpToastContainer");

  if (!container) {
    container = document.createElement("div");
    container.id = "mpToastContainer";
    container.className = "mp-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `mp-toast mp-toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("mp-toast-removing");

    setTimeout(() => {
      toast.remove();
    }, 180);
  }, timeout);
}

function t(key, params = {}) {
    const fallbackDict = i18n?.en?.dict || {};
    const dictionary = i18n?.[currentLang]?.dict || fallbackDict;

    let text = dictionary[key] || fallbackDict[key] || key;

    for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
    }

    return text;
}

function updatePlayButton() {
    playPause.textContent = video.paused ? "▶" : "⏸";
}

function updateFullscreenButtonText() {
    if (!fullscreenBtn) return;

    const isFullscreen = !!document.fullscreenElement;
    const key = isFullscreen ? "exitFullscreen" : "fullscreen";
    const label = i18n[currentLang].dict[key] || (isFullscreen ? "Exit Fullscreen" : "Fullscreen");

    fullscreenBtn.textContent = "⛶";
    fullscreenBtn.title = label;
    fullscreenBtn.setAttribute("aria-label", label);
}

function updateIconButtons() {
    if (settingsBtn) {
        const settingsLabel = i18n[currentLang].dict.settings || "Settings";
        settingsBtn.textContent = "⚙";
        settingsBtn.title = settingsLabel;
        settingsBtn.setAttribute("aria-label", settingsLabel);
    }

    updateFullscreenButtonText();
}

async function toggleFullscreenMode() {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (err) {
        console.error("Fullscreen toggle failed:", err);
    }
}

function isTypingTarget(target) {
    if (!target) return false;

    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}


// add dynamic frame step
const FRAME_STEP_SECONDS = 1 / 24;

function stepFrame(direction) {
    if (!video.duration || Number.isNaN(video.duration)) return;

    video.pause();

    const nextTime = Math.max(
        0,
        Math.min(video.duration, video.currentTime + (FRAME_STEP_SECONDS * direction))
    );

    video.currentTime = nextTime;

    if (typeof audioManager !== "undefined" && audioManager) {
        audioManager.sync();
        audioManager.pause();
    }
}

function getCleanSelectedText() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
        return "";
    }

    return selection
        .toString()
        .trim()
        .replace(/\s+/g, " ");
}


function showAddKnownBasicButtonForSelection() {
    if (!addKnownBasicBtn && !addCardToDeck) return;

    const word = getCleanSelectedText();

    if (!word) {
        hideAddKnownBasicButton();
        return;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
        hideAddKnownBasicButton();
        return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!rect || rect.width === 0 || rect.height === 0) {
        hideAddKnownBasicButton();
        return;
    }

    selectedKnownBasicWord = word;

    const main = document.getElementById("main");
    const mainRect = main.getBoundingClientRect();

    const centerLeft = rect.left - mainRect.left + rect.width / 2;
    const safeTop = Math.max(12, rect.top - mainRect.top - 42);

    if (addKnownBasicBtn) {
        addKnownBasicBtn.style.left = `${centerLeft}px`;
        addKnownBasicBtn.style.top = `${safeTop}px`;
		addKnownBasicBtn.style.transform = addCardToDeck
			? "translateX(-105%)"
			: "translateX(-50%)";
        addKnownBasicBtn.classList.remove("hidden");
    }

    if (addCardToDeck) {
        addCardToDeck.style.left = `${centerLeft}px`;
        addCardToDeck.style.top = `${safeTop}px`;
        addCardToDeck.style.transform = "translateX(5%)";
        addCardToDeck.classList.remove("hidden");
    }
}

function hideAddKnownBasicButton() {
    addKnownBasicBtn?.classList.add("hidden");
    addCardToDeck?.classList.add("hidden");
    selectedKnownBasicWord = "";
}