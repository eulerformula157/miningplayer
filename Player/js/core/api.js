const API_BASE = window.location.origin;

function buildApiUrl(path) {
    return `${API_BASE}${path}`;
}

async function apiJson(path, options = {}) {
    const response = await fetch(buildApiUrl(path), options);
    const data = await response.json();
    return { response, data };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, {
    retries = 5,
    delayMs = 800,
    label = "request"
} = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            return await fetch(url, options);
        } catch (err) {
            lastError = err;

            console.warn(
                `${label} failed ${attempt}/${retries}:`,
                err.message
            );

            if (attempt < retries) {
                await sleep(delayMs * attempt);
            }
        }
    }

    throw lastError;
}


