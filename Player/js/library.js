const seriesGrid = document.getElementById("seriesGrid");
const librarySummary = document.getElementById("librarySummary");
const scanLibraryBtn = document.getElementById("scanLibraryBtn");

const seriesModal = document.getElementById("seriesModal");
const seriesPanel = document.getElementById("seriesPanel");
const seriesTitle = document.getElementById("seriesTitle");
const seriesStats = document.getElementById("seriesStats");
const episodeList = document.getElementById("episodeList");
const closeSeriesPanelBtn = document.getElementById("closeSeriesPanelBtn");

const coverModal = document.getElementById("coverModal");
const coverModalTitle = document.getElementById("coverModalTitle");
const coverModalSubtitle = document.getElementById("coverModalSubtitle");
const closeCoverModalBtn = document.getElementById("closeCoverModalBtn");
const coverSearchInput = document.getElementById("coverSearchInput");
const coverSearchBtn = document.getElementById("coverSearchBtn");
const coverResults = document.getElementById("coverResults");

const changeSeriesCoverBtn = document.getElementById("changeSeriesCoverBtn");

let currentCoverSeries = null;
let currentOpenedSeries = null;

function updateSeriesCompletedCount(seriesId, delta) {
    const cards = document.querySelectorAll(".series-card");

    for (const card of cards) {
        if (String(card.dataset.seriesId) !== String(seriesId)) continue;

        const completedEl = card.querySelector("[data-completed-episodes]");
        const totalEl = card.querySelector("[data-total-episodes]");
        const fillEl = card.querySelector(".progress-bar-fill");

        if (!completedEl || !totalEl) return;

        const currentCompleted = Number(completedEl.textContent || 0);
        const total = Number(totalEl.textContent || 0);
        const nextCompleted = Math.max(0, currentCompleted + delta);

        completedEl.textContent = String(nextCompleted);

        if (fillEl && total > 0) {
            fillEl.style.width = `${Math.round((nextCompleted / total) * 100)}%`;
        }

        return;
    }
}

function updateCurrentSeriesStatsText(delta) {
    if (!currentOpenedSeries) return;

    currentOpenedSeries.completedEpisodes = Math.max(
        0,
        Number(currentOpenedSeries.completedEpisodes || 0) + delta
    );
}

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
		`${series.length} series · ${completedEpisodes}/${totalEpisodes} watched`;

    for (const item of series) {
        seriesGrid.appendChild(renderSeriesCard(item));
    }
}

function renderSeriesCard(item) {
    const card = document.createElement("article");
    card.className = "series-card";
    card.title = item.title;
	card.dataset.seriesId = item.id;

    const progressPercent = item.episodesCount
        ? Math.round((item.completedEpisodes / item.episodesCount) * 100)
        : 0;

    const firstLetter = String(item.title || "?").trim().slice(0, 1).toUpperCase();

    const coverHtml = item.coverUrl
        ? `<img class="series-cover-image" src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)}">`
        : `<div class="series-cover-letter">${escapeHtml(firstLetter)}</div>`;

    card.innerHTML = `
        <div class="series-cover">
            ${coverHtml}
            <div class="link-badge ${escapeHtml(item.linkStatus)}" title="${escapeHtml(statusTitle(item.linkStatus))}">
                ${escapeHtml(statusIcon(item.linkStatus))}
            </div>
        </div>

        <div class="series-title">${escapeHtml(item.title)}</div>

		<div class="series-meta">
			<span>
				<span data-completed-episodes>${escapeHtml(item.completedEpisodes)}</span>/<span data-total-episodes>${escapeHtml(item.episodesCount)}</span> eps
			</span>
		</div>

		<div class="progress-bar">
			<div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
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
	currentOpenedSeries = {
		...series,
		completedEpisodes: episodes.filter((episode) => episode.completed).length
	};

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
			<label class="episode-title episode-title-checkbox">
				<input
					class="episode-completed-checkbox"
					type="checkbox"
					${episode.completed ? "checked" : ""}
					data-episode-id="${escapeHtml(episode.id)}"
				>
				<span>${escapeHtml(episode.title)}</span>
			</label>

            <div class="episode-meta">
				${episode.hasVideo ? "video ✓" : "video ×"} ·
				${episode.hasSubtitle ? "subtitles ✓" : "subtitles ×"} ·
				<span data-episode-watched-text>${escapeHtml(watched)}</span>
            </div>
        </div>

        <div class="episode-actions">
            <a class="open-episode-link ${canOpen ? "" : "disabled"}"
               href="/?episodeId=${encodeURIComponent(episode.id)}">
                Open
            </a>
        </div>
    `;

	const completedCheckbox = row.querySelector(".episode-completed-checkbox");

	completedCheckbox.addEventListener("click", (event) => {
		event.stopPropagation();
	});

completedCheckbox.addEventListener("change", async () => {
    const previousValue = !completedCheckbox.checked;
    const nextValue = completedCheckbox.checked;

    completedCheckbox.disabled = true;

    try {
        const { response, data } = await apiJson(
            `/library/episodes/${encodeURIComponent(episode.id)}/completed`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    completed: nextValue
                })
            }
        );

        if (!response.ok || data.error) {
            throw new Error(data.error || "Could not update episode status");
        }

        const delta = nextValue ? 1 : -1;

        episode.completed = nextValue;
        updateCurrentSeriesStatsText(delta);
        updateSeriesCompletedCount(currentOpenedSeries?.id, delta);

        const watchedText = row.querySelector("[data-episode-watched-text]");
        if (watchedText) {
            watchedText.textContent = nextValue
                ? "watched"
                : episode.currentTimeSeconds > 0
                    ? `at ${formatTime(episode.currentTimeSeconds)}`
                    : "not watched";
        }
    } catch (err) {
        completedCheckbox.checked = previousValue;
        alert(err.message);
    } finally {
        completedCheckbox.disabled = false;
    }
});

    return row;
}

