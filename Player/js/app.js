const {
    video,
    sidebar,
    multiInput,
    fullscreenBtn,
    settingsBtn,
    settingsModal,
    closeSettingsBtn,
    dropzone,
    toggleBtn,
    overlay,
    deleteVideoBtn,
    playPause,
    progress,
    timeLabel,
    videoContainer,
    controls,
    ankiAllBtn,
    targetNoteSelect,
    audioTrackSelect,
    fontSizeRange,
    subtitleOverlay,
    resizer,
    videoPickerModal,
    videoPickerList,
    videoPickerCancelBtn,
    addKnownBasicBtn,
    addCardToDeck,
    volume
} = dom;


video.volume = volume.value;

video.addEventListener("timeupdate", () => {
    const sub = getCurrentSubtitle();

    if (sub?.text && sub.text !== lastRuntimeSubtitleText) {
        lastRuntimeSubtitleText = sub.text;

        ensureStatusesForSubtitleText(sub.text).catch((err) => {
            console.warn("Runtime subtitle status lookup failed:", err);
        });
    }

	if (sub) {
		const currentSubtitleIndex = subtitles.indexOf(sub);

		if (currentSubtitleIndex !== -1) {
			const windowSize =
				runtimePrefetchWindowEnd - runtimePrefetchWindowStart + 1;

			const halfPoint =
				runtimePrefetchWindowStart + Math.floor(windowSize / 2);

			const shouldPrefetchNextWindow =
				runtimePrefetchWindowStart !== -1 &&
				runtimePrefetchWindowEnd !== -1 &&
				currentSubtitleIndex >= halfPoint &&
				runtimeNextPrefetchStart < subtitles.length &&
				!runtimePrefetchAllInProgress;

			if (shouldPrefetchNextWindow) {
				console.log(
					`Runtime next window trigger: current=${currentSubtitleIndex}, next=${runtimeNextPrefetchStart}`
				);

				prefetchRuntimeStatusesForAllSubtitles({
					silent: true,
					startIndex: runtimeNextPrefetchStart
				});
			}
		}
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

	const currentSearchMatch = getCurrentSearchMatch?.();

	if (currentSearchMatch && !video.paused) {
		const currentSubtitleIndex = subtitles.findIndex((s) => {
			const t = video.currentTime - globalSubDelay;
			return t >= s.start && t <= s.end;
		});

		if (
			currentSubtitleIndex !== -1 &&
			currentSubtitleIndex !== currentSearchMatch.subtitleIndex
		) {
			clearSearchMatches?.();
		}
	}
	
});

async function getKnownBasicDictionaryForm(rawWord) {
    const selected = String(rawWord || "").trim();

    if (!selected) return "";

    if (typeof tokenizeJapaneseText !== "function") {
        console.warn("tokenizeJapaneseText is not available");
        return selected;
    }

    try {
        const tokens = await tokenizeJapaneseText(selected);

        if (!Array.isArray(tokens) || !tokens.length) {
            return selected;
        }

        const meaningfulTokens = tokens.filter((token) => {
            const surface = String(token.surface_form || "").trim();

            if (!surface) return false;

            const pos = String(token.pos || "");
            return !["記号", "助詞", "助動詞"].includes(pos);
        });

        if (!meaningfulTokens.length) {
            return selected;
        }

        // Нормализуем только если выделение — один глагол:
        // 食べた -> 食べる
        // 見ました -> 見る
        if (meaningfulTokens.length === 1) {
            const token = meaningfulTokens[0];
            const pos = String(token.pos || "");

            if (pos === "動詞") {
                const basic = String(token.basic_form || "").trim();

                if (basic && basic !== "*") {
                    return basic;
                }
            }
        }

        // Всё остальное сохраняем как выделено
        return selected;
    } catch (err) {
        console.warn("Known-basic dictionary form lookup failed:", err);
        return selected;
    }
}

async function addWordToKnownBasic(word) {
    const originalWord = String(word || "").trim();
    const cleanWord = await getKnownBasicDictionaryForm(originalWord);

		if (!cleanWord) {
			showToast(t("toastNoWordSelected"), "error", 3000);
			return;
		}

    try {
        const { response, data } = await apiJson("/known-basic-words/add", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                word: cleanWord
            })
        });

        if (!response.ok || data.error) {
            throw new Error(data.error || "Could not add word");
        }

        markKnownBasicWordAsMature(cleanWord);

        window.getSelection()?.removeAllRanges();
        hideAddKnownBasicButton();

        if (data.added) {
			if (originalWord && originalWord !== cleanWord) {
				showToast(`Added to known-basic: ${originalWord} → ${cleanWord}`, "success", 3000);
			} else {
				showToast(`Added to known-basic: ${cleanWord}`, "success", 3000);
			}
        } else {
            showToast(t("toastKnownBasicAlreadyExists", { word: cleanWord }), "info", 3000);
        }

    } catch (err) {
        console.error("Known-basic add failed:", err);
        showToast(t("toastKnownBasicAddFailed", { message: err.message }), "error", 6000);
    }
}

