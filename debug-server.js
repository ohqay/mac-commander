#!/usr/bin/env node

// Quick debug script to test MCP server tool listing
import { spawn } from 'child_process';

console.log('🔍 Testing MCP Server Tool Discovery...\n');

const server = spawn('node', ['/Users/tarek/development/creating-mcp/mac-commander/build/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errorOutput = '';

server.stdout.on('data', (data) => {
    output += data.toString();
});

server.stderr.on('data', (data) => {
    errorOutput += data.toString();
});

// Send MCP initialization sequence
setTimeout(() => {
    console.log('📡 Sending initialize request...');
    server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "debug-client",
                version: "1.0.0"
            }
        }
    }) + '\n');
}, 500);

setTimeout(() => {
    console.log('📡 Sending initialized notification...');
    server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized"
    }) + '\n');
}, 1000);

setTimeout(() => {
    console.log('📡 Sending tools/list request...');
    server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list"
    }) + '\n');
}, 1500);

setTimeout(() => {
    server.kill();
    
    console.log('\n📊 SERVER RESPONSE:');
    console.log('==================');
    console.log(output);
    
    if (errorOutput) {
        console.log('\n⚠️ ERROR OUTPUT:');
        console.log('================');
        console.log(errorOutput);
    }
    
    // Check if tools are in the response
    if (output.includes('"tools"')) {
        console.log('\n✅ Tools found in response!');
        try {
            const responses = output.split('\n').filter(line => line.trim());
            for (const response of responses) {
                if (response.includes('"tools"')) {
                    const parsed = JSON.parse(response);
                    console.log(`📋 Found ${parsed.result?.tools?.length || 0} tools`);
                    if (parsed.result?.tools?.length > 0) {
                        console.log('🔧 Tool names:', parsed.result.tools.map(t => t.name).join(', '));
                    }
                }
            }
        } catch (e) {
            console.log('❌ Error parsing tools response:', e.message);
        }
    } else {
        console.log('\n❌ No tools found in response');
    }
    
    process.exit(0);
}, 3000);

server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
});