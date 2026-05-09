#!/usr/bin/env node
/**
 * MCP Translator Server
 * Academic translation using free translation APIs.
 * Falls back to LibreTranslate (free public instances) and Argos Translate.
 * For production use, recommend adding API keys for DeepL or Google Translate.
 */

const https = require('https');

const TOOLS = [
    {
        name: 'translate_text',
        description: 'Translate text between languages. Supports academic/technical text.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to translate' },
                source_lang: { type: 'string', description: 'Source language code (e.g. "en", "zh", "ja", "de", "fr", "es")', default: 'auto' },
                target_lang: { type: 'string', description: 'Target language code (e.g. "en", "zh", "ja")', default: 'en' }
            },
            required: ['text', 'target_lang']
        }
    },
    {
        name: 'detect_language',
        description: 'Detect the language of a given text.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to analyze' }
            },
            required: ['text']
        }
    },
    {
        name: 'translate_academic',
        description: 'Translate academic text with improved handling of technical terms. Preserves LaTeX formulas and citations.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Academic text to translate' },
                source_lang: { type: 'string', description: 'Source language code', default: 'auto' },
                target_lang: { type: 'string', description: 'Target language code', default: 'en' }
            },
            required: ['text', 'target_lang']
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function httpPost(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ai-research-assistant/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({ raw: body }); }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(JSON.stringify(data));
        req.end();
    });
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'ai-research-assistant/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve({ raw: data }); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

// Known LibreTranslate public instances
const LT_INSTANCES = [
    'https://libretranslate.de',
    'https://translate.argosopentech.com',
    'https://libretranslate.pussthecat.org'
];

async function tryLibreTranslate(text, source, target) {
    const body = {
        q: text,
        source: source === 'auto' ? 'auto' : source,
        target: target,
        format: 'text'
    };

    for (const instance of LT_INSTANCES) {
        try {
            const result = await httpPost(`${instance}/translate`, body);
            if (result.translatedText) {
                return { text: result.translatedText, source: result.detectedLanguage?.language || source, engine: 'libretranslate' };
            }
        } catch (_) {
            continue;
        }
    }
    throw new Error('All translation services temporarily unavailable');
}

async function detectLanguageLibre(text) {
    for (const instance of LT_INSTANCES) {
        try {
            const result = await httpPost(`${instance}/detect`, { q: text });
            if (Array.isArray(result) && result.length > 0) {
                return { language: result[0].language, confidence: result[0].confidence, engine: 'libretranslate' };
            }
        } catch (_) {
            continue;
        }
    }
    throw new Error('Language detection service unavailable');
}

function simpleDetect(text) {
    // Very basic heuristic fallback
    const langPatterns = {
        zh: /[\u4e00-\u9fff]/,
        ja: /[\u3040-\u309f\u30a0-\u30ff]/,
        ko: /[\uac00-\ud7af]/,
        ar: /[\u0600-\u06ff]/,
        ru: /[\u0400-\u04ff]/,
        de: /\b(der|die|das|und|ist|von|für|mit|auf|ein)\b/i,
        fr: /\b(le|la|les|et|est|pour|avec|sur|une)\b/i,
        es: /\b(el|la|los|las|y|es|para|con|en|un)\b/i
    };

    for (const [lang, pattern] of Object.entries(langPatterns)) {
        if (pattern.test(text)) return { language: lang, confidence: 0.5, engine: 'heuristic' };
    }
    return { language: 'en', confidence: 0.3, engine: 'heuristic' };
}

function preserveLaTeX(text) {
    // Extract LaTeX formulas to preserve them during translation
    const formulas = [];
    let idx = 0;
    const protectedText = text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, (match) => {
        const placeholder = `__LATEX_${idx}__`;
        formulas.push(match);
        idx++;
        return placeholder;
    });
    return { text: protectedText, formulas };
}

function restoreLaTeX(text, formulas) {
    let result = text;
    for (let i = 0; i < formulas.length; i++) {
        result = result.replace(`__LATEX_${i}__`, formulas[i]);
    }
    return result;
}

const handlers = {
    translate_text: async (args) => {
        const text = args.text;
        const source = args.source_lang || 'auto';
        const target = args.target_lang;

        if (!text || text.trim().length === 0) {
            return { content: [{ type: 'text', text: '' }] };
        }

        const result = await tryLibreTranslate(text, source, target);
        return {
            content: [{
                type: 'text',
                text: `${result.text}\n\n[Translated from ${result.source} to ${target} via ${result.engine}]`
            }]
        };
    },

    detect_language: async (args) => {
        const text = args.text;
        if (!text || text.trim().length === 0) {
            return { content: [{ type: 'text', text: 'No text provided.' }] };
        }

        try {
            const result = await detectLanguageLibre(text);
            return {
                content: [{
                    type: 'text',
                    text: `Detected language: ${result.language}\nConfidence: ${(result.confidence * 100).toFixed(1)}%\nEngine: ${result.engine}`
                }]
            };
        } catch (e) {
            const fallback = simpleDetect(text);
            return {
                content: [{
                    type: 'text',
                    text: `Detected language: ${fallback.language} (heuristic fallback, low confidence)\nEngine: ${fallback.engine}`
                }]
            };
        }
    },

    translate_academic: async (args) => {
        const text = args.text;
        const source = args.source_lang || 'auto';
        const target = args.target_lang;

        if (!text || text.trim().length === 0) {
            return { content: [{ type: 'text', text: '' }] };
        }

        // Preserve LaTeX formulas
        const { text: protectedText, formulas } = preserveLaTeX(text);

        // Preserve citations like [1], [Smith et al., 2023]
        const citations = [];
        let citeIdx = 0;
        const textNoCite = protectedText.replace(/\[[\d,\s-]+\]|\[[A-Za-z][^\]]+\d{4}[^\]]*\]/g, (match) => {
            const placeholder = `__CITE_${citeIdx}__`;
            citations.push(match);
            citeIdx++;
            return placeholder;
        });

        const result = await tryLibreTranslate(textNoCite, source, target);
        let translated = restoreLaTeX(result.text, formulas);
        for (let i = 0; i < citations.length; i++) {
            translated = translated.replace(`__CITE_${i}__`, citations[i]);
        }

        return {
            content: [{
                type: 'text',
                text: `${translated}\n\n[Academic translation from ${result.source} to ${target} via ${result.engine}. LaTeX and citations preserved.]`
            }]
        };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'translator-server', version: '1.0.0' }
        });
        return;
    }

    if (method === 'notifications/initialized') return;

    if (method === 'tools/list') {
        sendResponse(id, { tools: TOOLS });
        return;
    }

    if (method === 'tools/call') {
        const toolName = params.name;
        const args = params.arguments || {};
        const handler = handlers[toolName];
        if (!handler) {
            sendError(id, -32601, `Tool not found: ${toolName}`);
            return;
        }
        Promise.resolve(handler(args))
            .then(result => sendResponse(id, result))
            .catch(err => sendError(id, -32603, `Error: ${err.message}`));
        return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
}

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    try {
        const request = JSON.parse(line);
        handleRequest(request);
    } catch (error) {
        console.error(`Parse error: ${error.message}`);
    }
});

rl.on('close', () => process.exit(0));
