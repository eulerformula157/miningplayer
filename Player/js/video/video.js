async function handleFiles(files) {
    let videoFile = null;
    let subtitleFile = null;
    let hasSubtitles = false;

    for (const file of files) {
        const lowerName = file.name.toLowerCase();

		if (lowerName.endsWith(".srt")) {
			subtitleFile = file;
			subtitles = parseSRT(await file.text());
			hasSubtitles = true;
		} else if (lowerName.endsWith(".ass")) {
			subtitleFile = file;

			// ASS больше не парсим в браузере.
			// Ждём, пока сервер сконвертирует ASS -> SRT.
			subtitles = [];
			hasSubtitles = true;
		} else if (file.type.startsWith("video")) {
			videoFile = file;
		}
    }

    if (videoFile) {
        if (!hasSubtitles) {
            subtitles = [];
            lastRuntimeSubtitleText = "";

            renderSubtitleOverlay({
                overlay,
                text: ""
            });
        }

        video.src = URL.createObjectURL(videoFile);
        dropzone.classList.add("hidden");

        uploadVideoInBackground(videoFile, subtitleFile);
    }

    lastRuntimeSubtitleText = "";
    runtimePrefetchAllRunId += 1;
	runtimeHighlightPrefetchReady = false;

    clearRuntimeWordStatuses?.();

    renderSubtitles();

    requestAnimationFrame(() => {
        prefetchRuntimeStatusesForAllSubtitles({ silent: true });
    });
}


async function uploadVideoInBackground(videoFile, subtitleFile = null) {
    const form = new FormData();
    form.append("videoFile", videoFile);

    try {
        const { data } = await apiJson("/upload-video", {
            method: "POST",
            body: form
        });

        if (data.error) {
            console.error("Server upload error:", data.error);
            showToast(t("toastVideoUploadFailed", { message: data.error }), "error", 5000);
            return;
        }

        currentVideoFile = data.filename;
        loadAudioTrackList(data.filename);

        if (subtitleFile) {
            await uploadSubtitleInBackground(subtitleFile, data.filename);
        }

    } catch (e) {
        console.error("Upload failed:", e);
        showToast(t("toastVideoUploadFailed", { message: e.message }), "error", 5000);
    }
}

async function uploadSubtitleInBackground(subtitleFile, videoFilename) {
    const form = new FormData();

    form.append("subtitleFile", subtitleFile);
    form.append("videoFilename", videoFilename);

    try {
        const { data } = await apiJson("/upload-subtitle", {
            method: "POST",
            body: form
        });

        if (data.error) {
            console.error("Subtitle upload error:", data.error);
            showToast(t("toastSubtitleUploadFailed", { message: data.error }), "error", 5000);
            return;
        }

        console.log("Subtitle uploaded:", data.filename);

        // ВАЖНО:
        // сервер вернул уже .srt, даже если на вход был .ass
        if (data.filename) {
            await restoreSubtitleFromServer(data.filename);
        }

    } catch (err) {
        console.error("Subtitle upload failed:", err);
        showToast(t("toastSubtitleUploadFailed", { message: err.message }), "error", 5000);
    }
}

async function restoreSubtitleFromServer(subtitleFilename) {
    try {
        const res = await fetch(buildApiUrl(`/subtitle/${encodeURIComponent(subtitleFilename)}`));

        if (!res.ok) {
            throw new Error(`Subtitle load failed: HTTP ${res.status}`);
        }

        const text = await res.text();
        const lowerName = subtitleFilename.toLowerCase();

        if (lowerName.endsWith(".srt")) {
            subtitles = parseSRT(text);
        }  else {
            throw new Error("Unsupported subtitle format");
        }

        lastRuntimeSubtitleText = "";
        runtimePrefetchAllRunId += 1;
		runtimeHighlightPrefetchReady = false;

        clearRuntimeWordStatuses?.();

        renderSubtitles();

        requestAnimationFrame(() => {
            prefetchRuntimeStatusesForAllSubtitles({ silent: true });
        });

        showToast(t("toastVideoAndSubtitlesRestored"), "info", 2500);
    } catch (err) {
        console.error("Could not restore subtitles:", err);
        showToast(t("toastVideoRestoredSubtitlesFailed"), "error", 5000);
    }
}

async function restoreCurrentVideoFromServer() {
    try {
        const { data } = await apiJson("/videos");

        const videos = Array.isArray(data.videos) ? data.videos : [];

        if (!videos.length) {
            dropzone.classList.remove("hidden");
            return;
        }

        if (videos.length === 1) {
            await restoreSelectedVideoFromServer(videos[0]);
            return;
        }

        showVideoPickerModal(videos);
    } catch (err) {
        console.warn("Could not restore videos from server:", err);
        dropzone.classList.remove("hidden");
    }
}

async function restoreSelectedVideoFromServer(videoInfo) {
    if (!videoInfo?.filename) {
        dropzone.classList.remove("hidden");
        return;
    }

    currentVideoFile = videoInfo.filename;

    video.src = buildApiUrl(`/video/${encodeURIComponent(videoInfo.filename)}`);
    video.load();

    dropzone.classList.add("hidden");
    videoPickerModal?.classList.add("hidden");

    loadAudioTrackList(videoInfo.filename);

    if (videoInfo.subtitleFilename) {
        await restoreSubtitleFromServer(videoInfo.subtitleFilename);
    } else {
        subtitles = [];
        lastRuntimeSubtitleText = "";

        clearRuntimeWordStatuses?.();

        renderSubtitles();

        renderSubtitleOverlay({
            overlay,
            text: ""
        });

        showToast(t("toastSelectedVideoLoadFailed"), "error", 5000);
    }

    video.addEventListener("loadedmetadata", () => {
        console.log("Restored video loaded:", video.duration);
    }, { once: true });

    video.addEventListener("error", () => {
        console.error("Video restore failed:", video.error);
        showToast("Could not load selected video", "error", 5000);
        dropzone.classList.remove("hidden");
    }, { once: true });
}

function showVideoPickerModal(videos) {
    if (!videoPickerModal || !videoPickerList) {
        return;
    }

    videoPickerList.innerHTML = "";

    videos.forEach((videoInfo) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "video-picker-item";

        const title = document.createElement("div");
        title.className = "video-picker-title";
        title.textContent = videoInfo.filename;

        const subtitle = document.createElement("div");
        subtitle.className = "video-picker-subtitle";
		subtitle.textContent = videoInfo.subtitleFilename
			? t("subtitleFound", { name: videoInfo.subtitleFilename })
			: t("subtitleNotFound");

        item.appendChild(title);
        item.appendChild(subtitle);

        item.addEventListener("click", () => {
            restoreSelectedVideoFromServer(videoInfo);
        });

        videoPickerList.appendChild(item);
    });

    dropzone.classList.add("hidden");
    videoPickerModal.classList.remove("hidden");
}
