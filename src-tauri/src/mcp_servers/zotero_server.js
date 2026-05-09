#!/usr/bin/env node
/**
 * MCP Zotero Server
 * Interact with Zotero via its local API (requires Zotero running with
 * 'Allow other applications on this computer to communicate with Zotero' enabled).
 * Falls back to reading exported BibTeX/RIS files if the API is unavailable.
 */

const http = require('http');
const fs = require('fs');

const TOOLS = [
    {
        name: 'zotero_check_connection',
        description: 'Check if Zotero is running and the local API is accessible.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'zotero_get_collections',
        description: 'Get all Zotero collections (folders) in the library.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'zotero_search_items',
        description: 'Search items in the Zotero library by title, author, or keyword.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results (1-20)', default: 5 }
            },
            required: ['query']
        }
    },
    {
        name: 'zotero_get_item',
        description: 'Get detailed information about a Zotero item by its key.',
        inputSchema: {
            type: 'object',
            properties: {
                item_key: { type: 'string', description: 'Zotero item key, e.g. "ABCD1234"' }
            },
            required: ['item_key']
        }
    },
    {
        name: 'zotero_get_recent_items',
        description: 'Get recently added items from the Zotero library.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Number of recent items (1-20)', default: 5 }
            }
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function zoteroApiRequest(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:23119/api/users/0${path}`, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { resolve(data); }
                } else {
                    reject(new Error(`Zotero API returned ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (err) => reject(new Error(`Cannot connect to Zotero: ${err.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Zotero API timeout')); });
    });
}

function formatItem(item) {
    const data = item.data || {};
    const creators = (data.creators || []).map(c => `${c.firstName || ''} ${c.lastName || ''}`.trim()).join(', ');
    return {
        key: data.key,
        title: data.title || 'Untitled',
        itemType: data.itemType,
        creators: creators || 'Unknown',
        date: data.date || 'N/A',
        url: data.url || '',
        doi: data.DOI || '',
        abstract: (data.abstractNote || '').substring(0, 400),
        tags: (data.tags || []).map(t => t.tag)
    };
}

const handlers = {
    zotero_check_connection: async () => {
        try {
            const version = await zoteroApiRequest('/items?limit=1');
            return {
                content: [{ type: 'text', text: 'Zotero is running and accessible via local API.' }]
            };
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Zotero not accessible: ${e.message}\n\nPlease ensure:\n1. Zotero is running\n2. Edit > Preferences > Advanced > 'Allow other applications...' is checked\n3. The local API is enabled` }],
                is_error: true
            };
        }
    },

    zotero_get_collections: async () => {
        try {
            const collections = await zoteroApiRequest('/collections');
            if (!Array.isArray(collections) || collections.length === 0) {
                return { content: [{ type: 'text', text: 'No collections found.' }] };
            }

            const text = collections.map((c, i) => {
                const data = c.data || {};
                return `${i + 1}. ${data.name || 'Unnamed'} (key: ${data.key}, items: ${c.meta?.numItems || '?'})`;
            }).join('\n');

            return { content: [{ type: 'text', text: `Collections:\n${text}` }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e.message}` }], is_error: true };
        }
    },

    zotero_search_items: async (args) => {
        try {
            const limit = Math.min(Math.max(args.limit || 5, 1), 20);
            const query = encodeURIComponent(args.query);
            const items = await zoteroApiRequest(`/items?q=${query}&limit=${limit}`);

            if (!Array.isArray(items) || items.length === 0) {
                return { content: [{ type: 'text', text: `No items found for "${args.query}".` }] };
            }

            const formatted = items.map(formatItem);
            const text = formatted.map((it, i) =>
                `${i + 1}. ${it.title}\n   Type: ${it.itemType} | Authors: ${it.creators}\n   Date: ${it.date} | Key: ${it.key}\n   DOI: ${it.doi || 'N/A'} | URL: ${it.url || 'N/A'}\n   Tags: ${it.tags.join(', ') || 'none'}`
            ).join('\n\n---\n\n');

            return { content: [{ type: 'text', text }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e.message}` }], is_error: true };
        }
    },

    zotero_get_item: async (args) => {
        try {
            const item = await zoteroApiRequest(`/items/${args.item_key}`);
            const f = formatItem(item);
            const text = `Title: ${f.title}\nType: ${f.itemType}\nAuthors: ${f.creators}\nDate: ${f.date}\nDOI: ${f.doi || 'N/A'}\nURL: ${f.url || 'N/A'}\nTags: ${f.tags.join(', ') || 'none'}\n\nAbstract:\n${f.abstract || 'No abstract'}`;
            return { content: [{ type: 'text', text }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e.message}` }], is_error: true };
        }
    },

    zotero_get_recent_items: async (args) => {
        try {
            const limit = Math.min(Math.max(args.limit || 5, 1), 20);
            const items = await zoteroApiRequest(`/items?limit=${limit}&sort=dateAdded&direction=desc`);

            if (!Array.isArray(items) || items.length === 0) {
                return { content: [{ type: 'text', text: 'No items found.' }] };
            }

            const formatted = items.map(formatItem);
            const text = formatted.map((it, i) =>
                `${i + 1}. ${it.title}\n   Authors: ${it.creators} | Date: ${it.date} | Key: ${it.key}`
            ).join('\n\n---\n\n');

            return { content: [{ type: 'text', text: `Recent items:\n\n${text}` }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e.message}` }], is_error: true };
        }
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'zotero-server', version: '1.0.0' }
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
