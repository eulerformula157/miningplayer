let currentLang = "en";

const video = document.getElementById("video");
const sidebar = document.getElementById("sidebar");
const multiInput = document.getElementById("multiInput");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");
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

let isResizing = false;
let subtitles = [];
let globalSubDelay = 0;
let subtitleElements = [];
let currentVideoFile = null;
let lastClickedSubtitleIdx = null;
let lastSidebarWidth = "";

prevSubBtn.onclick = () => seekBySubtitle(-1);
nextSubBtn.onclick = () => seekBySubtitle(1);

const volume = document.getElementById("volume");
video.volume = volume.value;

function renderSubtitles() {
    sidebar.innerHTML = "";
    subtitleElements = [];
    subtitles.forEach((sub, idx) => {
		
		const div = document.createElement("div");
		div.className = "subtitle";

		const timeContainer = document.createElement("div");
		timeContainer.className = "time-container";
		timeContainer.style.display = "flex";
		timeContainer.style.justifyContent = "space-between";
		timeContainer.style.fontSize = "14px";
		timeContainer.style.color = "#888";
		timeContainer.style.marginBottom = "10px";

		const startTime = document.createElement("span");
		startTime.textContent = formatTime(sub.start + globalSubDelay);

		const endTime = document.createElement("span");
		endTime.textContent = formatTime(sub.end + globalSubDelay);

		timeContainer.appendChild(startTime);
		timeContainer.appendChild(endTime);

		const textContent = document.createElement("div");
		textContent.className = "text-content";
		textContent.textContent = sub.text;

		div.appendChild(timeContainer);
		div.appendChild(textContent);
		
        div.onclick = () => {
            if (lastClickedSubtitleIdx === idx) {
                if (video.paused) video.play();
                else {
                    video.pause();
                    video.currentTime = sub.start + globalSubDelay + 0.05;
                }
            } else {
                video.pause();
                lastClickedSubtitleIdx = idx;
                syncSubtitleStyle(idx);
				video.currentTime = sub.start + globalSubDelay + 0.05;
				overlay.textContent = sub.text;
            }
            updatePlayButton();
        };
        sidebar.appendChild(div);
        subtitleElements.push({ div, sub });
    });
}

function getCurrentSubtitle() {
    const t = video.currentTime - globalSubDelay;
    return subtitles.find((s) => t >= s.start && t <= s.end);
}

function syncSubtitleStyle(idx) {
    lastClickedSubtitleIdx = idx;
    subtitleElements.forEach(({ div }, i) => {
        if (i === idx) {
            div.classList.add("active");
            div.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
            div.classList.remove("active");
        }
    });
}

video.addEventListener("timeupdate", () => {
    const sub = getCurrentSubtitle();
    overlay.textContent = sub ? sub.text : "";
    progress.value = (video.currentTime / video.duration) * 100 || 0;
    timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    if (!video.paused && sub) {
        const idx = subtitles.indexOf(sub);
        syncSubtitleStyle(idx);
    }
});

async function handleFiles(files) {
    let videoFile = null;
    let hasSubtitles = false;
    for (const file of files) {
        if (file.name.endsWith(".srt")) {
            subtitles = parseSRT(await file.text());
            hasSubtitles = true;
        } else if (file.name.endsWith(".ass")) {
            subtitles = parseASS(await file.text());
            hasSubtitles = true;
        } else if (file.type.startsWith("video")) {
            videoFile = file;
        }
    }

    if (videoFile) {
        if (!hasSubtitles) {
            subtitles = [];
            overlay.textContent = "";
        }
        video.src = URL.createObjectURL(videoFile);
        dropzone.classList.add("hidden");
        uploadVideoInBackground(videoFile);
    }

    renderSubtitles();
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

async function uploadVideoInBackground(file) {
    const form = new FormData();
    form.append("videoFile", file);
    try {
        const { data } = await apiJson("/upload-video", { method: "POST", body: form });
        if (data.error) {
            console.error("Server upload error:", data.error);
        } else {
            currentVideoFile = data.filename;
            loadAudioTrackList(data.filename);
        }
    } catch (e) {
        console.error("Upload failed:", e);
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

document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
    }
});

progress.oninput = () => {
    video.currentTime = (progress.value / 100) * video.duration;
    audioManager.sync();
};

const topControls = document.querySelector(".top-controls");
videoContainer.addEventListener("mousemove", (e) => {
    const rect = videoContainer.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const isBottom = relativeY >= rect.height - 80;
    const isTop = relativeY <= 120;

    controls.style.opacity = isBottom ? "1" : "0";
    controls.style.pointerEvents = isBottom ? "auto" : "none";
    [ankiAllBtn, settingsBtn].forEach((b) => {
        b.style.opacity = isTop ? "1" : "0";
        b.style.pointerEvents = isTop ? "auto" : "none";
    });
    topControls.classList.toggle("visible", isTop);
});

function seekBySubtitle(offset) {
    if (!subtitles.length) return;
    const t = video.currentTime;
    let currentIdx = subtitles.findIndex((s) => t >= s.start && t <= s.end);
    if (currentIdx === -1) {
        currentIdx = offset > 0 ? subtitles.findIndex((s) => s.start > t) : subtitles.filter((s) => s.end < t).length - 1;
    } else {
        currentIdx += offset;
    }
    currentIdx = Math.max(0, Math.min(subtitles.length - 1, currentIdx));
    const targetSub = subtitles[currentIdx];
    video.pause();
    video.currentTime = targetSub.start + 0.05;
    overlay.textContent = targetSub.text;
    syncSubtitleStyle(currentIdx);
}

