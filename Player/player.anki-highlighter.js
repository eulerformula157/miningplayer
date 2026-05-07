const ankiWordStatusMap = new Map();
const ankiNoteCacheMap = new Map();
const ankiCardCacheMap = new Map();

const MAX_HIGHLIGHT_CARDS = 50000;
const ANKI_HIGHLIGHT_CHUNK_SIZE = 100;

// Вечный кэш: не протухает сам по себе.
// Обновление делается кнопкой Refresh Highlight Words.
const ANKI_HIGHLIGHT_CACHE_VERSION = 2;

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
        version: ANKI_HIGHLIGHT_CACHE_VERSION,
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

function clearAnkiHighlightMaps() {
    ankiWordStatusMap.clear();
    ankiNoteCacheMap.clear();
    ankiCardCacheMap.clear();
}

function rebuildWordStatusMapFromNoteCache() {
    ankiWordStatusMap.clear();

    for (const [noteId, noteInfo] of ankiNoteCacheMap.entries()) {
        const words = Array.isArray(noteInfo.words) ? noteInfo.words : [];
        const status = noteInfo.status || "unknown";
        const cardIds = Array.isArray(noteInfo.cardIds) ? noteInfo.cardIds : [];

        for (const word of words) {
            if (!word) continue;

            const prev = ankiWordStatusMap.get(word);

            if (!prev) {
                ankiWordStatusMap.set(word, {
                    status,
                    noteIds: [Number(noteId)],
                    cardIds: [...cardIds]
                });
                continue;
            }

            prev.status = pickBetterStatus(prev.status, status);

            const noteIdNumber = Number(noteId);
            if (!prev.noteIds.includes(noteIdNumber)) {
                prev.noteIds.push(noteIdNumber);
            }

            for (const cardId of cardIds) {
                if (!prev.cardIds.includes(cardId)) {
                    prev.cardIds.push(cardId);
                }
            }
        }
    }
}

function updateNoteCacheFromNoteInfo(note, wordFields) {
    const noteId = String(note.noteId);
    const words = [];

    for (const fieldName of wordFields) {
        const rawValue = note.fields?.[fieldName]?.value;
        const word = normalizeHighlightWord(rawValue);

        if (word) {
            words.push(word);
        }
    }

    const existing = ankiNoteCacheMap.get(noteId) || {};

    ankiNoteCacheMap.set(noteId, {
        ...existing,
        noteId: Number(noteId),
        words: [...new Set(words)],
        status: existing.status || "unknown",
        cardIds: Array.isArray(existing.cardIds) ? existing.cardIds : []
    });
}

function updateCardAndNoteStatusFromCardInfo(card) {
    const cardId = String(card.cardId);
    const noteId = String(card.note);
    const status = getCardStatus(card);

    ankiCardCacheMap.set(cardId, {
        cardId: Number(cardId),
        noteId: Number(noteId),
        status
    });

    const existingNote = ankiNoteCacheMap.get(noteId) || {
        noteId: Number(noteId),
        words: [],
        status: "unknown",
        cardIds: []
    };

    const cardIds = Array.isArray(existingNote.cardIds) ? existingNote.cardIds : [];

    if (!cardIds.includes(Number(cardId))) {
        cardIds.push(Number(cardId));
    }

    ankiNoteCacheMap.set(noteId, {
        ...existingNote,
        status: pickBetterStatus(existingNote.status, status),
        cardIds
    });
}

