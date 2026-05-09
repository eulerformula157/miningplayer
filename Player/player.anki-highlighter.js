const ankiRuntimeWordStatusMap = new Map();

let knownBasicWordsLoaded = false;

function clearRuntimeWordStatuses() {
    ankiRuntimeWordStatusMap.clear();
    knownBasicWordsLoaded = false;
}

function getCardStatus(card) {
    if (card.queue === -1) return "suspended";
    if (card.type === 0) return "new";
    if (card.type === 1 || card.queue === 1 || card.queue === 3) return "learning";

    const interval = Number(card.interval ?? card.ivl ?? 0);
    if (interval >= 21) return "mature";

    return "young";
}

function pickBetterStatus(oldStatus, newStatus) {
    const priority = {
        mature: 5,
        young: 4,
        learning: 3,
        new: 2,
        suspended: 1,
        unknown: 0
    };

    if (!oldStatus) return newStatus;
    return priority[newStatus] > priority[oldStatus] ? newStatus : oldStatus;
}

async function ankiRequest(ankiUrl, action, params = {}) {
    const res = await fetch(ankiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action,
            version: 6,
            params
        })
    });

    const data = await res.json();

    if (data.error) {
        throw new Error(data.error);
    }

    return data.result;
}

function normalizeHighlightWord(value) {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getHighlightWordFieldNames() {
    const raw = document.getElementById("highlightWordField")?.value || "Word";

    return raw
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
}

function getHighlightDeckNames() {
    const raw = document.getElementById("highlightDeckNames")?.value
        || document.getElementById("deckName")?.value
        || "";

    return raw
        .split(",")
        .map((deck) => deck.trim())
        .filter(Boolean);
}

function escapeAnkiSearchValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function buildCurrentDeckQuery() {
    const deckNames = getHighlightDeckNames();

    return deckNames
        .map((deck) => `deck:"${escapeAnkiSearchValue(deck)}"`)
        .join(" OR ");
}

async function loadKnownBasicWords({ force = false } = {}) {
    if (knownBasicWordsLoaded && !force) return;

    try {
        const { response, data } = await apiJson("/known-basic-words");

        if (!response.ok || data.error) {
            throw new Error(data.error || "Known basic words load failed");
        }

        const words = Array.isArray(data.words) ? data.words : [];

        for (const rawWord of words) {
            const word = normalizeHighlightWord(rawWord);
            if (!word) continue;

            const prev = ankiRuntimeWordStatusMap.get(word);

            ankiRuntimeWordStatusMap.set(word, {
                ...(prev || {}),
                status: pickBetterStatus(prev?.status, "mature"),
                source: "known-basic"
            });
        }

        knownBasicWordsLoaded = true;
        console.log(`Known basic words loaded: ${words.length}`);
    } catch (err) {
        console.warn("Known basic words load failed:", err);
    }
}

function normalizeJapaneseNumberText(value) {
    return String(value || "")
        .replace(/[０-９]/g, (ch) =>
            String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
        );
}

function addCandidate(candidates, value) {
    const normalized = normalizeHighlightWord(normalizeJapaneseNumberText(value));

    if (normalized && normalized !== "*") {
        candidates.push(normalized);
    }
}



function getJapaneseTokenCandidates(token) {
    const surface = String(token.surface_form || "");
    const basic = String(token.basic_form || "");
    const candidates = [];

    function add(value) {
        const normalized = normalizeHighlightWord(normalizeJapaneseNumberText(value));

        if (normalized && normalized !== "*") {
            candidates.push(normalized);
        }
    }

	function addGodanPotentialCandidates(value) {
		const eToDictionary = {
			え: "う",
			け: "く",
			げ: "ぐ",
			せ: "す",
			て: "つ",
			ね: "ぬ",
			べ: "ぶ",
			め: "む",
			れ: "る"
		};

		let stem = "";

		if (value.endsWith("る")) {
			stem = value.slice(0, -1); // 支払える -> 支払え
		} else {
			stem = value;
		}

		const last = stem.slice(-1);
		const base = stem.slice(0, -1);
		const ending = eToDictionary[last];

		if (ending) {
			add(base + ending);
		}
	}

    function addGodanConditionalCandidates(value) {
        // 言えば -> 言う
        // 書けば -> 書く
        // 読めば -> 読む
        // 話せば -> 話す
        if (!value.endsWith("えば")) return;

        const stem = value.slice(0, -2);

        const eToDictionary = {
            え: "う",
            け: "く",
            げ: "ぐ",
            せ: "す",
            て: "つ",
            ね: "ぬ",
            べ: "ぶ",
            め: "む",
            れ: "る"
        };

        const last = stem.slice(-1);
        const base = stem.slice(0, -1);
        const ending = eToDictionary[last];

        if (ending) {
            add(base + ending);
        }
    }

    add(surface);
    add(basic);

    addGodanPotentialCandidates(surface);
    addGodanPotentialCandidates(basic);

    addGodanConditionalCandidates(surface);
    addGodanConditionalCandidates(basic);

    if (surface.endsWith("まない")) {
        add(surface.slice(0, -3) + "む");
    }

    if (surface.endsWith("まなかった")) {
        add(surface.slice(0, -5) + "む");
    }

    return [...new Set(candidates)];
}

function isVerbChainTailToken(token) {
    if (!token) return false;

    const surface = token.surface_form || "";
    const basic = token.basic_form || "";
    const pos = token.pos || "";
    const posDetail1 = token.pos_detail_1 || "";

    if (pos === "助動詞") return true;
    if (pos === "助詞" && ["て", "で", "たら", "ても", "でも", "ば", "える"].includes(surface)) return true;

    if (pos === "動詞" && ["しまう", "いる", "ある", "くれる", "もらう", "くださる"].includes(basic)) {
        return true;
    }

    if (pos === "動詞" && posDetail1 === "接尾") return true;

    return false;
}

function buildJapaneseHighlightSpans(tokens) {
    const spans = [];

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        const start = Math.max(0, Number(token.word_position || 1) - 1);
        const surface = String(token.surface_form || "");
        const end = start + surface.length;

		if (token.pos !== "助詞" || surface.length > 1) {
			spans.push({
				start,
				end,
				surface,
				candidates: getJapaneseTokenCandidates(token)
			});
		}

        if (token.pos !== "動詞") continue;

        let chainEnd = end;
        let chainSurface = surface;
        const candidates = getJapaneseTokenCandidates(token);

        let j = i + 1;

        while (j < tokens.length && isVerbChainTailToken(tokens[j])) {
            const next = tokens[j];
            const nextSurface = String(next.surface_form || "");

            chainSurface += nextSurface;
            chainEnd += nextSurface.length;
			candidates.push(...getJapaneseTokenCandidates(next));

            j += 1;
        }

        if (j > i + 1) {
			candidates.push(...getJapaneseTokenCandidates({
				surface_form: chainSurface,
				basic_form: chainSurface
			}));			
			
            spans.push({
                start,
                end: chainEnd,
                surface: chainSurface,
                candidates: [...new Set(candidates)]
            });
        }
    }
	
	spans.push(...buildJapaneseCompoundSpans(tokens));
	
    return spans;
}

