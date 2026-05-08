let currentLang = "en";

const video = document.getElementById("video");
const sidebar = document.getElementById("sidebar");
const multiInput = document.getElementById("multiInput");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const dropzone = document.getElementById("dropzone");
const toggleBtn = document.getElementById("toggleSubs");
const overlay = document.getElementById("subtitleOverlay");
const deleteVideoBtn = document.getElementById("deleteVideoBtn");
const playPause = document.getElementById("playPause");
const progress = document.getElementById("progress");
const timeLabel = document.getElementById("time");
const videoContainer = document.getElementById("videoContainer");
const controls = document.getElementById("controls");
const ankiAllBtn = document.getElementById("ankiAllBtn");
const targetNoteSelect = document.getElementById("targetNoteSelect");
const audioTrackSelect = document.getElementById("audioTrackSelect");
const fontSizeRange = document.getElementById("fontSizeRange");
const subtitleOverlay = document.getElementById("subtitleOverlay");
const prevSubBtn = document.getElementById("prevSubBtn");
const nextSubBtn = document.getElementById("nextSubBtn");
const resizer = document.getElementById("resizer");
const videoPickerModal = document.getElementById("videoPickerModal");
const videoPickerList = document.getElementById("videoPickerList");
const videoPickerCancelBtn = document.getElementById("videoPickerCancelBtn");

let isResizing = false;
let subtitles = [];
let globalSubDelay = 0;
let subtitleElements = [];
let currentVideoFile = null;
let lastClickedSubtitleIdx = null;
let lastSidebarWidth = "";
let lastRuntimeSubtitleText = "";
let runtimePrefetchAllRunId = 0;
let runtimePrefetchAllInProgress = false;

prevSubBtn.onclick = () => seekBySubtitle(-1);
nextSubBtn.onclick = () => seekBySubtitle(1);

const volume = document.getElementById("volume");
video.volume = volume.value;

video.addEventListener("timeupdate", () => {
    const sub = getCurrentSubtitle();

    if (sub?.text && sub.text !== lastRuntimeSubtitleText) {
        lastRuntimeSubtitleText = sub.text;

        ensureStatusesForSubtitleText(sub.text).catch((err) => {
            console.warn("Runtime subtitle status lookup failed:", err);
        });
    }

    renderSubtitleOverlay({
        overlay,
        text: sub ? sub.text : "",
        highlighter: ankiSubtitleHighlighter
    });

    progress.value = (video.currentTime / video.duration) * 100 || 0;
    timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;

    if (!video.paused && sub) {
        const idx = subtitles.indexOf(sub);
        syncSubtitleStyle(idx);
    }
});

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

async function handleFiles(files) {
    let videoFile = null;
    let subtitleFile = null;
    let hasSubtitles = false;

    for (const file of files) {
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith(".srt")) {
            subtitleFile = file;
            subtitles = parseSRT(await file.text());
            hasSubtitles = true;
        } else if (lowerName.endsWith(".ass")) {
            subtitleFile = file;
            subtitles = parseASS(await file.text());
            hasSubtitles = true;
        } else if (file.type.startsWith("video")) {
            videoFile = file;
        }
    }

    if (videoFile) {
        if (!hasSubtitles) {
            subtitles = [];
            lastRuntimeSubtitleText = "";

            renderSubtitleOverlay({
                overlay,
                text: ""
            });
        }

        video.src = URL.createObjectURL(videoFile);
        dropzone.classList.add("hidden");

        uploadVideoInBackground(videoFile, subtitleFile);
    }

    lastRuntimeSubtitleText = "";
    runtimePrefetchAllRunId += 1;

    clearRuntimeWordStatuses?.();

    renderSubtitles();

    requestAnimationFrame(() => {
        prefetchRuntimeStatusesForAllSubtitles({ silent: true });
    });
}

