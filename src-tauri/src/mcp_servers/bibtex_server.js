#!/usr/bin/env node
/**
 * MCP BibTeX Server
 * Generate, parse, and manage BibTeX citations for academic papers.
 */

const TOOLS = [
    {
        name: 'bibtex_generate',
        description: 'Generate a BibTeX entry from paper metadata (title, authors, year, venue, etc.).',
        inputSchema: {
            type: 'object',
            properties: {
                entry_type: { type: 'string', description: 'Entry type: article, inproceedings, book, misc, phdthesis, techreport', default: 'article' },
                cite_key: { type: 'string', description: 'Citation key, e.g. "smith2023neural"' },
                title: { type: 'string', description: 'Paper title' },
                authors: { type: 'string', description: 'Comma-separated author names, e.g. "John Smith, Jane Doe"' },
                year: { type: 'string', description: 'Publication year' },
                venue: { type: 'string', description: 'Journal or conference name' },
                volume: { type: 'string', description: 'Volume number' },
                number: { type: 'string', description: 'Issue number' },
                pages: { type: 'string', description: 'Page range, e.g. "123-145"' },
                doi: { type: 'string', description: 'DOI' },
                url: { type: 'string', description: 'URL' },
                abstract: { type: 'string', description: 'Abstract (optional)' }
            },
            required: ['cite_key', 'title', 'authors', 'year']
        }
    },
    {
        name: 'bibtex_parse',
        description: 'Parse a BibTeX entry string and extract structured metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                bibtex: { type: 'string', description: 'BibTeX entry string to parse' }
            },
            required: ['bibtex']
        }
    },
    {
        name: 'bibtex_format_citation',
        description: 'Format a citation in various styles (APA, MLA, IEEE, Chicago) from a BibTeX entry.',
        inputSchema: {
            type: 'object',
            properties: {
                bibtex: { type: 'string', description: 'BibTeX entry string' },
                style: { type: 'string', description: 'Citation style: apa, mla, ieee, chicago', default: 'apa' }
            },
            required: ['bibtex']
        }
    },
    {
        name: 'bibtex_generate_from_arxiv',
        description: 'Generate a BibTeX entry from arXiv paper metadata (fetched via arXiv API).',
        inputSchema: {
            type: 'object',
            properties: {
                arxiv_id: { type: 'string', description: 'arXiv ID, e.g. "2301.00001"' }
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

function escapeBibTeX(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\$/g, '\\$')
        .replace(/\&/g, '\\&')
        .replace(/\#/g, '\\#')
        .replace(/\^/g, '\\^{}')
        .replace(/\_/g, '\\_')
        .replace(/\~/g, '\\textasciitilde{}')
        .replace(/%/g, '\\%');
}

function generateBibTeX(args) {
    const type = args.entry_type || 'article';
    const key = args.cite_key;
    const fields = [];

    if (args.title) fields.push(`  title = {${escapeBibTeX(args.title)}}`);
    if (args.authors) fields.push(`  author = {${escapeBibTeX(args.authors)}}`);
    if (args.year) fields.push(`  year = {${args.year}}`);
    if (args.venue) {
        if (type === 'article') fields.push(`  journal = {${escapeBibTeX(args.venue)}}`);
        else if (type === 'inproceedings') fields.push(`  booktitle = {${escapeBibTeX(args.venue)}}`);
        else fields.push(`  journal = {${escapeBibTeX(args.venue)}}`);
    }
    if (args.volume) fields.push(`  volume = {${args.volume}}`);
    if (args.number) fields.push(`  number = {${args.number}}`);
    if (args.pages) fields.push(`  pages = {${args.pages}}`);
    if (args.doi) fields.push(`  doi = {${args.doi}}`);
    if (args.url) fields.push(`  url = {${args.url}}`);
    if (args.abstract) fields.push(`  abstract = {${escapeBibTeX(args.abstract)}}`);

    return `@${type}{${key},\n${fields.join(',\n')}\n}`;
}

function parseBibTeX(bibtex) {
    const entryMatch = bibtex.match(/@\w+\s*\{\s*([^,]+),\s*([\s\S]*)\}/);
    if (!entryMatch) throw new Error('Invalid BibTeX entry format');

    const citeKey = entryMatch[1].trim();
    const body = entryMatch[2];

    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*\{([^}]*)\}/g;
    let m;
    while ((m = fieldRegex.exec(body)) !== null) {
        fields[m[1].toLowerCase()] = m[2].trim();
    }

    return { cite_key: citeKey, fields };
}

function formatCitationAPA(fields) {
    const authors = fields.author || fields.authors || 'Unknown';
    const year = fields.year || 'n.d.';
    const title = fields.title || '';
    const journal = fields.journal || fields.booktitle || fields.venue || '';
    const volume = fields.volume || '';
    const number = fields.number || '';
    const pages = fields.pages || '';
    const doi = fields.doi || '';

    let result = `${authors} (${year}). ${title}`;
    if (journal) result += `. ${journal}`;
    if (volume) result += `, ${volume}`;
    if (number) result += `(${number})`;
    if (pages) result += `, ${pages}`;
    result += '.';
    if (doi) result += ` https://doi.org/${doi}`;
    return result;
}

function formatCitationIEEE(fields) {
    const authors = fields.author || fields.authors || 'Unknown';
    const year = fields.year || 'n.d.';
    const title = fields.title || '';
    const journal = fields.journal || fields.booktitle || fields.venue || '';
    const volume = fields.volume || '';
    const number = fields.number || '';
    const pages = fields.pages || '';

    let result = authors.replace(/,\s*/g, ', ');
    result += `, "${title},"`;
    if (journal) result += ` ${journal}`;
    if (volume) result += `, vol. ${volume}`;
    if (number) result += `, no. ${number}`;
    if (pages) result += `, pp. ${pages}`;
    result += `, ${year}.`;
    return result;
}

function formatCitationMLA(fields) {
    const authors = fields.author || fields.authors || 'Unknown';
    const year = fields.year || 'n.d.';
    const title = fields.title || '';
    const journal = fields.journal || fields.booktitle || fields.venue || '';
    const volume = fields.volume || '';
    const number = fields.number || '';
    const pages = fields.pages || '';

    let result = `${authors}. "${title}."`;
    if (journal) result += ` ${journal}`;
    if (volume) result += `, vol. ${volume}`;
    if (number) result += `, no. ${number}`;
    if (pages) result += `, ${pages}`;
    result += `, ${year}.`;
    return result;
}

function formatCitationChicago(fields) {
    const authors = fields.author || fields.authors || 'Unknown';
    const year = fields.year || 'n.d.';
    const title = fields.title || '';
    const journal = fields.journal || fields.booktitle || fields.venue || '';
    const volume = fields.volume || '';
    const number = fields.number || '';
    const pages = fields.pages || '';

    let result = `${authors}. "${title}."`;
    if (journal) result += ` ${journal}`;
    if (volume) result += ` ${volume}`;
    if (number) result += `, no. ${number}`;
    if (pages) result += ` (${year}): ${pages}.`;
    else result += ` (${year}).`;
    return result;
}

function fetchXml(url) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

const handlers = {
    bibtex_generate: (args) => {
        const bibtex = generateBibTeX(args);
        return { content: [{ type: 'text', text: bibtex }] };
    },

    bibtex_parse: (args) => {
        const parsed = parseBibTeX(args.bibtex);
        const text = `Cite Key: ${parsed.cite_key}\n\nFields:\n${Object.entries(parsed.fields).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`;
        return { content: [{ type: 'text', text }] };
    },

    bibtex_format_citation: (args) => {
        const parsed = parseBibTeX(args.bibtex);
        const fields = parsed.fields;
        const style = args.style || 'apa';

        let citation;
        switch (style.toLowerCase()) {
            case 'apa': citation = formatCitationAPA(fields); break;
            case 'ieee': citation = formatCitationIEEE(fields); break;
            case 'mla': citation = formatCitationMLA(fields); break;
            case 'chicago': citation = formatCitationChicago(fields); break;
            default: citation = formatCitationAPA(fields);
        }

        return { content: [{ type: 'text', text: `[${style.toUpperCase()}] ${citation}` }] };
    },

    bibtex_generate_from_arxiv: async (args) => {
        const id = args.arxiv_id.trim();
        const url = `https://export.arxiv.org/api/query?id_list=${id}`;
        const xml = await fetchXml(url);

        const getText = (tag) => {
            const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
            return match ? match[1].trim() : '';
        };
        const getAttr = (tag, attr) => {
            const match = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`));
            return match ? match[1] : '';
        };

        const title = getText('title').replace(/\s+/g, ' ');
        const authors = [...xml.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]).join(' and ');
        const year = getText('published').split('T')[0].split('-')[0];
        const primaryCategory = getAttr('category', 'term');
        const arxivUrl = getAttr('link', 'href');

        const citeKey = `${authors.split(',')[0].split(' ').pop().toLowerCase()}${year}arxiv`;
        const bibtex = generateBibTeX({
            entry_type: 'article',
            cite_key: citeKey,
            title,
            authors,
            year,
            venue: `arXiv preprint arXiv:${id}`,
            url: arxivUrl,
            abstract: getText('summary').replace(/\s+/g, ' ').substring(0, 500)
        });

        return { content: [{ type: 'text', text: bibtex }] };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'bibtex-server', version: '1.0.0' }
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
        try {
            const handler = handlers[toolName];
            if (!handler) {
                sendError(id, -32601, `Tool not found: ${toolName}`);
                return;
            }
            const result = handler(args);
            if (result && typeof result.then === 'function') {
                result.then(r => sendResponse(id, r)).catch(err => sendError(id, -32603, `Error: ${err.message}`));
            } else {
                sendResponse(id, result);
            }
        } catch (error) {
            sendError(id, -32603, `Error: ${error.message}`);
        }
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
