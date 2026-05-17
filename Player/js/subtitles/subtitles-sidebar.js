
// sidebar bootstrap

function initSubtitleSidebar() {
    initSubtitleSearchPanel();
    initSubtitleSidebarToggle();
    initSubtitleSidebarResizer();
}

function initSubtitleSidebarToggle() {
    if (!toggleBtn || !sidebar || !resizer) return;
    if (toggleBtn.dataset.sidebarInitialized === "true") return;

    toggleBtn.dataset.sidebarInitialized = "true";

    toggleBtn.addEventListener("click", (e) => {
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
    });
}

function initSubtitleSidebarResizer() {
    if (!resizer || !sidebar) return;
    if (resizer.dataset.sidebarResizeInitialized === "true") return;

    resizer.dataset.sidebarResizeInitialized = "true";

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
}

// search

function initSubtitleSearchPanel() {
    if (!sidebar) return;

    let list = document.getElementById("subtitleList");

    if (!list) {
        list = document.createElement("div");
        list.id = "subtitleList";
        sidebar.appendChild(list);
    }

    if (document.getElementById("subtitleSearchPanel")) return;

    const panel = document.createElement("div");
    panel.id = "subtitleSearchPanel";

    panel.innerHTML = `
        <input
            id="subtitleWordSearchInput"
            type="text"
            autocomplete="off"
        />
        <button id="subtitleSearchPrevBtn" type="button">↑</button>
        <button id="subtitleSearchNextBtn" type="button">↓</button>
        <input
            id="subtitleTimeSearchInput"
            type="text"
            autocomplete="off"
        />
        <button id="subtitleSearchCommitBtn" type="button">↵</button>
    `;

    sidebar.appendChild(panel);

    const wordInput = panel.querySelector("#subtitleWordSearchInput");
    const timeInput = panel.querySelector("#subtitleTimeSearchInput");
    const prevBtn = panel.querySelector("#subtitleSearchPrevBtn");
    const nextBtn = panel.querySelector("#subtitleSearchNextBtn");
    const commitBtn = panel.querySelector("#subtitleSearchCommitBtn");

    if (wordInput) {
        wordInput.value = subtitleSearchQuery || "";
    }

    if (timeInput && Number.isFinite(subtitleSearchTimeSeconds)) {
        timeInput.value = formatTime(subtitleSearchTimeSeconds);
    }

    updateSubtitleSearchPanelLanguage?.();

    wordInput?.addEventListener("focus", () => {
        subtitleSearchMode = "word";
        subtitleSearchTimeSeconds = null;

        if (timeInput) timeInput.value = "";

        if (!wordInput.value.trim()) {
            clearSearchMatches();
        }
    });

    timeInput?.addEventListener("focus", () => {
        subtitleSearchMode = "time";
        subtitleSearchQuery = "";

        if (wordInput) wordInput.value = "";

        if (!timeInput.value.trim()) {
            clearSearchMatches();
        }
    });

    wordInput?.addEventListener("input", () => {
        subtitleSearchMode = "word";
        subtitleSearchQuery = wordInput.value;
        subtitleSearchTimeSeconds = null;

        if (timeInput) timeInput.value = "";

        setSearchMatches(findSubtitleTextMatches(subtitleSearchQuery));
    });

    wordInput?.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;

        e.preventDefault();

        if (e.ctrlKey) {
            commitSearchMatch();
            return;
        }

	if (!subtitleSearchMatches.length) {
		setSearchMatches(findSubtitleTextMatches(wordInput.value), 0);
		return;
	}

	goToSearchMatch(e.shiftKey ? -1 : 1);
	
    });

    timeInput?.addEventListener("input", () => {
        subtitleSearchMode = "time";
        subtitleSearchQuery = "";

        if (wordInput) wordInput.value = "";

        const seconds = parseSearchTime(timeInput.value);

        if (!Number.isFinite(seconds)) {
            subtitleSearchTimeSeconds = null;
            clearSearchMatches();
            return;
        }

        subtitleSearchTimeSeconds = seconds;
        setSearchMatches(buildTimeSearchMatches(seconds));
    });

    timeInput?.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;

        e.preventDefault();

        if (e.ctrlKey) {
            activateTimeSearch({ commit: true });
            return;
        }

        activateTimeSearch({ commit: false });
    });

	prevBtn?.addEventListener("click", () => {
		if (hasActiveSubtitleSearch()) {
			goToSearchMatch(-1);
			return;
		}

		goToPreviousSubtitle();
	});

	nextBtn?.addEventListener("click", () => {
		if (hasActiveSubtitleSearch()) {
			goToSearchMatch(1);
			return;
		}

		goToNextSubtitle();
	});

    commitBtn?.addEventListener("click", () => {
        if (subtitleSearchMode === "time") {
            activateTimeSearch({ commit: true });
            return;
        }

        commitSearchMatch();
    });
}

