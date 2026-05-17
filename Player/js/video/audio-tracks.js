class AudioTrackManager {
    constructor(videoEl) {
        this.video = videoEl;
        this.externalAudio = null;
        this.currentTrack = "default";
    }

    async setTrack(trackId, filename) {
        if (trackId === "default") {
            this.destroyExternal();
            this.video.muted = false;
            this.currentTrack = "default";
            return;
        }

        try {
            const { data } = await apiJson("/get-track-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename,
                    trackIndex: trackId
                })
            });

            this.destroyExternal();
            this.externalAudio = document.createElement("audio");
            this.externalAudio.preload = "auto";
            this.externalAudio.src = data.url;
            this.sync();
            this.video.muted = true;
            this.currentTrack = trackId;
        } catch (e) {
            console.error("Track switch error:", e);
        }
    }

    sync() {
        if (!this.externalAudio) return;
        const v = this.video;
        const a = this.externalAudio;
        a.currentTime = v.currentTime;
        a.playbackRate = v.playbackRate;
        a.volume = v.volume;
        if (!v.paused) a.play().catch(() => {});
    }

    pause() {
        if (this.externalAudio) this.externalAudio.pause();
    }

    destroyExternal() {
        if (!this.externalAudio) return;
        this.externalAudio.pause();
        this.externalAudio = null;
    }
}

const audioManager = new AudioTrackManager(video);

volume.oninput = () => {
    video.volume = volume.value;
    if (audioManager.externalAudio) audioManager.externalAudio.volume = volume.value;
};

async function loadAudioTrackList(filename) {
    try {
        const { data } = await apiJson(`/get-audio-tracks?filename=${encodeURIComponent(filename)}`);
        audioTrackSelect.innerHTML = "";
        if (data.tracks && data.tracks.length > 1) {
            data.tracks.forEach((track, index) => {
                const lang = (track.tags?.language || `Track ${index + 1}`).toUpperCase();
                const title = track.tags?.title ? ` (${track.tags.title})` : "";
                const opt = document.createElement("option");
				opt.value = index === 0 ? "default" : track.index;
				opt.textContent = `${lang}${title}`;
                audioTrackSelect.appendChild(opt);
            });
        } else {
            const opt = document.createElement("option");
            opt.value = "default";
            opt.textContent = "Original Audio";
            audioTrackSelect.appendChild(opt);
        }
    } catch (e) {
        console.error("Track load error:", e);
        audioTrackSelect.innerHTML = '<option value="default">DEFAULT</option>';
    }
}

audioTrackSelect.onchange = () => {
    audioManager.setTrack(audioTrackSelect.value, currentVideoFile);
};

video.addEventListener("play", () => {
    audioManager.sync();
    updatePlayButton();
});

video.addEventListener("pause", () => {
    audioManager.pause();
    updatePlayButton();
});

video.addEventListener("seeking", () => {
    audioManager.sync();
});

video.addEventListener("ratechange", () => {
    audioManager.sync();
});

function getValidatedVolume() {
    const input = document.getElementById("audioVol");
    let val = parseFloat(input.value);
    if (val < 0) val = 0;
    if (val > 2) val = 2;
    input.value = val;
    return val;
}

document.getElementById("previewAudioBtn").addEventListener("click", async () => {
    if (!currentVideoFile) return showToast("Video is not selected: " + err.message, "error", 6000);

    const offsetStart = parseFloat(document.getElementById("subOffsetStart").value) || 0;
    const offsetEnd = parseFloat(document.getElementById("subOffsetEnd").value) || 0;
    const depth = parseInt(document.getElementById("subDepth")?.value, 10) || 1;
    const volumeLevel = parseFloat(document.getElementById("audioVol").value) || 1;

	const currentIdx = subtitles.findIndex((s) => (video.currentTime - globalSubDelay) >= s.start && (video.currentTime - globalSubDelay) <= s.end);
	if (currentIdx === -1) return showToast("No active subtitle: " + err.message, "error", 6000);

    const endIdx = Math.min(currentIdx + depth - 1, subtitles.length - 1);
	const start = Math.max(0, subtitles[currentIdx].start + globalSubDelay + offsetStart);
	let end = subtitles[endIdx].end + globalSubDelay + offsetEnd;
    if (end <= start) end = start + 0.5;

    try {
        const { data } = await apiJson("/audio-to-anki", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: currentVideoFile,
                start,
                end,
                trackIndex: audioTrackSelect.value === "default" ? "a:0" : audioTrackSelect.value,
                volume: volumeLevel
            })
        });

        if (data.url) {
            const audioUrl = `${buildApiUrl(data.url)}&t=${Date.now()}`;
            const audio = new Audio(audioUrl);
            audio.volume = Math.min(1.0, Math.max(0.0, volumeLevel));
            audio.play();
        } else {
			showToast("Server error: " + data.error, "error", 6000);
        }
    } catch (err) {
        console.error("Preview failed:", err);
        alert("Error: " + err.message);
    }
});
