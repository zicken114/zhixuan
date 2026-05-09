#!/usr/bin/env node
/**
 * MCP arXiv Search Server
 * Search academic papers on arXiv (no API key required).
 */

const https = require('https');

const TOOLS = [
    {
        name: 'arxiv_search',
        description: 'Search academic papers on arXiv by keywords, title, author, or abstract.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query (keywords, title, etc.)' },
                max_results: { type: 'number', description: 'Max results (1-20)', default: 5 },
                sort_by: { type: 'string', description: 'relevance | submittedDate | lastUpdatedDate', default: 'relevance' }
            },
            required: ['query']
        }
    },
    {
        name: 'arxiv_get_paper',
        description: 'Get detailed information about an arXiv paper by its ID.',
        inputSchema: {
            type: 'object',
            properties: {
                arxiv_id: { type: 'string', description: 'arXiv ID, e.g. 2301.00001' }
            },
            required: ['arxiv_id']
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function fetchXml(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function parseAtomEntry(entryXml) {
    const getText = (tag) => {
        const match = entryXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return match ? match[1].trim() : '';
    };
    const getAttr = (tag, attr) => {
        const match = entryXml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`));
        return match ? match[1] : '';
    };

    return {
        id: getText('id'),
        title: getText('title').replace(/\s+/g, ' '),
        summary: getText('summary').replace(/\s+/g, ' ').substring(0, 800),
        authors: [...entryXml.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]),
        published: getText('published').split('T')[0],
        updated: getText('updated').split('T')[0],
        pdf_url: getAttr('link', 'href'),
        primary_category: getAttr('category', 'term')
    };
}

function parseArxivAtom(xml) {
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
        entries.push(parseAtomEntry(match[0]));
    }
    return entries;
}

const handlers = {
    arxiv_search: async (args) => {
        const query = encodeURIComponent(args.query);
        const max = Math.min(Math.max(args.max_results || 5, 1), 20);
        const sort = args.sort_by || 'relevance';
        const sortMap = { relevance: 'relevance', submittedDate: 'submittedDate', lastUpdatedDate: 'lastUpdatedDate' };
        const sortBy = sortMap[sort] || 'relevance';

        const url = `https://export.arxiv.org/api/query?search_query=all:${query}&start=0&max_results=${max}&sortBy=${sortBy}&sortOrder=descending`;

        const xml = await fetchXml(url);
        const entries = parseArxivAtom(xml);

        if (entries.length === 0) {
            return { content: [{ type: 'text', text: 'No papers found on arXiv.' }] };
        }

        const text = entries.map((p, i) =>
            `${i + 1}. ${p.title}\n   Authors: ${p.authors.join(', ')}\n   ID: ${p.id}\n   PDF: ${p.pdf_url}\n   Published: ${p.published}\n   Category: ${p.primary_category}\n   Abstract: ${p.summary}`
        ).join('\n\n---\n\n');

        return { content: [{ type: 'text', text }] };
    },

    arxiv_get_paper: async (args) => {
        const id = args.arxiv_id.trim();
        const url = `https://export.arxiv.org/api/query?id_list=${id}`;

        const xml = await fetchXml(url);
        const entries = parseArxivAtom(xml);

        if (entries.length === 0) {
            return { content: [{ type: 'text', text: `Paper ${id} not found.` }] };
        }

        const p = entries[0];
        const text = `Title: ${p.title}\nAuthors: ${p.authors.join(', ')}\nID: ${p.id}\nPDF: ${p.pdf_url}\nPublished: ${p.published}\nCategory: ${p.primary_category}\n\nAbstract:\n${p.summary}`;

        return { content: [{ type: 'text', text }] };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'arxiv-search-server', version: '1.0.0' }
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