async function copyWordForYomitan(word) {
    const cleanWord = String(word || "").trim();

    if (!cleanWord) {
        showToast(t("toastCopiedForYomitan", { word: cleanWord }), "success", 3000);
        return;
    }

    try {
        await navigator.clipboard.writeText(cleanWord);
        showToast(`Copied for Yomitan: ${cleanWord}`, "success", 3000);
    } catch (err) {
        console.error("Copy for Yomitan failed:", err);
        showToast(t("toastCopyFailed", { message: err.message }), "error", 5000);
    }
}

function markKnownBasicWordAsMature(word) {
    if (typeof addRuntimeKnownBasicWord === "function") {
        addRuntimeKnownBasicWord(word);
    }

    const sub = getCurrentSubtitle?.();

    renderSubtitleOverlay({
        overlay,
        text: sub ? sub.text : "",
        highlighter: ankiSubtitleHighlighter
    });
}

async function prefetchRuntimeStatusesForAllSubtitles({
    silent = true,
    startIndex = null
} = {}) {
    if (!Array.isArray(subtitles) || !subtitles.length) return;
    if (runtimePrefetchAllInProgress) return;

    const runId = ++runtimePrefetchAllRunId;
    runtimePrefetchAllInProgress = true;
    runtimeHighlightPrefetchReady = false;

    const chunkSize = 100;
    const chunkDelayMs = 50;
    const subtitleWindowSize = 20;

    try {
        await loadKnownBasicWords?.();

        if (typeof getJapaneseTokenizer === "function") {
            await getJapaneseTokenizer();
        }

        let currentIdx = Number.isInteger(startIndex)
            ? startIndex
            : subtitles.indexOf(getCurrentSubtitle?.());

        if (currentIdx < 0) currentIdx = 0;

        const startIdx = Math.max(0, currentIdx);
        const endIdx = Math.min(
            subtitles.length - 1,
            startIdx + subtitleWindowSize - 1
        );

        runtimePrefetchWindowStart = startIdx;
        runtimePrefetchWindowEnd = endIdx;
        runtimeNextPrefetchStart = endIdx + 1;

        const subtitlesToPrefetch = subtitles.slice(startIdx, endIdx + 1);

        console.log(
            `Runtime window prefetch: subtitles ${startIdx}-${endIdx} / ${subtitles.length}`
        );

        const allCandidates = new Set();

        for (let i = 0; i < subtitlesToPrefetch.length; i += 1) {
            if (runId !== runtimePrefetchAllRunId) return;

            const text = subtitlesToPrefetch[i]?.text;
            if (!text) continue;

            const candidates = collectSubtitleCandidates(text);

            for (const candidate of candidates) {
                if (!ankiRuntimeWordStatusMap.has(candidate)) {
                    allCandidates.add(candidate);
                }
            }
        }

        const candidates = [...allCandidates];

        console.log(`Runtime batch prefetch started: ${candidates.length} candidates`);

        for (let i = 0; i < candidates.length; i += chunkSize) {
            if (runId !== runtimePrefetchAllRunId) return;

            const chunk = candidates.slice(i, i + chunkSize);

            console.log(
                `Runtime batch prefetch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(candidates.length / chunkSize)}: ${chunk.length}`
            );

            await ensureStatusesForCandidates(chunk, { silent: true });

            await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
        }

        if (runId === runtimePrefetchAllRunId) {
            runtimeHighlightPrefetchReady = true;
            console.log("Runtime window prefetch finished");
            rerenderCurrentSubtitleWithAnkiHighlighter?.();
        }
    } catch (err) {
        console.warn("Runtime batch prefetch failed:", err);
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


document.getElementById("clickToUpload").onclick = () => multiInput.click();
multiInput.addEventListener("change", (e) => handleFiles(e.target.files));

dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
});
dropzone.addEventListener("dragover", (e) => e.preventDefault());

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

