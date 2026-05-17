function getSubtitleHighlightSettings() {
    return {
        enabled: document.getElementById("subtitleHighlightEnabled")?.checked === true,

        statusSettings: {
            new: {
                enabled: true,
                color: document.getElementById("highlightColorNew")?.value || "#77b7d8"
            },
            learning: {
                enabled: true,
                color: document.getElementById("highlightColorLearning")?.value || "#ff8a3d"
            },
            young: {
                enabled: true,
                color: document.getElementById("highlightColorYoung")?.value || "#7ec77a"
            },
            mature: {
                enabled: true,
                color: document.getElementById("highlightColorMature")?.value || "#2f9d4f"
            },
            suspended: {
                enabled: true,
                color: document.getElementById("highlightColorSuspended")?.value || "#ffde4a"
            },
            unknown: {
                enabled: false,
                color: document.getElementById("highlightColorUnknown")?.value || "#ffffff"
            }
        }
    };
}



