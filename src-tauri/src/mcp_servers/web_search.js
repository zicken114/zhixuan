#!/usr/bin/env node
/**
 * MCP Web Search Server
 * Search the web via DuckDuckGo (no API key required).
 */

const https = require('https');

const TOOLS = [
    {
        name: 'web_search',
        description: 'Search the web using DuckDuckGo. Returns top search results with title, URL, and snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                num_results: { type: 'number', description: 'Number of results (1-10)', default: 5 }
            },
            required: ['query']
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function parseDuckDuckGoResults(html) {
    const results = [];
    // DuckDuckGo lite results
    const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null) {
        const url = match[1].replace(/&amp;/g, '&');
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        const snippet = match[3].replace(/<[^>]+>/g, '').trim();
        if (title && url && !url.startsWith('/')) {
            results.push({ title, url, snippet });
        }
    }
    return results;
}

const handlers = {
    web_search: async (args) => {
        const query = encodeURIComponent(args.query);
        const num = Math.min(Math.max(args.num_results || 5, 1), 10);
        const url = `https://html.duckduckgo.com/html/?q=${query}`;

        const html = await fetchHtml(url);
        const results = parseDuckDuckGoResults(html).slice(0, num);

        if (results.length === 0) {
            return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const text = results.map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
        ).join('\n\n');

        return { content: [{ type: 'text', text }] };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'web-search-server', version: '1.0.0' }
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
