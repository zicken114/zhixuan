#!/usr/bin/env node
/**
 * MCP Calculator Server
 * Perform mathematical calculations safely.
 */

const TOOLS = [
    {
        name: 'calculate',
        description: 'Evaluate a mathematical expression safely. Supports +, -, *, /, ^, sqrt, abs, sin, cos, tan, log, ln, exp, pi, e, parentheses.',
        inputSchema: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: 'Mathematical expression to evaluate, e.g. "sqrt(2) + 3^2"' }
            },
            required: ['expression']
        }
    },
    {
        name: 'convert_units',
        description: 'Convert between common units (length, mass, temperature, time).',
        inputSchema: {
            type: 'object',
            properties: {
                value: { type: 'number', description: 'Value to convert' },
                from_unit: { type: 'string', description: 'Source unit' },
                to_unit: { type: 'string', description: 'Target unit' }
            },
            required: ['value', 'from_unit', 'to_unit']
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function safeCalculate(expr) {
    // Whitelist allowed characters and functions
    const cleaned = expr
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/pi/g, `(${Math.PI})`)
        .replace(/e(?![a-z])/g, `(${Math.E})`);

    // Validate: only allow digits, operators, parens, dot, and known functions
    const validPattern = /^[0-9+\-*/().^]+|sqrt|abs|sin|cos|tan|log|ln|exp$/;
    const tokens = cleaned.match(/\d+\.?\d*|sqrt|abs|sin|cos|tan|log|ln|exp|[+\-*/().^]/g) || [];
    const reconstructed = tokens.join('');

    if (reconstructed !== cleaned) {
        throw new Error('Expression contains invalid characters or functions');
    }

    // Replace ^ with ** for JS evaluation
    const jsExpr = cleaned
        .replace(/\^/g, '**')
        .replace(/sqrt\(/g, 'Math.sqrt(')
        .replace(/abs\(/g, 'Math.abs(')
        .replace(/sin\(/g, 'Math.sin(')
        .replace(/cos\(/g, 'Math.cos(')
        .replace(/tan\(/g, 'Math.tan(')
        .replace(/log\(/g, 'Math.log10(')
        .replace(/ln\(/g, 'Math.log(')
        .replace(/exp\(/g, 'Math.exp(');

    // Double-check no remaining letters
    if (/[a-z]/.test(jsExpr.replace(/math\./gi, ''))) {
        throw new Error('Expression contains invalid characters');
    }

    const result = Function('"use strict"; return (' + jsExpr + ')')();
    return Number(result);
}

const unitConversions = {
    length: {
        m: 1, km: 1000, cm: 0.01, mm: 0.001,
        ft: 0.3048, in: 0.0254, yd: 0.9144, mi: 1609.34
    },
    mass: {
        kg: 1, g: 0.001, mg: 0.000001,
        lb: 0.453592, oz: 0.0283495
    },
    time: {
        s: 1, min: 60, h: 3600, d: 86400,
        ms: 0.001, week: 604800
    }
};

function convertUnits(value, from, to) {
    for (const category of Object.keys(unitConversions)) {
        const units = unitConversions[category];
        if (units[from] !== undefined && units[to] !== undefined) {
            const base = value * units[from];
            return base / units[to];
        }
    }
    // Temperature
    if (from === 'c' && to === 'f') return value * 9 / 5 + 32;
    if (from === 'f' && to === 'c') return (value - 32) * 5 / 9;
    if (from === 'c' && to === 'k') return value + 273.15;
    if (from === 'k' && to === 'c') return value - 273.15;
    if (from === 'f' && to === 'k') return (value - 32) * 5 / 9 + 273.15;
    if (from === 'k' && to === 'f') return (value - 273.15) * 9 / 5 + 32;

    throw new Error(`Unsupported unit conversion: ${from} -> ${to}`);
}

const handlers = {
    calculate: (args) => {
        const result = safeCalculate(args.expression);
        return {
            content: [{ type: 'text', text: `Result: ${result}` }]
        };
    },

    convert_units: (args) => {
        const result = convertUnits(args.value, args.from_unit.toLowerCase(), args.to_unit.toLowerCase());
        return {
            content: [{ type: 'text', text: `${args.value} ${args.from_unit} = ${result.toFixed(6)} ${args.to_unit}` }]
        };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'calculator-server', version: '1.0.0' }
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
            sendResponse(id, result);
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