async function prefetchRuntimeStatusesForAllSubtitles({ silent = true } = {}) {
    if (!Array.isArray(subtitles) || !subtitles.length) return;

    const runId = ++runtimePrefetchAllRunId;
    runtimePrefetchAllInProgress = true;

    try {
        await loadKnownBasicWords?.();

        if (typeof getJapaneseTokenizer === "function") {
            await getJapaneseTokenizer();
        }

        const uniqueTexts = [...new Set(
            subtitles
                .map((sub) => sub?.text)
                .filter(Boolean)
        )];

        const currentSub = getCurrentSubtitle?.();
        const currentText = currentSub?.text || "";

        if (currentText) {
            await ensureStatusesForSubtitleText(currentText, {
                rerender: true,
                silent
            });
        }

        for (const text of uniqueTexts) {
            if (runId !== runtimePrefetchAllRunId) return;
            if (text === currentText) continue;

            await ensureStatusesForSubtitleText(text, {
                rerender: false,
                silent: true
            });

            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        if (runId === runtimePrefetchAllRunId) {
            rerenderCurrentSubtitleWithAnkiHighlighter?.();
        }
    } catch (err) {
        console.warn("Runtime full subtitle prefetch failed:", err);
    } finally {
        if (runId === runtimePrefetchAllRunId) {
            runtimePrefetchAllInProgress = false;
        }
    }
}

[dropzone, videoContainer].forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.style.cursor = "pointer";
    });

    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    });
});

async function uploadVideoInBackground(videoFile, subtitleFile = null) {
    const form = new FormData();
    form.append("videoFile", videoFile);

    try {
        const { data } = await apiJson("/upload-video", {
            method: "POST",
            body: form
        });

        if (data.error) {
            console.error("Server upload error:", data.error);
            showToast("Video upload failed: " + data.error, "error", 5000);
            return;
        }

        currentVideoFile = data.filename;
        loadAudioTrackList(data.filename);

        if (subtitleFile) {
            await uploadSubtitleInBackground(subtitleFile, data.filename);
        }

    } catch (e) {
        console.error("Upload failed:", e);
        showToast("Upload failed: " + e.message, "error", 5000);
    }
}

async function uploadSubtitleInBackground(subtitleFile, videoFilename) {
    const form = new FormData();

    form.append("subtitleFile", subtitleFile);
    form.append("videoFilename", videoFilename);

    try {
        const { data } = await apiJson("/upload-subtitle", {
            method: "POST",
            body: form
        });

        if (data.error) {
            console.error("Subtitle upload error:", data.error);
            showToast("Subtitle upload failed: " + data.error, "error", 5000);
            return;
        }

        console.log("Subtitle uploaded:", data.filename);
    } catch (err) {
        console.error("Subtitle upload failed:", err);
        showToast("Subtitle upload failed: " + err.message, "error", 5000);
    }
}

async function restoreSubtitleFromServer(subtitleFilename) {
    try {
        const res = await fetch(buildApiUrl(`/subtitle/${encodeURIComponent(subtitleFilename)}`));

        if (!res.ok) {
            throw new Error(`Subtitle load failed: HTTP ${res.status}`);
        }

        const text = await res.text();
        const lowerName = subtitleFilename.toLowerCase();

        if (lowerName.endsWith(".srt")) {
            subtitles = parseSRT(text);
        } else if (lowerName.endsWith(".ass")) {
            subtitles = parseASS(text);
        } else {
            throw new Error("Unsupported subtitle format");
        }

        lastRuntimeSubtitleText = "";
        runtimePrefetchAllRunId += 1;

        clearRuntimeWordStatuses?.();

        renderSubtitles();

        requestAnimationFrame(() => {
            prefetchRuntimeStatusesForAllSubtitles({ silent: true });
        });

        showToast("Video and subtitles restored", "info", 2500);
    } catch (err) {
        console.error("Could not restore subtitles:", err);
        showToast("Video restored, but subtitles failed", "error", 5000);
    }
}

