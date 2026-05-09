#!/usr/bin/env node
/**
 * MCP Semantic Scholar Server
 * Search academic papers via Semantic Scholar API (no API key required for basic use).
 */

const https = require('https');

const TOOLS = [
    {
        name: 's2_search_papers',
        description: 'Search academic papers on Semantic Scholar by keywords, title, or topic. Returns papers with citation count, abstract, and venue.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query (keywords, title, etc.)' },
                fields: { type: 'string', description: 'Comma-separated fields to return: title,authors,year,abstract,citationCount,venue,pdf', default: 'title,authors,year,abstract,citationCount,venue' },
                limit: { type: 'number', description: 'Max results (1-20)', default: 5 }
            },
            required: ['query']
        }
    },
    {
        name: 's2_get_paper_details',
        description: 'Get detailed information about a paper by its Semantic Scholar paperId or DOI.',
        inputSchema: {
            type: 'object',
            properties: {
                paper_id: { type: 'string', description: 'Semantic Scholar paperId, DOI, arXiv ID, or corpus ID' }
            },
            required: ['paper_id']
        }
    },
    {
        name: 's2_get_citations',
        description: 'Get papers that cite a given paper.',
        inputSchema: {
            type: 'object',
            properties: {
                paper_id: { type: 'string', description: 'Semantic Scholar paperId' },
                limit: { type: 'number', description: 'Max results (1-20)', default: 5 }
            },
            required: ['paper_id']
        }
    },
    {
        name: 's2_get_references',
        description: 'Get papers referenced by a given paper.',
        inputSchema: {
            type: 'object',
            properties: {
                paper_id: { type: 'string', description: 'Semantic Scholar paperId' },
                limit: { type: 'number', description: 'Max results (1-20)', default: 5 }
            },
            required: ['paper_id']
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'ai-research-assistant/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function formatPaper(p) {
    const authors = (p.authors || []).map(a => a.name).join(', ');
    const year = p.year || 'N/A';
    const citations = p.citationCount !== undefined ? p.citationCount : 'N/A';
    const venue = p.venue || 'N/A';
    const abstract = (p.abstract || 'No abstract available').replace(/\s+/g, ' ').substring(0, 600);
    return `Title: ${p.title}\nAuthors: ${authors}\nYear: ${year} | Venue: ${venue} | Citations: ${citations}\nAbstract: ${abstract}`;
}

const handlers = {
    s2_search_papers: async (args) => {
        const query = encodeURIComponent(args.query);
        const limit = Math.min(Math.max(args.limit || 5, 1), 20);
        const fields = args.fields || 'title,authors,year,abstract,citationCount,venue';
        const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&fields=${fields}&limit=${limit}`;

        const data = await fetchJson(url);
        const papers = data.data || [];

        if (papers.length === 0) {
            return { content: [{ type: 'text', text: 'No papers found on Semantic Scholar.' }] };
        }

        const text = papers.map((p, i) => `${i + 1}. ${formatPaper(p)}`).join('\n\n---\n\n');
        return { content: [{ type: 'text', text }] };
    },

    s2_get_paper_details: async (args) => {
        const id = encodeURIComponent(args.paper_id);
        const url = `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=title,authors,year,abstract,citationCount,venue,pdf,references,citations,tldr`;

        const p = await fetchJson(url);
        if (p.error) {
            return { content: [{ type: 'text', text: `Error: ${p.error}` }] };
        }

        const tldr = p.tldr ? p.tldr.text : 'No TL;DR available';
        const text = `${formatPaper(p)}\n\nTL;DR: ${tldr}\nPDF: ${p.pdf || 'N/A'}`;
        return { content: [{ type: 'text', text }] };
    },

    s2_get_citations: async (args) => {
        const id = encodeURIComponent(args.paper_id);
        const limit = Math.min(Math.max(args.limit || 5, 1), 20);
        const url = `https://api.semanticscholar.org/graph/v1/paper/${id}/citations?fields=title,authors,year,abstract,citationCount,venue&limit=${limit}`;

        const data = await fetchJson(url);
        const papers = (data.data || []).map(item => item.citingPaper);

        if (papers.length === 0) {
            return { content: [{ type: 'text', text: 'No citing papers found.' }] };
        }

        const text = papers.map((p, i) => `${i + 1}. ${formatPaper(p)}`).join('\n\n---\n\n');
        return { content: [{ type: 'text', text }] };
    },

    s2_get_references: async (args) => {
        const id = encodeURIComponent(args.paper_id);
        const limit = Math.min(Math.max(args.limit || 5, 1), 20);
        const url = `https://api.semanticscholar.org/graph/v1/paper/${id}/references?fields=title,authors,year,abstract,citationCount,venue&limit=${limit}`;

        const data = await fetchJson(url);
        const papers = (data.data || []).map(item => item.citedPaper);

        if (papers.length === 0) {
            return { content: [{ type: 'text', text: 'No references found.' }] };
        }

        const text = papers.map((p, i) => `${i + 1}. ${formatPaper(p)}`).join('\n\n---\n\n');
        return { content: [{ type: 'text', text }] };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'semantic-scholar-server', version: '1.0.0' }
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
