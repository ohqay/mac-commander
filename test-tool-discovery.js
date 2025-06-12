#!/usr/bin/env node

/**
 * Focused Tool Discovery Test
 * 
 * Specifically tests the tools/list request and response to identify
 * why tool discovery might be failing in some scenarios
 */

import { spawn } from 'child_process';

async function testToolDiscovery() {
  console.log('🔍 Testing Tool Discovery Process...\n');
  
  return new Promise((resolve) => {
    const server = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let step = 'starting';
    let requestsSent = 0;
    let responsesReceived = 0;

    const timeout = setTimeout(() => {
      console.log(`⏱️  Timeout at step: ${step}`);
      console.log(`   Requests sent: ${requestsSent}`);
      console.log(`   Responses received: ${responsesReceived}`);
      server.kill();
      resolve();
    }, 8000);

    server.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[STDERR] ${output}`);
        
        if (output.includes('running on stdio')) {
          step = 'initialized';
          console.log('\n✅ Server ready - sending initialize request...');
          
          const initRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-01',
              capabilities: {},
              clientInfo: { name: 'test-client', version: '1.0.0' }
            }
          };
          
          server.stdin.write(JSON.stringify(initRequest) + '\n');
          requestsSent++;
          step = 'waiting_for_init_response';
        }
      }
    });

    server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        console.log(`[STDOUT] ${line}`);
        
        try {
          const response = JSON.parse(line);
          responsesReceived++;
          
          console.log(`\n📥 Received response ${responsesReceived}:`);
          console.log(JSON.stringify(response, null, 2));
          
          if (response.id === 1 && response.result && response.result.protocolVersion) {
            step = 'sending_initialized';
            console.log('\n✅ Initialize successful - sending initialized notification...');
            
            // Send initialized notification
            const initializedNotification = {
              jsonrpc: '2.0',
              method: 'notifications/initialized',
              params: {}
            };
            
            server.stdin.write(JSON.stringify(initializedNotification) + '\n');
            
            // Wait a moment, then send tools/list
            setTimeout(() => {
              step = 'requesting_tools';
              console.log('\n✅ Initialized notification sent - requesting tools list...');
              
              const toolsRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
              };
              
              server.stdin.write(JSON.stringify(toolsRequest) + '\n');
              requestsSent++;
              step = 'waiting_for_tools_response';
            }, 200);
            
          } else if (response.id === 2) {
            step = 'tools_response_received';
            
            if (response.result && response.result.tools) {
              console.log(`\n🎉 Tool discovery successful!`);
              console.log(`   Found ${response.result.tools.length} tools:`);
              response.result.tools.forEach((tool, i) => {
                console.log(`   ${i + 1}. ${tool.name} - ${tool.description}`);
              });
            } else if (response.error) {
              console.log(`\n❌ Tool discovery error:`);
              console.log(`   Code: ${response.error.code}`);
              console.log(`   Message: ${response.error.message}`);
            } else {
              console.log(`\n⚠️  Unexpected tools/list response format`);
            }
            
            clearTimeout(timeout);
            setTimeout(() => {
              server.kill();
              resolve();
            }, 500);
            
          } else if (response.error) {
            console.log(`\n❌ Error response:`);
            console.log(`   Code: ${response.error.code}`);
            console.log(`   Message: ${response.error.message}`);
          }
          
        } catch (e) {
          console.log(`[STDOUT-PARSE-ERROR] Could not parse: ${line}`);
        }
      }
    });

    server.on('error', (error) => {
      console.log(`\n❌ Server process error: ${error.message}`);
      clearTimeout(timeout);
      resolve();
    });

    server.on('exit', (code, signal) => {
      console.log(`\n📊 Server exited - Code: ${code}, Signal: ${signal}`);
      console.log(`   Final step: ${step}`);
      console.log(`   Requests sent: ${requestsSent}`);
      console.log(`   Responses received: ${responsesReceived}`);
      clearTimeout(timeout);
      resolve();
    });
  });
}

// Run the test
testToolDiscovery().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});