document.getElementById("clickToUpload").onclick = () => multiInput.click();
multiInput.addEventListener("change", (e) => handleFiles(e.target.files));

dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
});
dropzone.addEventListener("dragover", (e) => e.preventDefault());

toggleBtn.onclick = (e) => {
    e.stopPropagation();

    const isHidden = sidebar.classList.contains("hidden");

    if (!isHidden) {
        const currentWidth = sidebar.style.width || `${Math.round(sidebar.getBoundingClientRect().width)}px`;
        if (currentWidth && currentWidth !== "0px") lastSidebarWidth = currentWidth;

        sidebar.classList.add("hidden");
        resizer.classList.add("hidden");
        sidebar.style.width = "0px";
    } else {
        sidebar.classList.remove("hidden");
        resizer.classList.remove("hidden");

        const saved = JSON.parse(localStorage.getItem("subtitlePlayerSettings") || "{}").sidebarWidth;
        sidebar.style.width = lastSidebarWidth || saved || "260px";
    }

    const langKey = sidebar.classList.contains("hidden") ? "showSubs" : "hideSubs";
    toggleBtn.textContent = i18n[currentLang].dict[langKey];
};

function updatePlayButton() {
    playPause.textContent = video.paused ? "▶" : "⏸";
}

playPause.onclick = (e) => {
    e.stopPropagation();

    if (video.paused) video.play();
    else video.pause();
};

video.onclick = () => {
    if (video.paused) video.play();
    else video.pause();
};

closeSettingsBtn.onclick = () => {
    settingsModal.classList.add("hidden");
};

settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add("hidden");
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        settingsModal.classList.add("hidden");
    }
});

document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const targetTab = tab.dataset.settingsTab;

        document.querySelectorAll(".settings-tab").forEach((item) => {
            item.classList.toggle("active", item === tab);
        });

        document.querySelectorAll(".settings-page").forEach((page) => {
            page.classList.toggle(
                "active",
                page.dataset.settingsPage === targetTab
            );
        });
    });
});

progress.oninput = () => {
    video.currentTime = (progress.value / 100) * video.duration;
    audioManager.sync();
};

videoContainer.addEventListener("mousemove", (e) => {
    const rect = videoContainer.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const isBottom = relativeY >= rect.height - 120;

    controls.style.opacity = isBottom ? "1" : "0";
    controls.style.pointerEvents = isBottom ? "auto" : "none";
});

const FRAME_STEP_SECONDS = 1 / 30;

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

let deckNoteRefreshTimer = null;

async function fetchDeckNoteIds(ankiUrl, deckName) {
    const findRes = await fetch(ankiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "findNotes",
            version: 6,
            params: {
                query: `deck:"${deckName}"`
            }
        })
    });

    const findData = await findRes.json();

    if (findData.error) throw new Error(findData.error);

    return Array.isArray(findData.result) ? findData.result : [];
}

function stripHtml(input) {
    return String(input || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function pickNotePreviewText(noteInfo) {
    const fields = noteInfo?.fields || {};
    const preferredFieldOrder = [
        "Word", "Key", "Expression", "Sentence", "Front", "Back", "Meaning", "Definition"
    ];

    for (const key of preferredFieldOrder) {
        const value = stripHtml(fields[key]?.value);
        if (value) return value;
    }

    for (const field of Object.values(fields)) {
        const value = stripHtml(field?.value);
        if (value) return value;
    }

    return "";
}

async function fetchNotesInfo(ankiUrl, noteIds) {
    const res = await fetch(ankiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "notesInfo",
            version: 6,
            params: {
                notes: noteIds
            }
        })
    });

    const data = await res.json();

    if (data.error) throw new Error(data.error);

    return Array.isArray(data.result) ? data.result : [];
}

