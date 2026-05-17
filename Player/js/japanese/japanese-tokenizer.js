let japaneseTokenizerPromise = null;
let japaneseTokenizerInstance = null;

function getJapaneseTokenizer() {
    if (japaneseTokenizerPromise) {
        return japaneseTokenizerPromise;
    }

    japaneseTokenizerPromise = new Promise((resolve, reject) => {
        if (typeof kuromoji === "undefined") {
            reject(new Error("kuromoji.js is not loaded"));
            return;
        }

        kuromoji.builder({
            dicPath: "libs/kuromoji/dict/"
        }).build((err, tokenizer) => {
            if (err) {
                reject(err);
                return;
            }

            japaneseTokenizerInstance = tokenizer;
            console.log("Japanese tokenizer loaded");
            resolve(tokenizer);
        });
    });

    return japaneseTokenizerPromise;
}

async function tokenizeJapaneseText(text) {
    const tokenizer = await getJapaneseTokenizer();
    return tokenizer.tokenize(String(text || ""));
}

function tokenizeJapaneseTextSync(text) {
    if (!japaneseTokenizerInstance) return null;
    return japaneseTokenizerInstance.tokenize(String(text || ""));
}