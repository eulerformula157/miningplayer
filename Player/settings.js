function enableWheelOnSettings() {
    const settingsInputs = document.querySelectorAll("#settingsModal input[type=\"number\"], #settingsModal input[type=\"range\"]");
    settingsInputs.forEach((input) => {
        input.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const step = parseFloat(input.step) || 1;
            const direction = e.deltaY < 0 ? 1 : -1;
            let val = parseFloat(input.value) || 0;
            let newValue = val + (direction * step);

            const minAttr = input.getAttribute("min");
            const maxAttr = input.getAttribute("max");
            const min = minAttr !== null ? parseFloat(minAttr) : -Infinity;
            const max = maxAttr !== null ? parseFloat(maxAttr) : Infinity;
            newValue = Math.max(min, Math.min(max, newValue));

            if (step < 1) input.value = parseFloat(newValue.toFixed(Math.max(0, -Math.log10(step))));
            else input.value = Math.round(newValue);

            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }, { passive: false });
    });

    audioTrackSelect.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.deltaY < 0 ? -1 : 1;
        let newIdx = audioTrackSelect.selectedIndex + direction;
        newIdx = Math.max(0, Math.min(audioTrackSelect.options.length - 1, newIdx));
        audioTrackSelect.selectedIndex = newIdx;
        audioTrackSelect.dispatchEvent(new Event("change"));
    }, { passive: false });
}

function saveSettings() {
    const settings = {
        language: currentLang,
        fontSize: document.getElementById("fontSizeRange").value,
        offsetStart: document.getElementById("subOffsetStart").value,
        offsetEnd: document.getElementById("subOffsetEnd").value,
        subDepth: document.getElementById("subDepth").value,
        audioVol: document.getElementById("audioVol").value,
        ankiUrl: document.getElementById("ankiUrl").value,
        deckName: document.getElementById("deckName").value,
        screenshotMode: document.getElementById("screenshotMode").value,
		globalSubDelay: document.getElementById("globalSubDelay").value,
        sidebarWidth: document.getElementById("sidebar").style.width,
		sentenceField: document.getElementById("sentenceField").value,
		sentenceFuriganaField: document.getElementById("sentenceFuriganaField").value,
		pictureField: document.getElementById("pictureField").value,
		audioField: document.getElementById("audioField").value,
		includeImageSubtitle: document.getElementById("includeImageSubtitle").checked,
		subtitleHighlightEnabled: document.getElementById("subtitleHighlightEnabled")?.checked ?? true,
		highlightColorNew: document.getElementById("highlightColorNew")?.value || "#ffcc66",
		highlightColorLearning: document.getElementById("highlightColorLearning")?.value || "#66ccff",
		highlightColorYoung: document.getElementById("highlightColorYoung")?.value || "#66ccff",
		highlightColorMature: document.getElementById("highlightColorMature")?.value || "#88ff88",
		highlightColorSuspended: document.getElementById("highlightColorSuspended")?.value || "#999999",
		highlightColorUnknown: document.getElementById("highlightColorUnknown")?.value || "#ffffff",
		highlightDeckNames: document.getElementById("highlightDeckNames")?.value || "",
		highlightWordField: document.getElementById("highlightWordField")?.value || "Word"
		
    };
    localStorage.setItem("subtitlePlayerSettings", JSON.stringify(settings));
    showToast("Settings saved", "success");
}