async function fetchDeckNoteIds(ankiUrl, deckName) {
	const findRes = await fetchWithRetry(ankiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			action: "findNotes",
			version: 6,
			params: {
				query: `deck:"${deckName}"`
			}
		})
	}, {
		retries: 500,
		delayMs: 1000,
		label: "AnkiConnect findNotes"
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

function isKanaOnly(text) {
    return /^[\u3040-\u309f\u30a0-\u30ffー]+$/.test(String(text || ""));
}

function hasKanji(text) {
    return /[\u3400-\u9fff]/.test(String(text || ""));
}

function escapeAnkiFieldText(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function splitKanjiStemAndKanaTail(surface, readingHiragana) {
    const match = String(surface || "").match(/^(.+?)([\u3040-\u309f]+)$/);

    if (!match) {
        return {
            stem: surface,
            tail: "",
            stemReading: readingHiragana
        };
    }

    const stem = match[1];
    const tail = match[2];

    if (!hasKanji(stem)) {
        return {
            stem: surface,
            tail: "",
            stemReading: readingHiragana
        };
    }

    if (readingHiragana.endsWith(tail)) {
        return {
            stem,
            tail,
            stemReading: readingHiragana.slice(0, -tail.length)
        };
    }

    return {
        stem: surface,
        tail: "",
        stemReading: readingHiragana
    };
}

function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boldWordInText(text, word) {
    const source = String(text || "");
    const target = stripHtml(word);

    if (!target) return source;

    const pattern = new RegExp(`${escapeRegExp(target)}(\\[[^\\]]+\\])?`, "g");

    return source.replace(pattern, (match) => {
        return `<b>${match}</b>`;
    });
}

function getNoteWord(noteInfo) {
    const fields = noteInfo?.fields || {};
    const wordFieldNames = (
        document.getElementById("highlightWordField")?.value || "Word"
    )
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

    for (const fieldName of wordFieldNames) {
        const word = stripHtml(fields[fieldName]?.value);
        if (word) return word;
    }

    return "";
}

async function buildSentenceFurigana(text) {
    const source = String(text || "");

    if (!source) return "";

    if (typeof tokenizeJapaneseText !== "function") {
        console.warn("tokenizeJapaneseText is not available");
        return source;
    }

    const tokens = await tokenizeJapaneseText(source);
    let result = "";
    let lastEnd = 0;

    for (const token of tokens) {
        const surface = token.surface_form || "";
        const reading = token.reading || "";

        if (!surface) continue;

        const start = Math.max(0, Number(token.word_position || 1) - 1);
        const end = start + surface.length;

        // preserve spaces / punctuation between tokens
        if (start > lastEnd) {
            result += source.slice(lastEnd, start);
        }

		const previousChar = result.slice(-1);
		const shouldAddSpaceBeforeKanjiWord =
			hasKanji(surface) &&
			result &&
			previousChar &&
			!/\s/.test(previousChar) &&
			!/[（(「『【［]/.test(previousChar);

		if (shouldAddSpaceBeforeKanjiWord) {
			result += " ";
		}

        if (!hasKanji(surface) || !reading) {
            result += surface;
            lastEnd = end;
            continue;
        }

        const hiraganaReading = katakanaToHiragana(reading);
        const { stem, tail, stemReading } = splitKanjiStemAndKanaTail(surface, hiraganaReading);

        if (!stemReading) {
            result += surface;
            lastEnd = end;
            continue;
        }

        result += `${stem}[${stemReading}]${tail}`;
        lastEnd = end;
    }

    if (lastEnd < source.length) {
        result += source.slice(lastEnd);
    }

    return result;
}

function katakanaToHiragana(text) {
    return String(text || "").replace(/[\u30a1-\u30f6]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0x60);
    });
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
	const res = await fetchWithRetry(ankiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			action: "notesInfo",
			version: 6,
			params: {
				notes: noteIds
			}
		})
	}, {
		retries: 500,
		delayMs: 1000,
		label: "AnkiConnect notesInfo"
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

function maybePromptSubtitleDepthReset() {
    if (isSubtitleContextDepthDefault()) return;

    showActionToast(
        t("toastResetSubtitleDepthQuestion"),
        [
            {
                label: t("toastResetSubtitleDepthYes"),
                onClick: () => {
                    resetSubtitleContextDepths();
                }
            },
            {
                label: t("toastResetSubtitleDepthNo")
            }
        ],
        "info",
        0
    );
}

ankiAllBtn.onclick = async () => {
	
	const initialVideoPayload = getCurrentVideoPayload();

	if (!initialVideoPayload) {
		showToast(t("toastVideoNotUploaded"), "error", 4000);
		return;
	}

    const offsetStart = parseFloat(document.getElementById("subOffsetStart").value) || 0;
    const offsetEnd = parseFloat(document.getElementById("subOffsetEnd").value) || 0;
    const volumeLevel = getValidatedVolume();
    const ankiUrl = document.getElementById("ankiUrl").value;
    const deckName = document.getElementById("deckName").value;
    const screenshotMode = document.getElementById("screenshotMode").value;

    const sentenceField = document.getElementById("sentenceField").value.trim();
    const pictureField = document.getElementById("pictureField").value.trim();
    const audioField = document.getElementById("audioField").value.trim();
	const sentenceFuriganaField = document.getElementById("sentenceFuriganaField")?.value.trim();

	if (!pictureField || !audioField) {
	  showToast(t("toastRequiredFields"), "error", 4000);
	  return;
	}

    const currentIdx = subtitles.findIndex((s) => {
        return (video.currentTime - globalSubDelay) >= s.start &&
            (video.currentTime - globalSubDelay) <= s.end;
    });

	if (currentIdx === -1) {
	  showToast(t("toastNoActiveSubtitle"), "error", 4000);
	  return;
	}

    let targetTime;

    if (screenshotMode === "current") {
        targetTime = video.currentTime;
    } else {
        targetTime = Math.max(0, subtitles[currentIdx].start + offsetStart);
    }

	const contextSelection = getSubtitleContextSelection(currentIdx);

	const audioStart = Math.max(
		0,
		contextSelection.startTime + globalSubDelay + offsetStart
	);

	let audioEnd = contextSelection.endTime + globalSubDelay + offsetEnd;

	if (audioEnd <= audioStart) audioEnd = audioStart + 0.5;

	const combinedText = contextSelection.text;
		
	

    const includeImageSubtitle = document.getElementById("includeImageSubtitle")?.checked !== false;
    const imageSubtitleText = includeImageSubtitle ? combinedText : "";

    try {
		
		const videoPayload = getCurrentVideoPayload();

		if (!videoPayload) {
			showToast("Video is not selected", "error", 6000);
			return;
		}		
				
        const pictureEndpoint = screenshotMode === "webp"
            ? "/animated-webp"
            : "/screenshot";

		const picturePayload = screenshotMode === "webp"
			? {
				...videoPayload,
				start: audioStart,
				end: audioEnd,
				text: imageSubtitleText,
				fontSize: document.getElementById("fontSizeRange").value
			}
			: {
				...videoPayload,
				time: targetTime,
				text: imageSubtitleText,
				fontSize: document.getElementById("fontSizeRange").value
			};

		console.log("picturePayload", pictureEndpoint, picturePayload);

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
					...videoPayload,
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
		const [targetNoteInfo] = await fetchNotesInfo(ankiUrl, [targetNoteId]);
		const targetWord = getNoteWord(targetNoteInfo);

		const combinedTextForAnki = targetWord
			? boldWordInText(combinedText, targetWord)
			: combinedText;

		let combinedTextFuriganaForAnki = "";

		if (sentenceFuriganaField) {
			try {
				combinedTextFuriganaForAnki = boldWordInText(
					await Promise.race([
						buildSentenceFurigana(combinedText),
						new Promise((_, reject) => {
							setTimeout(() => {
								reject(new Error("Furigana generation timeout"));
							}, 1500);
						})
					]),
					targetWord
				);
			} catch (err) {
				console.warn("Furigana generation skipped:", err);
				combinedTextFuriganaForAnki = "";
			}
		}


		const updateController = new AbortController();
		const updateTimeoutId = setTimeout(() => {
			updateController.abort();
		}, 5000);

		let updateRes;

		try {
			updateRes = await fetch(ankiUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: updateController.signal,
				body: JSON.stringify({
					action: "updateNoteFields",
					version: 6,
					params: {
						note: {
							id: targetNoteId,
							fields: (() => {
								const fieldsToUpdate = {};

								if (sentenceField) {
									fieldsToUpdate[sentenceField] = combinedTextForAnki;
								}

								if (sentenceFuriganaField) {
									fieldsToUpdate[sentenceFuriganaField] = combinedTextFuriganaForAnki;
								}

								fieldsToUpdate[pictureField] = `<img src="${sName}">`;
								fieldsToUpdate[audioField] = `[sound:${aName}]`;

								return fieldsToUpdate;
							})()
						}
					}
				})
			});
		} finally {
			clearTimeout(updateTimeoutId);
		}

		const updateData = await updateRes.json();

		if (!updateRes.ok || updateData.error) {
			throw new Error(updateData.error || `Anki update failed: HTTP ${updateRes.status}`);
		}
				
		runtimePrefetchWindowStart = -1;
		runtimePrefetchWindowEnd = -1;
		runtimeNextPrefetchStart = 0;
		runtimeHighlightPrefetchReady = false;

		clearRuntimeWordStatuses?.();

		ensureStatusesForSubtitleText(combinedText)
			.then(() => {
				prefetchRuntimeStatusesForAllSubtitles({ silent: true });
			})
			.catch((err) => {
				console.warn("Could not update runtime highlight status:", err);
			});

		showToast(t("toastCardUpdated"), "success");

		if (targetNoteSelect) targetNoteSelect.value = "";

		refreshTargetNoteList({ preserveSelection: false });
		maybePromptSubtitleDepthReset();
		
	} catch (err) {
	  console.error("Update error:", err);
	  showToast(t("toastError", { message: err.message }), "error", 6000);
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
	rerenderCurrentSubtitleWithAnkiHighlighter?.();
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
		runtimeHighlightPrefetchReady = false;
		prefetchRuntimeStatusesForAllSubtitles({ silent: true });

		runtimePrefetchWindowStart = -1;
		runtimePrefetchWindowEnd = -1;
		runtimeNextPrefetchStart = 0;
		runtimeHighlightPrefetchReady = false;

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
	initSubtitleSidebar();

	loadLibraryEpisodeFromUrl()
		.then((loadedFromLibrary) => {
			if (!loadedFromLibrary) {
				restoreCurrentVideoFromServer();
			}
		});

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
	
		runtimePrefetchWindowStart = -1;
		runtimePrefetchWindowEnd = -1;
		runtimeNextPrefetchStart = 0;
		runtimeHighlightPrefetchReady = false;

		clearRuntimeWordStatuses?.();
		
    const sub = getCurrentSubtitle?.();

    if (sub?.text) {
		ensureStatusesForSubtitleText(sub.text).catch((err) => {
		  console.error("Runtime Anki highlighter failed:", err);
		  showToast(t("toastRuntimeHighlighterFailed", { message: err.message }), "error", 6000);
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

addKnownBasicBtn?.addEventListener("mousedown", (e) => {
    e.preventDefault();
});

addKnownBasicBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await addWordToKnownBasic(selectedKnownBasicWord);
});

addCardToDeck?.addEventListener("mousedown", (e) => {
    e.preventDefault();
});

addCardToDeck?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await copyWordForYomitan(selectedKnownBasicWord);
});

document.addEventListener("mousedown", (e) => {
    if (
        addKnownBasicBtn?.contains(e.target) ||
        addCardToDeck?.contains(e.target)
    ) {
        return;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) {
        hideAddKnownBasicButton();
    }
});

videoPickerCancelBtn?.addEventListener("click", () => {
    videoPickerModal?.classList.add("hidden");
    dropzone.classList.remove("hidden");
});

document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        hideAddKnownBasicButton();
        return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    const anchorElement = anchorNode?.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode;

    const focusElement = focusNode?.nodeType === Node.TEXT_NODE
        ? focusNode.parentElement
        : focusNode;

    const isSubtitleSelection =
        overlay?.contains(anchorElement) ||
        overlay?.contains(focusElement);

    if (!isSubtitleSelection) {
        hideAddKnownBasicButton();
        return;
    }

    requestAnimationFrame(() => {
        showAddKnownBasicButtonForSelection();
    });
});



