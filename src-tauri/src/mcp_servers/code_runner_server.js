#!/usr/bin/env node
/**
 * MCP Code Runner Server
 * Safely execute Python code snippets in a sandboxed environment.
 * Requires Python 3 to be installed on the system.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOOLS = [
    {
        name: 'run_python',
        description: 'Execute a Python code snippet safely. Returns stdout, stderr, and execution time. Supports numpy, pandas, matplotlib (if installed).',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Python code to execute' },
                timeout_seconds: { type: 'number', description: 'Execution timeout in seconds (1-60)', default: 10 },
                keep_temp_files: { type: 'boolean', description: 'Keep temporary script file for debugging', default: false }
            },
            required: ['code']
        }
    },
    {
        name: 'run_python_with_data',
        description: 'Execute Python code with input data (JSON). Useful for data analysis and transformation.',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Python code. Access input data via the "data" variable.' },
                input_data: { type: 'object', description: 'JSON data available as "data" variable in Python' },
                timeout_seconds: { type: 'number', description: 'Execution timeout (1-60)', default: 10 }
            },
            required: ['code']
        }
    },
    {
        name: 'check_python_environment',
        description: 'Check the Python environment: version, available packages (numpy, pandas, scipy, matplotlib, sympy).',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

function sendResponse(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function runPython(code, timeoutSeconds = 10) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(os.tmpdir(), `mcp_python_${Date.now()}.py`);
        fs.writeFileSync(tmpFile, code, 'utf-8');

        const startTime = Date.now();
        const proc = spawn('python', [tmpFile], {
            timeout: timeoutSeconds * 1000,
            killSignal: 'SIGKILL'
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            fs.unlinkSync(tmpFile);
            const duration = Date.now() - startTime;
            resolve({
                exit_code: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                duration_ms: duration
            });
        });

        proc.on('error', (err) => {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
            reject(err);
        });
    });
}

function sanitizeCode(code) {
    const dangerousPatterns = [
        /\bimport\s+os\b/,
        /\bimport\s+subprocess\b/,
        /\bimport\s+sys\b/,
        /\b__import__\b/,
        /\beval\s*\(/,
        /\bexec\s*\(/,
        /\bcompile\s*\(/,
        /\bopen\s*\(/,
        /\bfile\s*\(/,
        /\bos\.system\b/,
        /\bos\.popen\b/,
        /\bsubprocess\./,
        /\bpty\./,
        /\bsocket\./,
        /\burllib\.request\.urlopen\b/,
        /\brequests\.(get|post|put|delete)\b/
    ];

    const warnings = [];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
            warnings.push(`Potentially dangerous pattern detected: ${pattern.source}`);
        }
    }

    return warnings;
}

const handlers = {
    run_python: async (args) => {
        const code = args.code;
        const timeout = Math.min(Math.max(args.timeout_seconds || 10, 1), 60);

        const warnings = sanitizeCode(code);
        if (warnings.length > 0) {
            return {
                content: [{ type: 'text', text: `Security warnings:\n${warnings.join('\n')}\n\nExecution blocked for safety. Remove dangerous patterns and try again.` }],
                is_error: true
            };
        }

        const wrapperCode = `
# -*- coding: utf-8 -*-
import json
import math
import random
import statistics
import itertools
import collections
import datetime
import fractions
import decimal

# Sandbox: restrict file system access
_original_open = open
def _sandbox_open(*args, **kwargs):
    raise PermissionError("File operations are disabled in the sandbox")
open = _sandbox_open

try:
${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
`;

        const result = await runPython(wrapperCode, timeout);

        const text = [
            `Exit code: ${result.exit_code}`,
            `Duration: ${result.duration_ms}ms`,
            '--- stdout ---',
            result.stdout || '(no output)',
        ];
        if (result.stderr) {
            text.push('--- stderr ---');
            text.push(result.stderr);
        }

        return {
            content: [{ type: 'text', text: text.join('\n') }],
            is_error: result.exit_code !== 0 || result.stderr.length > 0
        };
    },

    run_python_with_data: async (args) => {
        const code = args.code;
        const inputData = args.input_data || {};
        const timeout = Math.min(Math.max(args.timeout_seconds || 10, 1), 60);

        const warnings = sanitizeCode(code);
        if (warnings.length > 0) {
            return {
                content: [{ type: 'text', text: `Security warnings:\n${warnings.join('\n')}\n\nExecution blocked for safety.` }],
                is_error: true
            };
        }

        const dataJson = JSON.stringify(inputData);
        const wrapperCode = `
# -*- coding: utf-8 -*-
import json
import math
import random
import statistics
import itertools
import collections
import datetime

data = json.loads('''${dataJson.replace(/'/g, "\\'")}''')

# Sandbox: restrict file system access
_original_open = open
def _sandbox_open(*args, **kwargs):
    raise PermissionError("File operations are disabled in the sandbox")
open = _sandbox_open

try:
${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
`;

        const result = await runPython(wrapperCode, timeout);

        const text = [
            `Exit code: ${result.exit_code}`,
            `Duration: ${result.duration_ms}ms`,
            '--- stdout ---',
            result.stdout || '(no output)',
        ];
        if (result.stderr) {
            text.push('--- stderr ---');
            text.push(result.stderr);
        }

        return {
            content: [{ type: 'text', text: text.join('\n') }],
            is_error: result.exit_code !== 0 || result.stderr.length > 0
        };
    },

    check_python_environment: async () => {
        const checkCode = `
import sys
print(f"Python version: {sys.version}")
packages = ['numpy', 'pandas', 'scipy', 'matplotlib', 'sympy', 'sklearn']
for pkg in packages:
    try:
        __import__(pkg)
        print(f"  {pkg}: available")
    except ImportError:
        print(f"  {pkg}: not installed")
`;
        const result = await runPython(checkCode, 15);
        return {
            content: [{ type: 'text', text: result.stdout || 'Could not check environment' }]
        };
    }
};

function handleRequest(request) {
    const { method, params, id } = request;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'code-runner-server', version: '1.0.0' }
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