function hasActiveSubtitleSearch() {
    return subtitleSearchMatches.length > 0;
}

function getCurrentSubtitleIndexForNavigation() {
    const t = video.currentTime - globalSubDelay;

    const activeIndex = subtitles.findIndex((s) => t >= s.start && t <= s.end);
    if (activeIndex !== -1) return activeIndex;

    const nextIndex = subtitles.findIndex((s) => s.start > t);
    if (nextIndex !== -1) return nextIndex;

    return subtitles.length - 1;
}

function goToPreviousSubtitle() {
    if (!subtitles.length) return;

    const currentIndex = getCurrentSubtitleIndexForNavigation();
    const targetIndex = Math.max(0, currentIndex - 1);

    video.currentTime = Math.max(0, subtitles[targetIndex].start + globalSubDelay + 0.01);
    syncSubtitleStyle(targetIndex);
    audioManager?.sync?.();
}

function goToNextSubtitle() {
    if (!subtitles.length) return;

    const currentIndex = getCurrentSubtitleIndexForNavigation();
    const targetIndex = Math.min(subtitles.length - 1, currentIndex + 1);

    video.currentTime = Math.max(0, subtitles[targetIndex].start + globalSubDelay + 0.01);
    syncSubtitleStyle(targetIndex);
    audioManager?.sync?.();
}

function updateSubtitleSearchPanelLanguage() {
    const dict = i18n?.[currentLang]?.dict || i18n?.en?.dict || {};

    const wordInput = document.getElementById("subtitleWordSearchInput");
    const timeInput = document.getElementById("subtitleTimeSearchInput");
    const prevBtn = document.getElementById("subtitleSearchPrevBtn");
    const nextBtn = document.getElementById("subtitleSearchNextBtn");
    const commitBtn = document.getElementById("subtitleSearchCommitBtn");

    if (wordInput) {
        wordInput.placeholder = dict.subtitleSearchWord || "Search word";
        wordInput.setAttribute("aria-label", dict.subtitleSearchWord || "Search word");
    }

    if (timeInput) {
        timeInput.placeholder = dict.subtitleSearchTime || "Time";
        timeInput.setAttribute("aria-label", dict.subtitleSearchTime || "Time");
    }

    if (prevBtn) {
        prevBtn.title = dict.subtitleSearchPrev || "Previous result";
        prevBtn.setAttribute("aria-label", dict.subtitleSearchPrev || "Previous result");
    }

    if (nextBtn) {
        nextBtn.title = dict.subtitleSearchNext || "Next result";
        nextBtn.setAttribute("aria-label", dict.subtitleSearchNext || "Next result");
    }

    if (commitBtn) {
        commitBtn.title = dict.subtitleSearchCommit || "Go to result";
        commitBtn.setAttribute("aria-label", dict.subtitleSearchCommit || "Go to result");
    }
}

function clearSearchMatches() {
    subtitleSearchMatches = [];
    subtitleSearchIndex = -1;

    renderSubtitles();
}