async function refreshTargetNoteList({ preserveSelection = true } = {}) {
    if (!targetNoteSelect) return;

    const ankiUrl = document.getElementById("ankiUrl").value;
    const deckName = document.getElementById("deckName").value;
    const previousValue = preserveSelection ? targetNoteSelect.value : "";

    targetNoteSelect.innerHTML = "";

    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = i18n[currentLang].dict.lastAdded || "🕘";
    autoOption.title = i18n[currentLang].dict.lastAddedTitle || "Last added card";

    targetNoteSelect.appendChild(autoOption);
    targetNoteSelect.title = i18n[currentLang].dict.lastAddedTitle || "Last added card";

    if (!ankiUrl || !deckName) {
        updateTargetNoteButtonText();
        rebuildTargetNoteMenu();
        return;
    }

    try {
        const ids = await fetchDeckNoteIds(ankiUrl, deckName);

        if (!ids.length) {
            updateTargetNoteButtonText();
            rebuildTargetNoteMenu();
            return;
        }

        const recentIds = ids.slice(-50).reverse();
        const infoList = await fetchNotesInfo(ankiUrl, recentIds);
        const infoById = new Map(infoList.map((item) => [Number(item.noteId), item]));

        recentIds.forEach((id) => {
            const opt = document.createElement("option");
            opt.value = String(id);

            const preview = pickNotePreviewText(infoById.get(Number(id)));
            const shortPreview = preview.length > 70 ? `${preview.slice(0, 67)}...` : preview;

            opt.textContent = shortPreview || `#${id}`;
            opt.title = preview || `#${id}`;

            targetNoteSelect.appendChild(opt);
        });

        if (previousValue && recentIds.includes(Number(previousValue))) {
            targetNoteSelect.value = previousValue;
        } else {
            targetNoteSelect.value = "";
        }

        updateTargetNoteButtonText();
        rebuildTargetNoteMenu();
    } catch (err) {
        console.error("Could not load deck notes:", err);
        updateTargetNoteButtonText();
        rebuildTargetNoteMenu();
    }
}

function getTargetNoteDropdownEls() {
    return {
        dropdown: document.getElementById("targetNoteDropdown"),
        button: document.getElementById("targetNoteButton"),
        buttonText: document.getElementById("targetNoteButtonText"),
        menu: document.getElementById("targetNoteMenu")
    };
}

function updateTargetNoteButtonText() {
    const { dropdown, button, buttonText } = getTargetNoteDropdownEls();

    if (!button || !buttonText || !targetNoteSelect) return;

    const selectedOption = targetNoteSelect.selectedOptions[0];

    const text = selectedOption?.textContent || "🕘";
    const title = selectedOption?.title || text;

    buttonText.textContent = text;
    button.title = title;

    requestAnimationFrame(() => {
        const availableWidth = 42;
        const textWidth = buttonText.scrollWidth;
        const overflow = textWidth > availableWidth;

        buttonText.classList.toggle("is-overflowing", overflow);

        if (dropdown) {
            dropdown.style.setProperty("--note-text-width", `${availableWidth}px`);

            const distance = overflow ? -(textWidth - availableWidth) : 0;
            dropdown.style.setProperty("--note-scroll-distance", `${distance}px`);
        }
    });
}

function updateTargetNoteMenuWidth() {
    const { dropdown } = getTargetNoteDropdownEls();

    if (!dropdown || !targetNoteSelect) return;

    const canvas = updateTargetNoteMenuWidth.canvas || document.createElement("canvas");
    updateTargetNoteMenuWidth.canvas = canvas;

    const ctx = canvas.getContext("2d");
    ctx.font = "12px sans-serif";

    const getWords = (text) => {
        const normalized = String(text || "").trim();

        if (!/\s/.test(normalized)) return [normalized];

        return normalized
            .split(/\s+/)
            .map((word) => word.trim())
            .filter(Boolean);
    };

    const longestWordWidth = Array.from(targetNoteSelect.options).reduce((max, option) => {
        const words = getWords(option.textContent || "");

        const localMax = words.reduce((wordMax, word) => {
            return Math.max(wordMax, ctx.measureText(word).width);
        }, 0);

        return Math.max(max, localMax);
    }, 0);

    const width = Math.ceil(Math.min(Math.max(longestWordWidth + 14, 64), 260));
    dropdown.style.setProperty("--note-menu-width", `${width}px`);
}