async function ankiRequestChunked(ankiUrl, action, paramName, values, onChunk, chunkSize = ANKI_HIGHLIGHT_CHUNK_SIZE) {
    const totalChunks = Math.ceil(values.length / chunkSize);

    for (let i = 0; i < values.length; i += chunkSize) {
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const chunk = values.slice(i, i + chunkSize);

        if (chunkIndex === 1 || chunkIndex === totalChunks || chunkIndex % 10 === 0) {
            console.log(`Anki highlighter ${action}: chunk ${chunkIndex}/${totalChunks}`);
        }

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

async function loadAnkiHighlightCache(cacheKey) {
    try {
        const { response, data } = await apiJson(
            `/anki-highlight-cache/${encodeURIComponent(cacheKey)}`
        );

        if (!response.ok || !data.found) return false;

        const payload = data.data;

        clearAnkiHighlightMaps();

        // v2 cache
        if (payload.version === 2) {
            for (const [word, info] of payload.words || []) {
                ankiWordStatusMap.set(word, info);
            }

            for (const [noteId, info] of payload.notes || []) {
                ankiNoteCacheMap.set(String(noteId), info);
            }

            for (const [cardId, info] of payload.cards || []) {
                ankiCardCacheMap.set(String(cardId), info);
            }

            console.log(
                `Anki highlighter server cache loaded: ${ankiWordStatusMap.size} words, ${ankiNoteCacheMap.size} notes, ${ankiCardCacheMap.size} cards`
            );

            rerenderCurrentSubtitleWithAnkiHighlighter();
            return true;
        }

        // old v1 cache compatibility: payload.entries
        if (Array.isArray(payload.entries)) {
            for (const [word, info] of payload.entries) {
                ankiWordStatusMap.set(word, info);
            }

            console.log(`Anki highlighter old cache loaded: ${ankiWordStatusMap.size} words`);
            rerenderCurrentSubtitleWithAnkiHighlighter();
            return true;
        }

        return false;
    } catch (err) {
        console.warn("Anki highlighter server cache load failed:", err);
        return false;
    }
}

async function saveAnkiHighlightCache(cacheKey) {
    const payload = {
        version: ANKI_HIGHLIGHT_CACHE_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        words: [...ankiWordStatusMap.entries()],
        notes: [...ankiNoteCacheMap.entries()],
        cards: [...ankiCardCacheMap.entries()]
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

        console.log(
            `Anki highlighter server cache saved: ${ankiWordStatusMap.size} words, ${ankiNoteCacheMap.size} notes, ${ankiCardCacheMap.size} cards`
        );
    } catch (err) {
        console.warn("Anki highlighter server cache save failed:", err);
    }
}

async function refreshAnkiWordStatuses({ force = false } = {}) {
    const ankiUrl = document.getElementById("ankiUrl")?.value?.trim();
    const deckNames = getHighlightDeckNames();
    const wordFields = getHighlightWordFieldNames();

    const cacheKey = makeAnkiHighlightCacheKey({
        deckNames,
        wordFields,
        maxCards: MAX_HIGHLIGHT_CARDS
    });

    if (!ankiUrl || !deckNames.length || !wordFields.length) {
        console.warn("Anki highlighter: missing ankiUrl, highlight decks, or word field");
        return;
    }

    const cacheLoaded = await loadAnkiHighlightCache(cacheKey);

    if (cacheLoaded && !force) {
        return;
    }

    console.log("Anki highlighter deckNames:", deckNames);
    console.log("Anki highlighter wordFields:", wordFields);

    if (!cacheLoaded) {
        clearAnkiHighlightMaps();
    }

    const deckQuery = deckNames
        .map((deck) => `deck:"${deck}"`)
        .join(" OR ");

    const cards = await ankiRequest(
        ankiUrl,
        "findCards",
        { query: deckQuery }
    );

    if (!cards.length) {
        console.warn("Anki highlighter: no cards found");
        return;
    }

    if (cards.length > MAX_HIGHLIGHT_CARDS) {
        console.warn(
            `Anki highlighter: too many cards (${cards.length}). Limiting to ${MAX_HIGHLIGHT_CARDS}.`
        );
    }

    const limitedCards = cards.slice(0, MAX_HIGHLIGHT_CARDS);
    const knownCardIds = new Set([...ankiCardCacheMap.keys()]);
    const newCardIds = limitedCards.filter((cardId) => !knownCardIds.has(String(cardId)));

    console.log("Anki highlighter decks:", deckNames);
    console.log("Anki highlighter query:", deckQuery);
    console.log("Anki findCards count:", cards.length);
    console.log("Anki cached cards:", knownCardIds.size);
    console.log("Anki new cards:", newCardIds.length);

    // 1. Always refresh statuses for existing + new cards via cardsInfo.
    // This is required because learning status changes over time.
    const noteIdsTouchedByCards = new Set();

    await ankiRequestChunked(
        ankiUrl,
        "cardsInfo",
        "cards",
        limitedCards,
        async (cardsInfo) => {
            for (const card of cardsInfo) {
                updateCardAndNoteStatusFromCardInfo(card);
                noteIdsTouchedByCards.add(String(card.note));
            }
        }
    );

    // 2. For new cards, fetch notesInfo only for notes that are not cached yet.
    const newNoteIds = new Set();

    for (const cardId of newCardIds) {
        const cardInfo = ankiCardCacheMap.get(String(cardId));

        if (!cardInfo) continue;

        const noteId = String(cardInfo.noteId);
        const noteInfo = ankiNoteCacheMap.get(noteId);

        if (!noteInfo || !Array.isArray(noteInfo.words) || !noteInfo.words.length) {
            newNoteIds.add(Number(noteId));
        }
    }

    if (newNoteIds.size > 0) {
        await ankiRequestChunked(
            ankiUrl,
            "notesInfo",
            "notes",
            [...newNoteIds],
            async (notesInfo) => {
                for (const note of notesInfo) {
                    updateNoteCacheFromNoteInfo(note, wordFields);
                }
            }
        );
    }

    // 3. Rebuild word map from note/card cache after statuses and new words are updated.
    rebuildWordStatusMapFromNoteCache();

    console.log(
        `Anki highlighter refreshed: ${ankiWordStatusMap.size} words, ${ankiNoteCacheMap.size} notes, ${ankiCardCacheMap.size} cards`
    );

    await saveAnkiHighlightCache(cacheKey);

    rerenderCurrentSubtitleWithAnkiHighlighter();
}

async function addNoteToAnkiHighlightCache(noteId) {
    const ankiUrl = document.getElementById("ankiUrl")?.value?.trim();
    const deckNames = getHighlightDeckNames();
    const wordFields = getHighlightWordFieldNames();

    if (!ankiUrl || !noteId || !deckNames.length || !wordFields.length) {
        console.warn("Anki highlighter: cannot add note to cache, missing settings");
        return;
    }

    const cacheKey = makeAnkiHighlightCacheKey({
        deckNames,
        wordFields,
        maxCards: MAX_HIGHLIGHT_CARDS
    });

    // Если карта пустая после загрузки страницы — сначала подтянем существующий cache.
    if (!ankiWordStatusMap.size && !ankiNoteCacheMap.size && !ankiCardCacheMap.size) {
        await loadAnkiHighlightCache(cacheKey);
    }

    const cardIds = await ankiRequest(
        ankiUrl,
        "findCards",
        { query: `nid:${noteId}` }
    );

    if (!cardIds.length) {
        console.warn(`Anki highlighter: no cards found for note ${noteId}`);
        return;
    }

    const cardsInfo = await ankiRequest(
        ankiUrl,
        "cardsInfo",
        { cards: cardIds }
    );

    for (const card of cardsInfo) {
        updateCardAndNoteStatusFromCardInfo(card);
    }

    const notesInfo = await ankiRequest(
        ankiUrl,
        "notesInfo",
        { notes: [Number(noteId)] }
    );

    const note = notesInfo[0];

    if (!note) {
        console.warn(`Anki highlighter: noteInfo not found for note ${noteId}`);
        return;
    }

    updateNoteCacheFromNoteInfo(note, wordFields);
    rebuildWordStatusMapFromNoteCache();

    await saveAnkiHighlightCache(cacheKey);

    console.log(`Anki highlighter: note ${noteId} added/updated in cache`);

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