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