function openCoverModal() {
    coverModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeCoverModal() {
    coverModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    currentCoverSeries = null;
}

async function openCoverSearchModal(series) {
    currentCoverSeries = series;

    coverModalTitle.textContent = series.coverUrl ? "Change cover" : "Find cover";
    coverModalSubtitle.textContent = series.title;
    coverSearchInput.value = series.title;
    coverResults.innerHTML = "";

    openCoverModal();

    await searchCoversForCurrentSeries();
}

async function searchCoversForCurrentSeries() {
    if (!currentCoverSeries) return;

    const query = coverSearchInput.value.trim() || currentCoverSeries.title;

    coverSearchBtn.disabled = true;
    coverSearchBtn.textContent = "Searching...";
    coverResults.innerHTML = `<div class="cover-message">Searching AniList...</div>`;

    try {
        const url =
            `/library/series/${encodeURIComponent(currentCoverSeries.id)}/cover/search` +
            `?q=${encodeURIComponent(query)}`;

        const { response, data } = await apiJson(url);

        if (!response.ok || data.error) {
            throw new Error(data.error || "Cover search failed");
        }

        renderCoverResults(data.results || []);
    } catch (err) {
        coverResults.innerHTML = `<div class="cover-message error">${escapeHtml(err.message)}</div>`;
    } finally {
        coverSearchBtn.disabled = false;
        coverSearchBtn.textContent = "Search";
    }
}

function renderCoverResults(results) {
    coverResults.innerHTML = "";

    if (!results.length) {
        coverResults.innerHTML = `<div class="cover-message">No results found.</div>`;
        return;
    }

    for (const result of results) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "cover-result-item";

        const meta = [
            result.format,
            result.seasonYear,
            result.episodes ? `${result.episodes} eps` : null,
        ].filter(Boolean).join(" · ");

        item.innerHTML = `
            <img src="${escapeHtml(result.coverUrl)}" alt="">
            <div class="cover-result-info">
                <div class="cover-result-title">${escapeHtml(result.title || result.preferredTitle || "Untitled")}</div>
                <div class="cover-result-subtitle">${escapeHtml(result.englishTitle || result.nativeTitle || "")}</div>
                <div class="cover-result-meta">${escapeHtml(meta)}</div>
            </div>
        `;

        item.addEventListener("click", () => {
            selectCoverResult(result);
        });

        coverResults.appendChild(item);
    }
}

async function selectCoverResult(result) {
    if (!currentCoverSeries) return;

    coverResults.classList.add("is-loading");

    try {
        const { response, data } = await apiJson(
            `/library/series/${encodeURIComponent(currentCoverSeries.id)}/cover/select`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    source: result.source,
                    externalId: result.externalId,
                    coverUrl: result.coverUrl
                })
            }
        );

        if (!response.ok || data.error) {
            throw new Error(data.error || "Could not save cover");
        }

        closeCoverModal();
        await loadLibrarySeries();
    } catch (err) {
        alert(err.message);
    } finally {
        coverResults.classList.remove("is-loading");
    }
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
        closeCoverModal();
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

closeCoverModalBtn.addEventListener("click", () => {
    closeCoverModal();
});

coverSearchBtn.addEventListener("click", () => {
    searchCoversForCurrentSeries();
});

coverSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        searchCoversForCurrentSeries();
    }
});

coverModal.addEventListener("click", (event) => {
    if (event.target === coverModal) {
        closeCoverModal();
    }
});

changeSeriesCoverBtn.addEventListener("click", () => {
    if (!currentOpenedSeries) return;
    openCoverSearchModal(currentOpenedSeries);
});