function buildJapaneseCompoundSpans(tokens) {
    const spans = [];
    const maxWindowSize = 2;

    for (let i = 0; i < tokens.length; i += 1) {
        let surface = "";
        const firstToken = tokens[i];
        const start = Math.max(0, Number(firstToken.word_position || 1) - 1);

        for (let j = i; j < Math.min(tokens.length, i + maxWindowSize); j += 1) {
            const token = tokens[j];
            const tokenSurface = String(token.surface_form || "");

            if (!tokenSurface.trim()) break;

            surface += tokenSurface;

            if (j === i) continue;

            const candidate = normalizeHighlightWord(surface);

            if (!candidate || candidate === "*") continue;

            spans.push({
                start,
                end: start + surface.length,
                surface,
                candidates: [candidate]
            });
        }
    }

    return spans;
}

function collectSubtitleCandidates(text) {
    const source = String(text || "");
    const tokens = tokenizeJapaneseTextSync?.(source);

    if (!tokens) return [];

    const spans = buildJapaneseHighlightSpans(tokens);
    const candidates = new Set();

    for (const span of spans) {
        for (const rawCandidate of span.candidates || []) {
            const candidate = normalizeHighlightWord(rawCandidate);

            if (candidate && candidate !== "*") {
                candidates.add(candidate);
            }
        }
    }

    return [...candidates];
}

