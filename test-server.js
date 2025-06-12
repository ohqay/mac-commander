#!/usr/bin/env node

/**
 * Test script for macOS Simulator MCP Server
 * This demonstrates how to test the server locally
 */

import { spawn } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Starting macOS Simulator MCP Server test...\n');

// Start the server
const server = spawn('node', ['build/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let requestId = 1;

// Helper to send JSON-RPC request
function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };
  
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Handle server responses
server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      console.log('Response:', JSON.stringify(response, null, 2));
    } catch (e) {
      // Not JSON, might be a log message
      if (line.trim()) {
        console.log('Server:', line);
      }
    }
  }
});

// Test sequence
async function runTests() {
  console.log('\n1. Initializing connection...');
  sendRequest('initialize', {
    protocolVersion: '2024-11-01',
    capabilities: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n2. Listing available tools...');
  sendRequest('tools/list', {});
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n3. Getting screen info...');
  sendRequest('tools/call', {
    name: 'get_screen_info',
    arguments: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n4. Taking a screenshot...');
  sendRequest('tools/call', {
    name: 'screenshot',
    arguments: {
      outputPath: './test-screenshot.png'
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n5. Listing windows...');
  sendRequest('tools/call', {
    name: 'list_windows',
    arguments: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n6. Checking for errors on screen...');
  sendRequest('tools/call', {
    name: 'check_for_errors',
    arguments: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n7. Extracting text from screen...');
  sendRequest('tools/call', {
    name: 'extract_text',
    arguments: {
      region: {
        x: 100,
        y: 100,
        width: 500,
        height: 300
      }
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('\nTest complete! Press Ctrl+C to exit.');
}

// Run tests after server starts
setTimeout(runTests, 1000);

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.kill();
  process.exit(0);
});