function rebuildTargetNoteMenu() {
    const { menu } = getTargetNoteDropdownEls();

    if (!menu || !targetNoteSelect) return;

    menu.innerHTML = "";

    Array.from(targetNoteSelect.options).forEach((option) => {
        const item = document.createElement("div");

        item.className = "note-dropdown-item";
        item.textContent = option.textContent;
        item.title = option.title || option.textContent;
        item.dataset.value = option.value;

        if (option.value === targetNoteSelect.value) {
            item.classList.add("active");
        }

        item.addEventListener("click", () => {
            targetNoteSelect.value = option.value;
            targetNoteSelect.dispatchEvent(new Event("change"));

            menu.classList.add("hidden");
            updateTargetNoteButtonText();
            rebuildTargetNoteMenu();
        });

        menu.appendChild(item);
    });

    updateTargetNoteMenuWidth();
}

function initTargetNoteDropdown() {
    const { button, menu } = getTargetNoteDropdownEls();

    if (!button || !menu) return;

    button.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.toggle("hidden");

        if (!menu.classList.contains("hidden")) {
            refreshTargetNoteList({ preserveSelection: true });
        }
    });

    document.addEventListener("click", (e) => {
        const { dropdown, menu } = getTargetNoteDropdownEls();

        if (!dropdown || !menu) return;

        if (!dropdown.contains(e.target)) {
            menu.classList.add("hidden");
        }
    });

    targetNoteSelect?.addEventListener("change", () => {
        updateTargetNoteButtonText();
        rebuildTargetNoteMenu();
    });

    updateTargetNoteButtonText();
    rebuildTargetNoteMenu();
}

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;

    if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekBySubtitle(-1);
    }

    if (e.code === "ArrowRight") {
        e.preventDefault();
        seekBySubtitle(1);
    }
});

document.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;

    if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreenMode();
        return;
    }

    if (e.code === "Comma") {
        e.preventDefault();
        stepFrame(-1);
        return;
    }

    if (e.code === "Period") {
        e.preventDefault();
        stepFrame(1);
        return;
    }

    if (e.code === "Space") {
        e.preventDefault();

        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }

        return;
    }

    if (e.code === "KeyS") {
        e.preventDefault();
        toggleBtn.click();
    }
});

