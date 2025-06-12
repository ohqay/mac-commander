#!/usr/bin/env node

/**
 * Quick MCP Protocol Diagnostic
 * 
 * Fast diagnostic to identify specific protocol or connection issues
 */

import { spawn } from 'child_process';

class QuickDiagnostic {
  constructor() {
    this.results = {
      serverStart: false,
      protocolHandshake: false,
      toolDiscovery: false,
      toolExecution: false,
      protocolVersion: null,
      toolCount: 0,
      errors: []
    };
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async runDiagnostic() {
    this.log('🚀 Starting Quick MCP Protocol Diagnostic...');
    
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let requestId = 1;
      const timeout = setTimeout(() => {
        this.log('⏱️  Diagnostic timeout - generating report...');
        server.kill();
        this.generateQuickReport();
        resolve();
      }, 10000);

      // Track server startup
      server.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('running on stdio') || output.includes('operational')) {
          this.results.serverStart = true;
          this.log('✅ Server started successfully');
          
          // Start protocol handshake
          this.sendInitialize(server, requestId++);
        }
      });

      // Handle responses
      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            this.handleResponse(response, server, requestId);
          } catch (e) {
            // Ignore non-JSON lines
          }
        }
      });

      server.on('error', (error) => {
        this.results.errors.push(`Server process error: ${error.message}`);
        clearTimeout(timeout);
        this.generateQuickReport();
        resolve();
      });

      server.on('exit', (code) => {
        if (code !== 0) {
          this.results.errors.push(`Server exited with code: ${code}`);
        }
        clearTimeout(timeout);
        this.generateQuickReport();
        resolve();
      });
    });
  }

  sendInitialize(server, id) {
    const request = {
      jsonrpc: '2.0',
      id: id,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-01',
        capabilities: {},
        clientInfo: { name: 'diagnostic', version: '1.0.0' }
      }
    };
    
    try {
      server.stdin.write(JSON.stringify(request) + '\n');
      this.log('📤 Sent initialize request');
    } catch (error) {
      this.results.errors.push(`Failed to send initialize: ${error.message}`);
    }
  }

  sendListTools(server, id) {
    const request = {
      jsonrpc: '2.0',
      id: id,
      method: 'tools/list',
      params: {}
    };
    
    try {
      server.stdin.write(JSON.stringify(request) + '\n');
      this.log('📤 Sent tools/list request');
    } catch (error) {
      this.results.errors.push(`Failed to send tools/list: ${error.message}`);
    }
  }

  sendTestTool(server, id) {
    const request = {
      jsonrpc: '2.0',
      id: id,
      method: 'tools/call',
      params: {
        name: 'get_screen_info',
        arguments: {}
      }
    };
    
    try {
      server.stdin.write(JSON.stringify(request) + '\n');
      this.log('📤 Sent tool execution test');
    } catch (error) {
      this.results.errors.push(`Failed to send tool test: ${error.message}`);
    }
  }

  handleResponse(response, server, requestId) {
    if (response.result && response.result.protocolVersion) {
      // Initialize response
      this.results.protocolHandshake = true;
      this.results.protocolVersion = response.result.protocolVersion;
      this.log(`✅ Protocol handshake successful - version: ${response.result.protocolVersion}`);
      
      // Send initialized notification
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      }) + '\n');
      
      // Request tools list
      this.sendListTools(server, requestId);
      
    } else if (response.result && response.result.tools) {
      // Tools list response
      this.results.toolDiscovery = true;
      this.results.toolCount = response.result.tools.length;
      this.log(`✅ Tool discovery successful - found ${response.result.tools.length} tools`);
      
      // Test a simple tool
      this.sendTestTool(server, requestId);
      
    } else if (response.result && response.result.content) {
      // Tool execution response
      this.results.toolExecution = true;
      this.log('✅ Tool execution successful');
      
      // We've completed all tests - kill server and generate report
      setTimeout(() => {
        server.kill();
      }, 100);
      
    } else if (response.error) {
      this.results.errors.push(`Server error: ${response.error.message} (${response.error.code})`);
      this.log(`❌ Server error: ${response.error.message}`);
    }
  }

  generateQuickReport() {
    console.log('\n' + '='.repeat(60));
    console.log('           QUICK MCP PROTOCOL DIAGNOSTIC REPORT');
    console.log('='.repeat(60));
    
    const tests = [
      { name: 'Server Startup', passed: this.results.serverStart },
      { name: 'Protocol Handshake', passed: this.results.protocolHandshake },
      { name: 'Tool Discovery', passed: this.results.toolDiscovery },
      { name: 'Tool Execution', passed: this.results.toolExecution }
    ];

    tests.forEach(test => {
      const status = test.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${test.name}`);
    });

    console.log('\nDETAILS:');
    console.log('-'.repeat(30));
    console.log(`Protocol Version: ${this.results.protocolVersion || 'Unknown'}`);
    console.log(`Tools Discovered: ${this.results.toolCount}`);
    console.log(`Errors: ${this.results.errors.length}`);

    if (this.results.errors.length > 0) {
      console.log('\nERRORS:');
      console.log('-'.repeat(30));
      this.results.errors.forEach(error => console.log(`❌ ${error}`));
    }

    console.log('\nDIAGNOSIS:');
    console.log('-'.repeat(30));
    
    if (this.results.serverStart && this.results.protocolHandshake && 
        this.results.toolDiscovery && this.results.toolExecution) {
      console.log('🎉 ALL SYSTEMS OPERATIONAL');
      console.log('   The MCP server is working correctly with no protocol issues');
      console.log('   Tool discovery and execution are functioning properly');
    } else if (!this.results.serverStart) {
      console.log('🚨 SERVER STARTUP FAILURE');
      console.log('   The server failed to start - check build process and dependencies');
    } else if (!this.results.protocolHandshake) {
      console.log('🚨 PROTOCOL HANDSHAKE FAILURE');
      console.log('   The server starts but fails to complete MCP initialization');
      console.log('   Check JSON-RPC message format and protocol implementation');
    } else if (!this.results.toolDiscovery) {
      console.log('🚨 TOOL DISCOVERY FAILURE');
      console.log('   Protocol works but tools/list request fails');
      console.log('   Check tool registration and schema generation');
    } else if (!this.results.toolExecution) {
      console.log('🚨 TOOL EXECUTION FAILURE');
      console.log('   Tools are discovered but execution fails');
      console.log('   Check tool implementation and permission handling');
    }

    console.log('\n' + '='.repeat(60));
  }
}

const diagnostic = new QuickDiagnostic();
diagnostic.runDiagnostic().catch(error => {
  console.error('Diagnostic failed:', error);
  process.exit(1);
});