const seriesGrid = document.getElementById("seriesGrid");
const librarySummary = document.getElementById("librarySummary");
const scanLibraryBtn = document.getElementById("scanLibraryBtn");

const seriesModal = document.getElementById("seriesModal");
const seriesPanel = document.getElementById("seriesPanel");
const seriesTitle = document.getElementById("seriesTitle");
const seriesStats = document.getElementById("seriesStats");
const episodeList = document.getElementById("episodeList");
const closeSeriesPanelBtn = document.getElementById("closeSeriesPanelBtn");

function formatTime(seconds) {
    const value = Number(seconds || 0);

    if (value <= 0) return "0m";

    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
}

function statusIcon(status) {
    if (status === "linked") return "✓";
    if (status === "partial") return "!";
    return "×";
}

function statusTitle(status) {
    if (status === "linked") return "All linked";
    if (status === "partial") return "Partially linked";
    return "Missing files";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function loadLibrarySeries() {
    seriesGrid.innerHTML = "";
    librarySummary.textContent = "Loading...";

    const { response, data } = await apiJson("/library/series");

    if (!response.ok || data.error) {
        throw new Error(data.error || "Could not load library");
    }

    const series = Array.isArray(data.series) ? data.series : [];

    const totalEpisodes = series.reduce((sum, item) => {
        return sum + Number(item.episodesCount || 0);
    }, 0);

    const completedEpisodes = series.reduce((sum, item) => {
        return sum + Number(item.completedEpisodes || 0);
    }, 0);

    const totalCards = series.reduce((sum, item) => {
        return sum + Number(item.cardsCount || 0);
    }, 0);

    librarySummary.textContent =
        `${series.length} series · ${completedEpisodes}/${totalEpisodes} watched · ${totalCards} cards`;

    for (const item of series) {
        seriesGrid.appendChild(renderSeriesCard(item));
    }
}

function renderSeriesCard(item) {
    const card = document.createElement("article");
    card.className = "series-card";
    card.title = item.title;

    const progressPercent = item.episodesCount
        ? Math.round((item.completedEpisodes / item.episodesCount) * 100)
        : 0;

    const firstLetter = String(item.title || "?").trim().slice(0, 1).toUpperCase();

    card.innerHTML = `
        <div class="series-cover">
            <div class="series-cover-letter">${escapeHtml(firstLetter)}</div>
            <div class="link-badge ${escapeHtml(item.linkStatus)}" title="${escapeHtml(statusTitle(item.linkStatus))}">
                ${escapeHtml(statusIcon(item.linkStatus))}
            </div>
        </div>

        <div class="series-title">${escapeHtml(item.title)}</div>

        <div class="series-meta">
            <span>${escapeHtml(item.completedEpisodes)}/${escapeHtml(item.episodesCount)} eps</span>
            <span>${escapeHtml(item.cardsCount)} cards</span>
        </div>

        <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>

        <div class="series-extra">
            ${escapeHtml(formatTime(item.watchedSeconds))} watched<br>
            ${escapeHtml(item.minedWordsCount)} words mined
        </div>
    `;

    card.addEventListener("click", () => {
        openSeries(item.id);
    });

    return card;
}

async function openSeries(seriesId) {
    openSeriesModal();
    seriesTitle.textContent = "Loading...";
    seriesStats.textContent = "";
    episodeList.innerHTML = "";

    const { response, data } = await apiJson(`/library/series/${encodeURIComponent(seriesId)}`);

    if (!response.ok || data.error) {
        seriesTitle.textContent = "Error";
        seriesStats.textContent = data.error || "Could not load series";
        return;
    }

    const series = data.series;
    const episodes = Array.isArray(data.episodes) ? data.episodes : [];

    seriesTitle.textContent = series.title;
    seriesStats.textContent =
        `${series.episodesWithVideo}/${series.episodesCount} video · ` +
        `${series.episodesWithSubtitle}/${series.episodesCount} subtitles · ` +
        `${series.linkStatus}`;

    episodeList.innerHTML = "";

    for (const episode of episodes) {
        episodeList.appendChild(renderEpisodeRow(episode));
    }
}

function renderEpisodeRow(episode) {
    const row = document.createElement("div");
    row.className = "episode-row";

    const status = episode.linkStatus;
    const canOpen = Boolean(episode.hasVideo);

    const watched = episode.completed
        ? "watched"
        : episode.currentTimeSeconds > 0
            ? `at ${formatTime(episode.currentTimeSeconds)}`
            : "not watched";

    row.innerHTML = `
        <div>
            <div class="episode-title">
                ${escapeHtml(statusIcon(status))} ${escapeHtml(episode.title)}
            </div>

            <div class="episode-meta">
                ${episode.hasVideo ? "video ✓" : "video ×"} ·
                ${episode.hasSubtitle ? "subtitles ✓" : "subtitles ×"} ·
                ${escapeHtml(watched)}<br>
                ${escapeHtml(episode.cardsCount)} cards ·
                ${escapeHtml(episode.minedWordsCount)} words
            </div>
        </div>

        <div class="episode-actions">
            <a class="open-episode-link ${canOpen ? "" : "disabled"}"
               href="/?episodeId=${encodeURIComponent(episode.id)}">
                Open
            </a>
        </div>
    `;

    return row;
}

scanLibraryBtn.addEventListener("click", async () => {
    scanLibraryBtn.disabled = true;
    scanLibraryBtn.textContent = "Scanning...";

    try {
        const { response, data } = await apiJson("/library/scan");

        if (!response.ok || data.error) {
            throw new Error(data.error || "Scan failed");
        }

        await loadLibrarySeries();
    } catch (err) {
        alert(err.message);
    } finally {
        scanLibraryBtn.disabled = false;
        scanLibraryBtn.textContent = "Scan library";
    }
});

closeSeriesPanelBtn.addEventListener("click", () => {
    closeSeriesModal();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeSeriesModal();
    }
});

seriesModal.addEventListener("click", (event) => {
    if (event.target === seriesModal) {
        closeSeriesModal();
    }
});

loadLibrarySeries().catch((err) => {
    console.error(err);
    librarySummary.textContent = err.message;
});

function openSeriesModal() {
    seriesModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeSeriesModal() {
    seriesModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}