ankiAllBtn.onclick = async () => {
	
	if (!currentVideoFile) {
	  showToast("Video is not uploaded", "error", 4000);
	  return;
	}

    const offsetStart = parseFloat(document.getElementById("subOffsetStart").value) || 0;
    const offsetEnd = parseFloat(document.getElementById("subOffsetEnd").value) || 0;
    const depth = parseInt(document.getElementById("subDepth")?.value, 10) || 1;
    const volumeLevel = getValidatedVolume();
    const ankiUrl = document.getElementById("ankiUrl").value;
    const deckName = document.getElementById("deckName").value;
    const screenshotMode = document.getElementById("screenshotMode").value;

    const sentenceField = document.getElementById("sentenceField").value.trim();
    const pictureField = document.getElementById("pictureField").value.trim();
    const audioField = document.getElementById("audioField").value.trim();

	if (!pictureField || !audioField) {
	  showToast("Picture Field and Audio Field are required", "error", 4000);
	  return;
	}

    const currentIdx = subtitles.findIndex((s) => {
        return (video.currentTime - globalSubDelay) >= s.start &&
            (video.currentTime - globalSubDelay) <= s.end;
    });

	if (currentIdx === -1) {
	  showToast("There is no active subtitle", "error", 4000);
	  return;
	}

    let targetTime;

    if (screenshotMode === "current") {
        targetTime = video.currentTime;
    } else {
        targetTime = Math.max(0, subtitles[currentIdx].start + offsetStart);
    }

    const endIdx = Math.min(currentIdx + depth - 1, subtitles.length - 1);
    const audioStart = Math.max(0, subtitles[currentIdx].start + globalSubDelay + offsetStart);

    let audioEnd = subtitles[endIdx].end + globalSubDelay + offsetEnd;

    if (audioEnd <= audioStart) audioEnd = audioStart + 0.5;

    const combinedText = subtitles
        .slice(currentIdx, endIdx + 1)
        .map((s) => s.text)
        .join(" ");

    const includeImageSubtitle = document.getElementById("includeImageSubtitle")?.checked !== false;
    const imageSubtitleText = includeImageSubtitle ? combinedText : "";

    try {
        const pictureEndpoint = screenshotMode === "webp"
            ? "/animated-webp"
            : "/screenshot";

        const picturePayload = screenshotMode === "webp"
            ? {
                filename: currentVideoFile,
                start: audioStart,
                end: audioEnd,
                text: imageSubtitleText,
                fontSize: document.getElementById("fontSizeRange").value
            }
            : {
                filename: currentVideoFile,
                time: targetTime,
                text: imageSubtitleText,
                fontSize: document.getElementById("fontSizeRange").value
            };

        const [sRes, aRes] = await Promise.all([
            fetch(buildApiUrl(pictureEndpoint), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(picturePayload)
            }),
            fetch(buildApiUrl("/audio-to-anki"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: currentVideoFile,
                    start: audioStart,
                    end: audioEnd,
                    trackIndex: audioTrackSelect.value === "default" ? "a:0" : audioTrackSelect.value,
                    volume: volumeLevel
                })
            })
        ]);

        const sData = await sRes.json();
        const aData = await aRes.json();

        if (!sRes.ok || !aRes.ok) {
            throw new Error(sData.error || aData.error || "Media server error");
        }

        const sName = sData.filename;
        const aName = aData.filename;

        const noteIds = await fetchDeckNoteIds(ankiUrl, deckName);

        if (!noteIds.length) {
            throw new Error(`Error: There are no cards in "${deckName}"!`);
        }

        const selectedId = Number(targetNoteSelect?.value || 0);
        const targetNoteId = selectedId > 0 ? selectedId : noteIds[noteIds.length - 1];

        await fetch(ankiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "updateNoteFields",
                version: 6,
                params: {
                    note: {
                        id: targetNoteId,
                        fields: (() => {
                            const fieldsToUpdate = {};

                            if (sentenceField) {
                                fieldsToUpdate[sentenceField] = combinedText;
                            }

                            fieldsToUpdate[pictureField] = `<img src="${sName}">`;
                            fieldsToUpdate[audioField] = `[sound:${aName}]`;

                            return fieldsToUpdate;
                        })()
                    }
                }
            })
        });

        clearRuntimeWordStatuses?.();

        await ensureStatusesForSubtitleText(combinedText).catch((err) => {
            console.warn("Could not update runtime highlight status:", err);
        });

        prefetchRuntimeStatusesForAllSubtitles({ silent: true });

        showToast("Card updated successfully", "success");

        if (targetNoteSelect) targetNoteSelect.value = "";

        refreshTargetNoteList({ preserveSelection: false });
	} catch (err) {
	  console.error("Update error:", err);
	  showToast("Error: " + err.message, "error", 6000);
	}
};

deleteVideoBtn.onclick = async () => {
    await fetch(buildApiUrl(`/delete-video?filename=${encodeURIComponent(currentVideoFile)}`), {
        method: "DELETE"
    });

    location.reload();
};

