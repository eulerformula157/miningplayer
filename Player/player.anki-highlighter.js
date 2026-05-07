const ankiWordStatusMap = new Map();

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

async function refreshAnkiWordStatuses() {
	const ankiUrl = document.getElementById("ankiUrl")?.value?.trim();
	const deckNames = getHighlightDeckNames();
	const wordFields = getHighlightWordFieldNames();

console.log("Anki highlighter deckName:", deckName);
console.log("Anki highlighter wordFields:", wordFields);

    ankiWordStatusMap.clear();

    if (!ankiUrl || !deckName.length || !wordFields.length) {
        console.warn("Anki highlighter: missing ankiUrl, deckName, or word field");
        return;
    }

	const deckQuery = deckNames
		.flatMap((deck) => [
			`deck:"${deck}"`,
			`deck:"${deck}::*"`
		])
		.join(" OR ");

	const cards = await ankiRequest(
		ankiUrl,
		"findCards",
		{ query: deckQuery }
	);

	console.log("Anki highlighter decks:", deckNames);
	console.log("Anki highlighter query:", deckQuery);
	console.log("Anki findCards result:", cards);

    if (!cards.length) {
        console.warn("Anki highlighter: no cards found");
        return;
    }

    const cardsInfo = await ankiRequest(
        ankiUrl,
        "cardsInfo",
        { cards }
    );

    const noteStatusMap = new Map();

    for (const card of cardsInfo) {
        const noteId = Number(card.note);
        const status = getCardStatus(card);
        const prev = noteStatusMap.get(noteId);

        noteStatusMap.set(noteId, pickBetterStatus(prev, status));
    }

    const noteIds = [...noteStatusMap.keys()];

    const notesInfo = await ankiRequest(
        ankiUrl,
        "notesInfo",
        { notes: noteIds }
    );

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

	console.log(
		`Anki highlighter loaded ${ankiWordStatusMap.size} words from ${deckNames.length} deck(s): ${deckNames.join(", ")}`
	);
	
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