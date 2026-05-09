#!/usr/bin/env node
/**
 * MCP Filesystem Server
 * Provides file system operations via MCP protocol over stdio.
 */

const fs = require('fs');
const path = require('path');

// Supported tools definition
const TOOLS = [
    {
        name: 'fs_read_file',
        description: 'Read the contents of a file. Returns the file content as text.',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Absolute path to the file' }
            },
            required: ['file_path']
        }
    },
    {
        name: 'fs_write_file',
        description: 'Write content to a file. Creates the file if it does not exist.',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Absolute path to the file' },
                content: { type: 'string', description: 'Content to write' }
            },
            required: ['file_path', 'content']
        }
    },
    {
        name: 'fs_list_directory',
        description: 'List the contents of a directory. Returns files and subdirectories.',
        inputSchema: {
            type: 'object',
            properties: {
                directory_path: { type: 'string', description: 'Absolute path to the directory' }
            },
            required: ['directory_path']
        }
    },
    {
        name: 'fs_search_files',
        description: 'Search for files matching a pattern in a directory.',
        inputSchema: {
            type: 'object',
            properties: {
                directory_path: { type: 'string', description: 'Directory to search in' },
                pattern: { type: 'string', description: 'Search pattern (glob-like, e.g., "*.pdf")' }
            },
            required: ['directory_path', 'pattern']
        }
    },
    {
        name: 'fs_file_info',
        description: 'Get information about a file (size, modified time, etc.).',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: 'Absolute path to the file' }
            },
            required: ['file_path']
        }
    }
];

let requestId = 0;

function sendResponse(id, result) {
    const response = {
        jsonrpc: '2.0',
        id: id,
        result: result
    };
    console.log(JSON.stringify(response));
}

function sendError(id, code, message) {
    const response = {
        jsonrpc: '2.0',
        id: id,
        error: { code, message }
    };
    console.log(JSON.stringify(response));
}

function sendNotification(method, params) {
    const notification = {
        jsonrpc: '2.0',
        method: method,
        params: params
    };
    console.log(JSON.stringify(notification));
}

// Tool handlers
const handlers = {
    fs_read_file: (args) => {
        const filePath = args.file_path;
        const content = fs.readFileSync(filePath, 'utf-8');
        return {
            content: [{ type: 'text', text: content }]
        };
    },

    fs_write_file: (args) => {
        const filePath = args.file_path;
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf-8');
        return {
            content: [{ type: 'text', text: `File written successfully: ${filePath}` }]
        };
    },

    fs_list_directory: (args) => {
        const dirPath = args.directory_path;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            is_file: entry.isFile(),
            is_directory: entry.isDirectory()
        }));
        return {
            content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
        };
    },

    fs_search_files: (args) => {
        const dirPath = args.directory_path;
        const pattern = args.pattern;
        const results = [];

        function searchDir(currentPath) {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    searchDir(fullPath);
                } else if (entry.name.includes(pattern.replace('*', '')) ||
                           new RegExp(pattern.replace(/\*/g, '.*')).test(entry.name)) {
                    results.push(fullPath);
                }
            }
        }

        searchDir(dirPath);
        return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
    },

    fs_file_info: (args) => {
        const filePath = args.file_path;
        const stats = fs.statSync(filePath);
        const info = {
            path: filePath,
            size: stats.size,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            is_file: stats.isFile(),
            is_directory: stats.isDirectory()
        };
        return {
            content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
        };
    }
};

// Main request handler
function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'filesystem-server', version: '1.0.0' }
        });
        return;
    }

    if (method === 'notifications/initialized') {
        // No response needed for notifications
        return;
    }

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
            sendResponse(id, result);
        } catch (error) {
            sendError(id, -32603, `Tool execution error: ${error.message}`);
        }
        return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
}

// Read lines from stdin
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', (line) => {
    try {
        const request = JSON.parse(line);
        handleRequest(request);
    } catch (error) {
        console.error(`Parse error: ${error.message}`);
    }
});

rl.on('close', () => {
    process.exit(0);
});