function setSearchMatches(matches, index = 0) {
    subtitleSearchMatches = Array.isArray(matches) ? matches : [];
    subtitleSearchIndex = subtitleSearchMatches.length ? index : -1;

    renderSubtitles();
    scrollToSearchMatch(getCurrentSearchMatch());
}

function findSubtitleTextMatches(query) {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) return [];

    const lowerQuery = cleanQuery.toLowerCase();
    const matches = [];

    subtitles.forEach((sub, subtitleIndex) => {
        const text = String(sub.text || "");
        const lowerText = text.toLowerCase();

        let fromIndex = 0;

        while (true) {
            const matchIndex = lowerText.indexOf(lowerQuery, fromIndex);

            if (matchIndex === -1) break;

            matches.push({
                type: "word",
                subtitleIndex,
                start: matchIndex,
                end: matchIndex + cleanQuery.length,
                query: cleanQuery
            });

            fromIndex = matchIndex + cleanQuery.length;
        }
    });

    return matches;
}

function parseSearchTime(value) {
    const raw = String(value || "").trim();

    if (!raw) return null;

    if (/^\d+(\.\d+)?$/.test(raw)) {
        return Number(raw);
    }

    const parts = raw.split(":").map(Number);

    if (parts.some((part) => Number.isNaN(part))) return null;

    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return null;
}