async function ensureStatusesForSubtitleText(text, { rerender = true, silent = false } = {}) {
    const ankiUrl = document.getElementById("ankiUrl")?.value?.trim();
    const wordFields = getHighlightWordFieldNames();
    const deckQuery = buildCurrentDeckQuery();

    await loadKnownBasicWords();

    if (!ankiUrl || !deckQuery || !wordFields.length || !text) {
        if (rerender) rerenderCurrentSubtitleWithAnkiHighlighter();
        return;
    }

    if (typeof getJapaneseTokenizer === "function") {
        await getJapaneseTokenizer();
    }

    const candidates = collectSubtitleCandidates(text)
        .filter((candidate) => !ankiRuntimeWordStatusMap.has(candidate));

    if (!candidates.length) {
        if (rerender) rerenderCurrentSubtitleWithAnkiHighlighter();
        return;
    }

    if (!silent) {
        console.log("Runtime highlighter candidates:", candidates);
    }

    const fieldQueries = [];

    for (const candidate of candidates) {
        const escapedCandidate = escapeAnkiSearchValue(candidate);

        for (const fieldName of wordFields) {
            fieldQueries.push(`${fieldName}:"${escapedCandidate}"`);
        }
    }

    const query = `(${deckQuery}) (${fieldQueries.join(" OR ")})`;

    const cardIds = await ankiRequest(
        ankiUrl,
        "findCards",
        { query }
    );

    if (!cardIds.length) {
        for (const candidate of candidates) {
            ankiRuntimeWordStatusMap.set(candidate, {
                status: "unknown",
                source: "runtime-anki-miss"
            });
        }

        if (rerender) rerenderCurrentSubtitleWithAnkiHighlighter();
        return;
    }

    const cardsInfo = await ankiRequest(
        ankiUrl,
        "cardsInfo",
        { cards: cardIds }
    );

    const noteStatusMap = new Map();

    for (const card of cardsInfo) {
        const noteId = String(card.note);
        const status = getCardStatus(card);
        const prev = noteStatusMap.get(noteId);

        noteStatusMap.set(noteId, pickBetterStatus(prev, status));
    }

    const noteIds = [...noteStatusMap.keys()].map(Number);

    const notesInfo = await ankiRequest(
        ankiUrl,
        "notesInfo",
        { notes: noteIds }
    );

    const candidateSet = new Set(candidates);
    const foundCandidates = new Set();

    for (const note of notesInfo) {
        const status = noteStatusMap.get(String(note.noteId)) || "unknown";

        for (const fieldName of wordFields) {
            const word = normalizeHighlightWord(note.fields?.[fieldName]?.value);

            if (!word || !candidateSet.has(word)) continue;

            ankiRuntimeWordStatusMap.set(word, {
                status,
                noteId: Number(note.noteId),
                source: "runtime-anki"
            });

            foundCandidates.add(word);
        }
    }

    for (const candidate of candidates) {
        if (!foundCandidates.has(candidate)) {
            ankiRuntimeWordStatusMap.set(candidate, {
                status: "unknown",
                source: "runtime-anki-miss"
            });
        }
    }

    if (!silent) {
        console.log(
            `Runtime highlighter loaded ${foundCandidates.size}/${candidates.length} subtitle words`
        );
    }

    if (rerender) {
        rerenderCurrentSubtitleWithAnkiHighlighter();
    }
}

function rerenderCurrentSubtitleWithAnkiHighlighter() {
    if (typeof getCurrentSubtitle !== "function") return;
    if (typeof renderSubtitleOverlay !== "function") return;
    if (typeof overlay === "undefined") return;

    const sub = getCurrentSubtitle();

    renderSubtitleOverlay({
        overlay,
        text: sub ? sub.text : "",
        highlighter: ankiSubtitleHighlighter
    });
}

function findAnkiMatchesInText(text) {
    const source = String(text || "");
    const tokens = tokenizeJapaneseTextSync?.(source);

    if (!tokens) {
        return [];
    }

    const spans = buildJapaneseHighlightSpans(tokens);
    const matches = [];

    for (const span of spans) {
        let bestMatch = null;

        for (const candidate of span.candidates) {
            const info = ankiRuntimeWordStatusMap.get(candidate);
            if (!info || info.status === "unknown") continue;

            bestMatch = {
                start: span.start,
                end: span.end,
                status: info.status
            };

            break;
        }

        if (bestMatch) {
            matches.push(bestMatch);
        }
    }

    return matches
        .sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return (b.end - b.start) - (a.end - a.start);
        })
        .filter((match, index, arr) => {
            for (let i = 0; i < index; i += 1) {
                const prev = arr[i];

                const overlaps =
                    match.start < prev.end &&
                    match.end > prev.start;

                if (overlaps) return false;
            }

            return true;
        });
}

const ankiSubtitleHighlighter = {
    get enabled() {
        return getSubtitleHighlightSettings().enabled;
    },

    get statusSettings() {
        return getSubtitleHighlightSettings().statusSettings;
    },

    getStatusForTextToken(token) {
        const clean = String(token || "")
            .trim()
            .replace(/[.,!?;:()[\]'"「」『』。、！？]/g, "");

        return ankiRuntimeWordStatusMap.get(clean)?.status || "unknown";
    },

    findMatchesInText(text) {
        return findAnkiMatchesInText(text);
    }
};

function addRuntimeKnownBasicWord(word) {
    const normalized = normalizeHighlightWord(word);

    if (!normalized) return;

    const prev = ankiRuntimeWordStatusMap.get(normalized);

    ankiRuntimeWordStatusMap.set(normalized, {
        ...(prev || {}),
        status: pickBetterStatus(prev?.status, "mature"),
        source: "known-basic"
    });
}