videoContainer.addEventListener("wheel", (e) => {
    e.preventDefault();

    const direction = e.deltaY > 0 ? -0.05 : 0.05;

    let newVolume = video.volume + direction;
    newVolume = Math.max(0, Math.min(1, newVolume));

    video.volume = newVolume;
    volume.value = newVolume;

    if (audioManager.externalAudio) audioManager.externalAudio.volume = newVolume;
}, { passive: false });

settingsBtn.onclick = (e) => {
    e.stopPropagation();
    settingsModal.classList.remove("hidden");
};

document.addEventListener("click", (e) => {
    if (!settingsModal.contains(e.target) && e.target !== settingsBtn) {
        settingsModal.classList.add("hidden");
    }
});

fontSizeRange.addEventListener("input", (e) => {
    subtitleOverlay.style.fontSize = `${e.target.value}px`;
});

[
    "subtitleHighlightEnabled",
    "highlightColorNew",
    "highlightColorLearning",
    "highlightColorYoung",
    "highlightColorMature",
    "highlightColorSuspended",
    "highlightColorUnknown"
].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
        const sub = getCurrentSubtitle();

        renderSubtitleOverlay({
            overlay,
            text: sub ? sub.text : "",
            highlighter: ankiSubtitleHighlighter
        });
    });
});

const globalSubDelayInput = document.getElementById("globalSubDelay");

globalSubDelayInput.addEventListener("input", (e) => {
    globalSubDelay = parseFloat(e.target.value) || 0;
    lastRuntimeSubtitleText = "";
    runtimePrefetchAllRunId += 1;

    renderSubtitles();

    requestAnimationFrame(() => {
        prefetchRuntimeStatusesForAllSubtitles({ silent: true });
    });
});

const ankiUrlInput = document.getElementById("ankiUrl");
const deckNameInput = document.getElementById("deckName");
const highlightWordFieldInput = document.getElementById("highlightWordField");
const highlightDeckNamesInput = document.getElementById("highlightDeckNames");

[ankiUrlInput, deckNameInput].forEach((input) => {
    input?.addEventListener("input", () => {
        clearTimeout(deckNoteRefreshTimer);

        deckNoteRefreshTimer = setTimeout(() => {
            refreshTargetNoteList({ preserveSelection: true });
        }, 500);
    });
});

[ankiUrlInput, highlightWordFieldInput, highlightDeckNamesInput].forEach((input) => {
    input?.addEventListener("change", () => {
        lastRuntimeSubtitleText = "";
        runtimePrefetchAllRunId += 1;

        clearRuntimeWordStatuses?.();

        const sub = getCurrentSubtitle();

        if (sub?.text) {
            ensureStatusesForSubtitleText(sub.text).catch((err) => {
                console.warn("Runtime subtitle status lookup failed:", err);
            });
        }

        prefetchRuntimeStatusesForAllSubtitles({ silent: true });
    });
});

targetNoteSelect?.addEventListener("focus", () => {
    refreshTargetNoteList({ preserveSelection: true });
});

fullscreenBtn?.addEventListener("click", () => {
    toggleFullscreenMode();
});

document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtonText();
});

window.addEventListener("load", () => {
    initTargetNoteDropdown();
    refreshTargetNoteList({ preserveSelection: true });
    updateIconButtons();

	restoreCurrentVideoFromServer();

    getJapaneseTokenizer?.()
        .then(() => loadKnownBasicWords?.())
        .then(() => {
            const sub = getCurrentSubtitle?.();

            renderSubtitleOverlay({
                overlay,
                text: sub ? sub.text : "",
                highlighter: ankiSubtitleHighlighter
            });

            if (sub?.text) {
                ensureStatusesForSubtitleText(sub.text).catch((err) => {
                    console.warn("Runtime subtitle status lookup failed:", err);
                });
            }
        })
        .catch((err) => {
            console.warn("Japanese tokenizer/known words load failed:", err);
        });
});