function findSubtitleByTime(seconds) {
    if (!Number.isFinite(seconds)) return -1;

    const exactIndex = subtitles.findIndex((sub) => {
        return seconds >= sub.start + globalSubDelay &&
            seconds <= sub.end + globalSubDelay;
    });

    if (exactIndex !== -1) return exactIndex;

    let bestIndex = -1;
    let bestDistance = Infinity;

    subtitles.forEach((sub, index) => {
        const distance = Math.abs((sub.start + globalSubDelay) - seconds);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function buildTimeSearchMatches(seconds) {
    const subtitleIndex = findSubtitleByTime(seconds);

    if (subtitleIndex < 0) return [];

    return [{
        type: "time",
        subtitleIndex,
        start: 0,
        end: 0,
        query: "",
        seconds
    }];
}

function activateTimeSearch({ commit = false } = {}) {
    const timeInput = document.getElementById("subtitleTimeSearchInput");
    const seconds = parseSearchTime(timeInput?.value);

    if (!Number.isFinite(seconds)) return;

    subtitleSearchMode = "time";
    subtitleSearchTimeSeconds = seconds;
    subtitleSearchQuery = "";

    const wordInput = document.getElementById("subtitleWordSearchInput");
    if (wordInput) wordInput.value = "";

    setSearchMatches(buildTimeSearchMatches(seconds));

    if (commit) {
        commitSearchMatch();
    }
}

function getCurrentSearchMatch() {
    if (!subtitleSearchMatches.length) return null;
    if (subtitleSearchIndex < 0) return null;

    return subtitleSearchMatches[subtitleSearchIndex] || null;
}

function scrollToSearchMatch(match) {
    if (!match) return;

    const el = sidebar.querySelector(
        `.subtitle[data-index="${match.subtitleIndex}"]`
    );

    if (!el) return;

    el.scrollIntoView({
        block: "center",
        behavior: "smooth"
    });
}

function goToSearchMatch(direction = 1) {
    if (!subtitleSearchMatches.length) {
        if (subtitleSearchMode === "word") {
            const wordInput = document.getElementById("subtitleWordSearchInput");
            subtitleSearchQuery = wordInput?.value || "";
            subtitleSearchMatches = findSubtitleTextMatches(subtitleSearchQuery);
        }

        if (subtitleSearchMode === "time") {
            const timeInput = document.getElementById("subtitleTimeSearchInput");
            const seconds = parseSearchTime(timeInput?.value);

            if (Number.isFinite(seconds)) {
                subtitleSearchTimeSeconds = seconds;
                subtitleSearchMatches = buildTimeSearchMatches(seconds);
            }
        }

        subtitleSearchIndex = subtitleSearchMatches.length ? 0 : -1;
    }

    if (!subtitleSearchMatches.length) return;

    subtitleSearchIndex += direction;

    if (subtitleSearchIndex >= subtitleSearchMatches.length) {
        subtitleSearchIndex = 0;
    }

    if (subtitleSearchIndex < 0) {
        subtitleSearchIndex = subtitleSearchMatches.length - 1;
    }

    const match = getCurrentSearchMatch();

    renderSubtitles();
    scrollToSearchMatch(match);
}

function commitSearchMatch() {
    const match = getCurrentSearchMatch();

    if (!match) return;

    const sub = subtitles[match.subtitleIndex];

    if (!sub) return;

    if (match.type === "time" && Number.isFinite(match.seconds)) {
        video.currentTime = match.seconds;
    } else {
        video.currentTime = sub.start + globalSubDelay;
    }

    video.pause();
    syncSubtitleStyle(match.subtitleIndex);

    subtitleSearchMatches = [];
    subtitleSearchIndex = -1;
    renderSubtitles();
}

function appendSubtitleTextWithSearchHighlight(container, text, idx) {
    const currentMatch = getCurrentSearchMatch();

    if (
        !currentMatch ||
        currentMatch.type !== "word" ||
        currentMatch.subtitleIndex !== idx
    ) {
        container.textContent = text;
        return;
    }

    const before = text.slice(0, currentMatch.start);
    const matched = text.slice(currentMatch.start, currentMatch.end);
    const after = text.slice(currentMatch.end);

    container.appendChild(document.createTextNode(before));

    const mark = document.createElement("span");
    mark.className = "subtitle-search-match";
    mark.textContent = matched;
    container.appendChild(mark);

    container.appendChild(document.createTextNode(after));
}

// rendering

function renderSubtitles() {
    initSubtitleSearchPanel();

    const list = document.getElementById("subtitleList");
    if (!list) return;

    list.innerHTML = "";
    subtitleElements = [];

    subtitles.forEach((sub, idx) => {
        const div = document.createElement("div");
        div.className = "subtitle";
        div.dataset.index = String(idx);

        const currentSearchMatch = getCurrentSearchMatch();

        if (currentSearchMatch?.subtitleIndex === idx) {
            div.classList.add("search-active");
        }

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
        appendSubtitleTextWithSearchHighlight(textContent, sub.text, idx);

        div.appendChild(timeContainer);
        div.appendChild(textContent);

        div.onclick = () => {
            clearSearchMatches();

            if (lastClickedSubtitleIdx === idx) {
                if (video.paused) {
                    video.play();
                } else {
                    video.pause();
                    video.currentTime = sub.start + globalSubDelay + 0.05;
                }
            } else {
                video.pause();
                lastClickedSubtitleIdx = idx;
                syncSubtitleStyle(idx);
                video.currentTime = sub.start + globalSubDelay + 0.05;

                renderSubtitleOverlay({
                    overlay,
                    text: sub.text,
                    highlighter: ankiSubtitleHighlighter
                });
            }

            updatePlayButton();
        };

        list.appendChild(div);
        subtitleElements.push({ div, sub });
    });
}

// navigation

function seekBySubtitle(offset) {
    if (!subtitles.length) return;

    clearSearchMatches();

    const t = video.currentTime;
    let currentIdx = subtitles.findIndex((s) => t >= s.start && t <= s.end);

    if (currentIdx === -1) {
        currentIdx = offset > 0
            ? subtitles.findIndex((s) => s.start > t)
            : subtitles.filter((s) => s.end < t).length - 1;
    } else {
        currentIdx += offset;
    }

    currentIdx = Math.max(0, Math.min(subtitles.length - 1, currentIdx));

    const targetSub = subtitles[currentIdx];

    video.pause();
    video.currentTime = targetSub.start + 0.05;

    renderSubtitleOverlay({
        overlay,
        text: targetSub.text,
        highlighter: ankiSubtitleHighlighter
    });

    syncSubtitleStyle(currentIdx);
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