const FRAME_STEP_SECONDS = 1 / 30;

function updateFullscreenButtonText() {
    if (!fullscreenBtn) return;
    const isFullscreen = !!document.fullscreenElement;
    const key = isFullscreen ? "exitFullscreen" : "fullscreen";
    fullscreenBtn.textContent = i18n[currentLang].dict[key] || (isFullscreen ? "Exit Fullscreen" : "Fullscreen");
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
    const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + (FRAME_STEP_SECONDS * direction)));
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
        body: JSON.stringify({ action: "findNotes", version: 6, params: { query: `deck:"${deckName}"` } })
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
            params: { notes: noteIds }
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
    autoOption.textContent = i18n[currentLang].dict.lastAdded || "Last added (auto)";
    targetNoteSelect.appendChild(autoOption);

    if (!ankiUrl || !deckName) return;

    try {
        const ids = await fetchDeckNoteIds(ankiUrl, deckName);
        if (!ids.length) return;

        const recentIds = ids.slice(-50).reverse();
        const infoList = await fetchNotesInfo(ankiUrl, recentIds);
        const infoById = new Map(infoList.map((item) => [Number(item.noteId), item]));

        recentIds.forEach((id) => {
            const opt = document.createElement("option");
            opt.value = String(id);
            const preview = pickNotePreviewText(infoById.get(Number(id)));
            const shortPreview = preview.length > 70 ? `${preview.slice(0, 67)}...` : preview;
            opt.textContent = shortPreview ? `${shortPreview}` : `#${id}`;
            opt.title = preview || `#${id}`;
            targetNoteSelect.appendChild(opt);
        });

        if (previousValue && recentIds.includes(Number(previousValue))) {
            targetNoteSelect.value = previousValue;
        } else {
            targetNoteSelect.value = "";
        }
    } catch (err) {
        console.error("Could not load deck notes:", err);
    }
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

    if (e.code === "KeyS") {
        e.preventDefault();
        toggleBtn.click();
    }
});

ankiAllBtn.onclick = async () => {
    if (!currentVideoFile) return alert("Video is not uploaded!");

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
		return alert("Picture Field and Audio Field are required!");
	}

	let currentIdx = subtitles.findIndex((s) => (video.currentTime - globalSubDelay) >= s.start && (video.currentTime - globalSubDelay) <= s.end);
	if (currentIdx === -1) return alert("There is no active subtitle!");

    let targetTime;
    if (screenshotMode === "current") targetTime = video.currentTime;
    else targetTime = Math.max(0, subtitles[currentIdx].start + offsetStart);

    const endIdx = Math.min(currentIdx + depth - 1, subtitles.length - 1);
	const audioStart = Math.max(0, subtitles[currentIdx].start + globalSubDelay + offsetStart);
	let audioEnd = subtitles[endIdx].end + globalSubDelay + offsetEnd;
	if (audioEnd <= audioStart) audioEnd = audioStart + 0.5;

    const combinedText = subtitles.slice(currentIdx, endIdx + 1).map((s) => s.text).join(" ");

    try {
		const pictureEndpoint = screenshotMode === "webp"
			? "/animated-webp"
			: "/screenshot";

		const picturePayload = screenshotMode === "webp"
			? {
				filename: currentVideoFile,
				start: audioStart,
				end: audioEnd,
				text: combinedText,
				fontSize: document.getElementById("fontSizeRange").value
			}
			: {
				filename: currentVideoFile,
				time: targetTime,
				text: combinedText,
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
        if (!sRes.ok || !aRes.ok) throw new Error(sData.error || aData.error || "Media server error");

        const sName = sData.filename;
        const aName = aData.filename;

        const noteIds = await fetchDeckNoteIds(ankiUrl, deckName);
        if (!noteIds.length) throw new Error(`Error: There are no cards in "${deckName}"!`);
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

        alert("Successfully updated card!");
        if (targetNoteSelect) targetNoteSelect.value = "";
        refreshTargetNoteList({ preserveSelection: false });
    } catch (err) {
        console.error("Update error:", err);
        alert("Error: " + err.message);
    }
};

deleteVideoBtn.onclick = async () => {
    await fetch(buildApiUrl(`/delete-video?filename=${encodeURIComponent(currentVideoFile)}`), { method: "DELETE" });
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
    settingsMenu.classList.toggle("hidden");
};

document.addEventListener("click", (e) => {
    if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
        settingsMenu.classList.add("hidden");
    }
});

fontSizeRange.addEventListener("input", (e) => {
    subtitleOverlay.style.fontSize = `${e.target.value}px`;
});

const globalSubDelayInput = document.getElementById("globalSubDelay");


globalSubDelayInput.addEventListener("input", (e) => {
    globalSubDelay = parseFloat(e.target.value) || 0;
    renderSubtitles();
});


const ankiUrlInput = document.getElementById("ankiUrl");
const deckNameInput = document.getElementById("deckName");
[ankiUrlInput, deckNameInput].forEach((input) => {
    input?.addEventListener("input", () => {
        clearTimeout(deckNoteRefreshTimer);
        deckNoteRefreshTimer = setTimeout(() => {
            refreshTargetNoteList({ preserveSelection: true });
        }, 300);
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
    refreshTargetNoteList({ preserveSelection: true });
    updateFullscreenButtonText();
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && !video.paused) {
        video.play().catch(() => {});
        if (audioManager.externalAudio) audioManager.externalAudio.play().catch(() => {});
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