document.getElementById("refreshAnkiHighlighterBtn")?.addEventListener("click", () => {
    runtimePrefetchAllRunId += 1;
    clearRuntimeWordStatuses?.();

    const sub = getCurrentSubtitle?.();

    if (sub?.text) {
		ensureStatusesForSubtitleText(sub.text).catch((err) => {
		  console.error("Runtime Anki highlighter failed:", err);
		  showToast("Runtime Anki highlighter failed: " + err.message, "error", 6000);
		});
    }

    prefetchRuntimeStatusesForAllSubtitles({ silent: true });
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && !video.paused) {
        video.play().catch(() => {});

        if (audioManager.externalAudio) {
            audioManager.externalAudio.play().catch(() => {});
        }
    }
});

resizer.addEventListener("mousedown", () => {
    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;

    const newWidth = window.innerWidth - e.clientX;

    if (newWidth > 150 && newWidth < window.innerWidth * 0.5) {
        sidebar.style.width = `${newWidth}px`;
    }
});

document.addEventListener("mouseup", () => {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";

    const settings = JSON.parse(localStorage.getItem("subtitlePlayerSettings") || "{}");
    settings.sidebarWidth = sidebar.style.width;
    localStorage.setItem("subtitlePlayerSettings", JSON.stringify(settings));
});

videoPickerCancelBtn?.addEventListener("click", () => {
    videoPickerModal?.classList.add("hidden");
    dropzone.classList.remove("hidden");
});

async function restoreCurrentVideoFromServer() {
    try {
        const { data } = await apiJson("/videos");

        const videos = Array.isArray(data.videos) ? data.videos : [];

        if (!videos.length) {
            dropzone.classList.remove("hidden");
            return;
        }

        if (videos.length === 1) {
            await restoreSelectedVideoFromServer(videos[0]);
            return;
        }

        showVideoPickerModal(videos);
    } catch (err) {
        console.warn("Could not restore videos from server:", err);
        dropzone.classList.remove("hidden");
    }
}

async function restoreSelectedVideoFromServer(videoInfo) {
    if (!videoInfo?.filename) {
        dropzone.classList.remove("hidden");
        return;
    }

    currentVideoFile = videoInfo.filename;

    video.src = buildApiUrl(`/video/${encodeURIComponent(videoInfo.filename)}`);
    video.load();

    dropzone.classList.add("hidden");
    videoPickerModal?.classList.add("hidden");

    loadAudioTrackList(videoInfo.filename);

    if (videoInfo.subtitleFilename) {
        await restoreSubtitleFromServer(videoInfo.subtitleFilename);
    } else {
        subtitles = [];
        lastRuntimeSubtitleText = "";

        clearRuntimeWordStatuses?.();

        renderSubtitles();

        renderSubtitleOverlay({
            overlay,
            text: ""
        });

        showToast("Video restored without subtitles", "info", 3000);
    }

    video.addEventListener("loadedmetadata", () => {
        console.log("Restored video loaded:", video.duration);
    }, { once: true });

    video.addEventListener("error", () => {
        console.error("Video restore failed:", video.error);
        showToast("Could not load selected video", "error", 5000);
        dropzone.classList.remove("hidden");
    }, { once: true });
}

function showVideoPickerModal(videos) {
    if (!videoPickerModal || !videoPickerList) {
        return;
    }

    videoPickerList.innerHTML = "";

    videos.forEach((videoInfo) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "video-picker-item";

        const title = document.createElement("div");
        title.className = "video-picker-title";
        title.textContent = videoInfo.filename;

        const subtitle = document.createElement("div");
        subtitle.className = "video-picker-subtitle";
        subtitle.textContent = videoInfo.subtitleFilename
            ? `Subtitle: ${videoInfo.subtitleFilename}`
            : "No subtitle found";

        item.appendChild(title);
        item.appendChild(subtitle);

        item.addEventListener("click", () => {
            restoreSelectedVideoFromServer(videoInfo);
        });

        videoPickerList.appendChild(item);
    });

    dropzone.classList.add("hidden");
    videoPickerModal.classList.remove("hidden");
}