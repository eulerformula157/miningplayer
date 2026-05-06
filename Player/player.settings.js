function enableWheelOnSettings() {
    const settingsInputs = document.querySelectorAll("#settingsMenu input[type=\"number\"], #settingsMenu input[type=\"range\"]");
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
        detailsSubtitleOpen: document.getElementById("detailsSubtitle").open,
        detailsVisualsOpen: document.getElementById("detailsVisuals").open,
        detailsAnkiOpen: document.getElementById("detailsAnki").open,
		globalSubDelay: document.getElementById("globalSubDelay").value,
        sidebarWidth: document.getElementById("sidebar").style.width,
		sentenceField: document.getElementById("sentenceField").value,
		pictureField: document.getElementById("pictureField").value,
		audioField: document.getElementById("audioField").value
    };
    localStorage.setItem("subtitlePlayerSettings", JSON.stringify(settings));
    alert("Settings saved!");
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
		pictureField: settings.pictureField,
		audioField: settings.audioField
    };

	// sync the JS variable
	const delayEl = document.getElementById("globalSubDelay");
	if (delayEl) globalSubDelay = parseFloat(delayEl.value) || 0;

    for (const [id, value] of Object.entries(mapping)) {
        const el = document.getElementById(id);
        if (el && value !== undefined) {
            el.value = value;
            el.dispatchEvent(new Event("input"));
        }
    }

    [
        { id: "detailsSubtitle", isOpen: settings.detailsSubtitleOpen },
        { id: "detailsVisuals", isOpen: settings.detailsVisualsOpen },
        { id: "detailsAnki", isOpen: settings.detailsAnkiOpen }
    ].forEach((item) => {
        const el = document.getElementById(item.id);
        if (!el) return;
        if (item.isOpen) el.setAttribute("open", "");
        else el.removeAttribute("open");
    });
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
