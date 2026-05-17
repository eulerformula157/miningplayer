// parsing

function parseSRT(data) {
    data = data.replace(/\r/g, "").trim();
    const blocks = data.split("\n\n");
    const subs = [];

    for (const block of blocks) {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length < 3) continue;

        const match = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s-->\s(\d+):(\d+):(\d+),(\d+)/);
        if (!match) continue;

        const start = +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
        const end = +match[5] * 3600 + +match[6] * 60 + +match[7] + +match[8] / 1000;
		const rawText = lines.slice(2).map((l) => l.trim()).join(" ");

		// Пропускаем верхние субтитры типа {\an8}
		if (/\{\\an8\}/.test(rawText)) continue;

		// На всякий случай чистим остальные ASS/SRT override-теги
		const text = rawText
			.replace(/\{\\.*?\}/g, "")
			.trim();

		if (text) {
			subs.push({ start, end, text });
		}
    }

    return subs;
}

function parseASS(data) {
    const lines = data.split("\n");
    const subs = [];

    const timeToSeconds = (timeStr) => {
        const parts = timeStr.trim().split(":");
        return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    };

    lines.forEach((line) => {
        if (!line.startsWith("Dialogue:")) return;

        const parts = line.split(",");
        if (parts.length < 10) return;

        const start = timeToSeconds(parts[1]);
        const end = timeToSeconds(parts[2]);
        const text = parts.slice(9).join(",")
            .replace(/\{.*?\}/g, "")
            .replace(/\\N/g, "\n")
            .replace(/\\n/g, " ")
            .replace(/\\h/g, " ")
            .trim();

        if (text) subs.push({ start, end, text });
    });

    return subs;
}

function formatTime(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;

    const minutes = Math.floor(t / 60);
    const seconds = Math.floor(t % 60);
    const milliseconds = Math.floor((t % 1) * 1000);

    return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

// state helpers

function getCurrentSubtitle() {
    const t = video.currentTime - globalSubDelay;
    return subtitles.find((s) => t >= s.start && t <= s.end);
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

// overlay rendering

function clearSubtitleOverlay(overlayEl) {
    if (!overlayEl) return;
    overlayEl.textContent = "";
}

function getSubtitleStatusSettings(highlighter, status) {
    if (!highlighter || !highlighter.statusSettings) return null;
    return highlighter.statusSettings[status] || null;
}

function appendPlainSubtitleText(overlayEl, text) {
    overlayEl.textContent = text || "";
}

function appendHighlightedToken(overlayEl, token, status, settings) {
    const span = document.createElement("span");
    span.className = `subtitle-word subtitle-word-${status || "unknown"}`;
    span.textContent = token;

    if (settings?.color) {
        span.style.color = settings.color;
    }

    overlayEl.appendChild(span);
}

function tokenizeSubtitleForHighlighting(text) {
    return String(text || "").match(/(\s+|[^\s]+)/g) || [];
}

function renderHighlightedSubtitleOverlay(overlayEl, text, highlighter) {
    if (typeof highlighter.findMatchesInText === "function") {
        renderMatchedSubtitleOverlay(overlayEl, text, highlighter);
        return;
    }

    const tokens = tokenizeSubtitleForHighlighting(text);

    for (const token of tokens) {
        const isWhitespace = /^\s+$/.test(token);

        if (isWhitespace) {
            overlayEl.appendChild(document.createTextNode(token));
            continue;
        }

        const status = highlighter.getStatusForTextToken?.(token) || "unknown";
        const settings = getSubtitleStatusSettings(highlighter, status);

        if (!settings || settings.enabled === false) {
            overlayEl.appendChild(document.createTextNode(token));
            continue;
        }

        appendHighlightedToken(overlayEl, token, status, settings);
    }
}

function renderMatchedSubtitleOverlay(overlayEl, text, highlighter) {
    const matches = highlighter.findMatchesInText(text) || [];

    if (!matches.length) {
        appendPlainSubtitleText(overlayEl, text);
        return;
    }

    let cursor = 0;

    for (const match of matches) {
        if (match.start < cursor) continue;

        if (match.start > cursor) {
            overlayEl.appendChild(
                document.createTextNode(text.slice(cursor, match.start))
            );
        }

        const matchedText = text.slice(match.start, match.end);
        const settings = getSubtitleStatusSettings(highlighter, match.status);

        if (!settings || settings.enabled === false) {
            overlayEl.appendChild(document.createTextNode(matchedText));
        } else {
            appendHighlightedToken(
                overlayEl,
                matchedText,
                match.status,
                settings
            );
        }

        cursor = match.end;
    }

    if (cursor < text.length) {
        overlayEl.appendChild(document.createTextNode(text.slice(cursor)));
    }
}

function renderSubtitleOverlay(options) {
    const overlay = options.overlay;
    const text = options.text;
    const highlighter = options.highlighter || null;

    if (!overlay) return;

    clearSubtitleOverlay(overlay);

    if (!text) return;

    if (!highlighter || highlighter.enabled !== true) {
        appendPlainSubtitleText(overlay, text);
        return;
    }

    renderHighlightedSubtitleOverlay(overlay, text, highlighter);
}