function loadSettings() {
    const saved = localStorage.getItem("subtitlePlayerSettings");
    if (!saved) {
        initLangSelector();
        applyLanguage(currentLang);
        return;
    }

    const settings = JSON.parse(saved);
    if (settings.language) currentLang = settings.language;

    initLangSelector();
    applyLanguage(currentLang);

    if (settings.sidebarWidth) {
        const sidebarEl = document.getElementById("sidebar");
        if (sidebarEl) sidebarEl.style.width = settings.sidebarWidth;
    }

	const subtitleHighlightEnabled = document.getElementById("subtitleHighlightEnabled");
	if (subtitleHighlightEnabled) {
		subtitleHighlightEnabled.checked = settings.subtitleHighlightEnabled ?? true;
	}

	const highlightColorNew = document.getElementById("highlightColorNew");
	if (highlightColorNew) {
		highlightColorNew.value = settings.highlightColorNew || "#77b7d8";
	}

	const highlightColorLearning = document.getElementById("highlightColorLearning");
	if (highlightColorLearning) {
		highlightColorLearning.value = settings.highlightColorLearning || "#ff8a3d";
	}

	const highlightColorYoung = document.getElementById("highlightColorYoung");
	if (highlightColorYoung) {
		highlightColorYoung.value = settings.highlightColorYoung || "#7ec77a";
	}

	const highlightColorMature = document.getElementById("highlightColorMature");
	if (highlightColorMature) {
		highlightColorMature.value = settings.highlightColorMature || "#2f9d4f";
	}

	const highlightColorSuspended = document.getElementById("highlightColorSuspended");
	if (highlightColorSuspended) {
		highlightColorSuspended.value = settings.highlightColorSuspended || "#ffde4a";
	}

	const highlightColorUnknown = document.getElementById("highlightColorUnknown");
	if (highlightColorUnknown) {
		highlightColorUnknown.value = settings.highlightColorUnknown || "#ffffff";
	}

	const highlightDeckNames = document.getElementById("highlightDeckNames");
	if (highlightDeckNames) {
		highlightDeckNames.value = settings.highlightDeckNames || "";
	}

	const highlightWordField = document.getElementById("highlightWordField");
	if (highlightWordField) {
		highlightWordField.value = settings.highlightWordField || "Word";
	}

    const mapping = {
        fontSizeRange: settings.fontSize,
        subOffsetStart: settings.offsetStart,
        subOffsetEnd: settings.offsetEnd,
        subDepth: settings.subDepth,
        audioVol: settings.audioVol,
        ankiUrl: settings.ankiUrl,
        deckName: settings.deckName,
		globalSubDelay: settings.globalSubDelay,
        screenshotMode: settings.screenshotMode,
		sentenceField: settings.sentenceField,
		sentenceFuriganaField: settings.sentenceFuriganaField,
		pictureField: settings.pictureField,
		audioField: settings.audioField
    };

    for (const [id, value] of Object.entries(mapping)) {
        const el = document.getElementById(id);
        if (el && value !== undefined) {
            el.value = value;
            el.dispatchEvent(new Event("input"));
        }
    }

	const delayEl = document.getElementById("globalSubDelay");
	if (delayEl) globalSubDelay = parseFloat(delayEl.value) || 0;

	const includeImageSubtitleEl = document.getElementById("includeImageSubtitle");
	if (includeImageSubtitleEl) {
		includeImageSubtitleEl.checked = settings.includeImageSubtitle !== false;
	}

}

function applyLanguage(lang) {
    currentLang = lang;
    const dictionary = i18n[lang].dict;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (dictionary[key]) el.textContent = dictionary[key];
    });

    if (typeof sidebar !== "undefined" && toggleBtn) {
        const langKey = sidebar.classList.contains("hidden") ? "showSubs" : "hideSubs";
        toggleBtn.textContent = dictionary[langKey];
    }

    const autoOption = document.querySelector("#targetNoteSelect option[value='']");
    if (autoOption && dictionary.lastAdded) {
        autoOption.textContent = dictionary.lastAdded;
    }

    if (typeof updateFullscreenButtonText === "function") {
        updateFullscreenButtonText();
    }
		
	if (typeof updateSubtitleSearchPanelLanguage === "function") {
		updateSubtitleSearchPanelLanguage();
	}	
}

function initLangSelector() {
    const langSelect = document.getElementById("interfaceLangSelect");
    if (!langSelect) return;
    langSelect.innerHTML = "";
    Object.keys(i18n).forEach((langCode) => {
        const opt = document.createElement("option");
        opt.value = langCode;
        opt.textContent = i18n[langCode].name;
        langSelect.appendChild(opt);
    });
    langSelect.value = currentLang;
    langSelect.onchange = (e) => applyLanguage(e.target.value);
}

document.getElementById("saveSettingsBtn").onclick = saveSettings;
window.addEventListener("load", loadSettings);
enableWheelOnSettings();

initLangSelector();
applyLanguage(currentLang);

const langSelect = document.getElementById("interfaceLangSelect");
if (langSelect) {
    langSelect.onchange = (e) => applyLanguage(e.target.value);
}
