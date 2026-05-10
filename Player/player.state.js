let currentLang = "en";

let isResizing = false;
let subtitles = [];
let globalSubDelay = 0;
let subtitleElements = [];
let currentVideoFile = null;
let lastClickedSubtitleIdx = null;
let lastSidebarWidth = "";
let lastRuntimeSubtitleText = "";
let runtimePrefetchAllRunId = 0;
let runtimePrefetchAllInProgress = false;
let selectedKnownBasicWord = "";

let subtitleSearchQuery = "";
let subtitleSearchMatches = [];
let subtitleSearchIndex = -1;
let subtitleSearchMode = "word";
let subtitleSearchTimeSeconds = null;

let deckNoteRefreshTimer = null;

let runtimeHighlightPrefetchReady = false;