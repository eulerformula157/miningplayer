const testSubtitleHighlighter = {
    enabled: true,

    getStatusForTextToken(token) {
        const clean = String(token || "")
            .trim()
            .replace(/[.,!?;:()[\]'"「」『』。、！？]/g, "");

        if (clean === "やはり") return "new";
        if (clean === "known") return "mature";
        if (clean === "learning") return "learning";

        return "unknown";
    },

    statusSettings: {
        new: { enabled: true, color: "#ffcc66" },
        learning: { enabled: true, color: "#66ccff" },
        young: { enabled: true, color: "#66ccff" },
        mature: { enabled: true, color: "#88ff88" },
        suspended: { enabled: true, color: "#999999" },
        unknown: { enabled: false, color: "#ffffff" }
    }
};