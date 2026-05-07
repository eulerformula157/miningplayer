const ankiWordStatusMap = new Map();
const MAX_HIGHLIGHT_CARDS = 50000;
const ANKI_HIGHLIGHT_CHUNK_SIZE = 100;
const ANKI_HIGHLIGHT_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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

function normalizeHighlightWord(value) {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function makeAnkiHighlightCacheKey({ deckNames, wordFields, maxCards }) {
    const raw = JSON.stringify({
        deckNames,
        wordFields,
        maxCards
    });

    let hash = 0;

    for (let i = 0; i < raw.length; i += 1) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }

    return `anki_highlight_${Math.abs(hash)}`;
}

async function refreshAnkiWordStatuses() {
    const ankiUrl = document.getElementById("ankiUrl")?.value?.trim();
    const deckNames = getHighlightDeckNames();
    const wordFields = getHighlightWordFieldNames();
	
	const cacheKey = makeAnkiHighlightCacheKey({
		deckNames,
		wordFields,
		maxCards: MAX_HIGHLIGHT_CARDS
	});

	if (await loadAnkiHighlightCache(cacheKey)) {
		return;
	}	

    console.log("Anki highlighter deckNames:", deckNames);
    console.log("Anki highlighter wordFields:", wordFields);

    ankiWordStatusMap.clear();

    if (!ankiUrl || !deckNames.length || !wordFields.length) {
        console.warn("Anki highlighter: missing ankiUrl, highlight decks, or word field");
        return;
    }

	const deckQuery = deckNames
		.map((deck) => `deck:"${deck}"`)
		.join(" OR ");

    const cards = await ankiRequest(
        ankiUrl,
        "findCards",
        { query: deckQuery }
    );


	if (cards.length > MAX_HIGHLIGHT_CARDS) {
		console.warn(
			`Anki highlighter: too many cards (${cards.length}). Limiting to ${MAX_HIGHLIGHT_CARDS}.`
		);
	}

	const limitedCards = cards.slice(0, MAX_HIGHLIGHT_CARDS);

    console.log("Anki highlighter decks:", deckNames);
    console.log("Anki highlighter query:", deckQuery);
	console.log("Anki findCards count:", cards.length);

    if (!cards.length) {
        console.warn("Anki highlighter: no cards found");
        return;
    }

	const noteStatusMap = new Map();

	await ankiRequestChunked(
		ankiUrl,
		"cardsInfo",
		"cards",
		limitedCards,
		async (cardsInfo) => {
			for (const card of cardsInfo) {
				const noteId = Number(card.note);
				const status = getCardStatus(card);
				const prev = noteStatusMap.get(noteId);

				noteStatusMap.set(noteId, pickBetterStatus(prev, status));
			}
		}
	);

    const noteIds = [...noteStatusMap.keys()];

	await ankiRequestChunked(
		ankiUrl,
		"notesInfo",
		"notes",
		noteIds,
		async (notesInfo) => {
			for (const note of notesInfo) {
				const status = noteStatusMap.get(Number(note.noteId)) || "unknown";

				for (const fieldName of wordFields) {
					const rawValue = note.fields?.[fieldName]?.value;
					const word = normalizeHighlightWord(rawValue);

					if (!word) continue;

					const prev = ankiWordStatusMap.get(word)?.status;

					ankiWordStatusMap.set(word, {
						status: pickBetterStatus(prev, status),
						noteId: note.noteId
					});
				}
			}
		}
	);

	console.log(
		`Anki highlighter loaded ${ankiWordStatusMap.size} words from ${deckNames.length} deck(s): ${deckNames.join(", ")}`
	);
	
	await saveAnkiHighlightCache(cacheKey);
	
	rerenderCurrentSubtitleWithAnkiHighlighter();
	
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
    const matches = [];

    const entries = [...ankiWordStatusMap.entries()]
        .filter(([word]) => word.length > 0)
        .sort((a, b) => b[0].length - a[0].length);

    for (const [word, info] of entries) {
        let index = source.indexOf(word);

        while (index !== -1) {
            matches.push({
                start: index,
                end: index + word.length,
                status: info.status
            });

            index = source.indexOf(word, index + word.length);
        }
    }

    return matches.sort((a, b) => a.start - b.start || b.end - a.end);
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

        return ankiWordStatusMap.get(clean)?.status || "unknown";
    },

    findMatchesInText(text) {
        return findAnkiMatchesInText(text);
    }
};

async function saveAnkiHighlightCache(cacheKey) {
    const payload = {
        createdAt: Date.now(),
        entries: [...ankiWordStatusMap.entries()]
    };

    try {
        const { response, data } = await apiJson(
            `/anki-highlight-cache/${encodeURIComponent(cacheKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok || data.error) {
            throw new Error(data.error || "Cache save failed");
        }

        console.log(`Anki highlighter server cache saved: ${ankiWordStatusMap.size} words`);
    } catch (err) {
        console.warn("Anki highlighter server cache save failed:", err);
    }
}

async function loadAnkiHighlightCache(cacheKey) {
    try {
        const { response, data } = await apiJson(
            `/anki-highlight-cache/${encodeURIComponent(cacheKey)}`
        );

        if (!response.ok || !data.found) return false;

        const payload = data.data;

        if (!payload.createdAt || !Array.isArray(payload.entries)) {
            return false;
        }

        const age = Date.now() - payload.createdAt;

        if (age > ANKI_HIGHLIGHT_CACHE_TTL_MS) {
            console.log("Anki highlighter cache expired");
            return false;
        }

        ankiWordStatusMap.clear();

        for (const [word, info] of payload.entries) {
            ankiWordStatusMap.set(word, info);
        }

        console.log(`Anki highlighter server cache loaded: ${ankiWordStatusMap.size} words`);
        rerenderCurrentSubtitleWithAnkiHighlighter();

        return true;
    } catch (err) {
        console.warn("Anki highlighter server cache load failed:", err);
        return false;
    }
}

async function ankiRequestChunked(ankiUrl, action, paramName, values, onChunk, chunkSize = ANKI_HIGHLIGHT_CHUNK_SIZE) {
    const totalChunks = Math.ceil(values.length / chunkSize);

    for (let i = 0; i < values.length; i += chunkSize) {
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const chunk = values.slice(i, i + chunkSize);

        console.log(`Anki highlighter ${action}: chunk ${chunkIndex}/${totalChunks}`);

        const chunkResult = await ankiRequest(
            ankiUrl,
            action,
            { [paramName]: chunk }
        );

        if (Array.isArray(chunkResult)) {
            await onChunk(chunkResult, chunkIndex, totalChunks);
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}