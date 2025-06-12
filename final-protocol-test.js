#!/usr/bin/env node

/**
 * Final Comprehensive MCP Protocol Test
 * 
 * This script tests the server with alternative connection methods and provides
 * a complete analysis of any protocol issues that could prevent tool discovery.
 * 
 * Based on previous test results, we now know:
 * 1. The server works correctly with manual JSON-RPC calls
 * 2. Tool discovery works when proper protocol sequence is followed
 * 3. The issue may be timing-related or initialization sequence related
 */

import { spawn } from 'child_process';

class FinalProtocolTest {
  constructor() {
    this.results = {
      basicProtocol: null,
      timingVariations: [],
      differentInitSequences: [],
      protocolVersions: [],
      connectionMethods: []
    };
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString().substring(11, 23);
    const prefix = {
      'INFO': '✅',
      'WARN': '⚠️ ',
      'ERROR': '❌',
      'DEBUG': '🔍',
      'SUCCESS': '🎉'
    }[level] || 'ℹ️ ';

    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data && typeof data === 'object') {
      console.log('     ', JSON.stringify(data, null, 2).replace(/\n/g, '\n     '));
    } else if (data) {
      console.log(`     ${data}`);
    }
  }

  async testBasicProtocol() {
    this.log('INFO', 'Testing basic MCP protocol compliance...');
    
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let success = false;
      let toolsFound = 0;
      let errors = [];

      const timeout = setTimeout(() => {
        if (!success) {
          errors.push('Basic protocol test timeout');
        }
        server.kill();
        this.results.basicProtocol = { success, toolsFound, errors };
        resolve();
      }, 6000);

      server.stderr.on('data', (data) => {
        if (data.toString().includes('running on stdio')) {
          // Send complete initialization sequence
          setTimeout(() => this.sendInitSequence(server), 100);
        }
      });

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            
            if (response.result && response.result.tools) {
              success = true;
              toolsFound = response.result.tools.length;
              clearTimeout(timeout);
              this.log('SUCCESS', `Basic protocol test successful - ${toolsFound} tools discovered`);
              setTimeout(() => {
                server.kill();
                this.results.basicProtocol = { success, toolsFound, errors };
                resolve();
              }, 100);
            } else if (response.error) {
              errors.push(response.error.message);
            }
          } catch (e) {
            // Ignore non-JSON lines
          }
        }
      });

      server.on('error', (error) => {
        errors.push(error.message);
        clearTimeout(timeout);
        this.results.basicProtocol = { success: false, toolsFound: 0, errors };
        resolve();
      });
    });
  }

  sendInitSequence(server) {
    try {
      // Step 1: Initialize
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-01',
          capabilities: {},
          clientInfo: { name: 'final-test', version: '1.0.0' }
        }
      }) + '\n');

      // Step 2: Initialized notification (after brief delay)
      setTimeout(() => {
        server.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {}
        }) + '\n');

        // Step 3: List tools (after brief delay)
        setTimeout(() => {
          server.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
          }) + '\n');
        }, 200);
      }, 200);
    } catch (error) {
      this.log('ERROR', 'Failed to send init sequence', error.message);
    }
  }

  async testTimingVariations() {
    this.log('INFO', 'Testing different timing variations...');
    
    const timings = [
      { name: 'Fast (50ms delays)', delay: 50 },
      { name: 'Normal (200ms delays)', delay: 200 },
      { name: 'Slow (500ms delays)', delay: 500 },
      { name: 'Very slow (1000ms delays)', delay: 1000 }
    ];

    for (const timing of timings) {
      this.log('DEBUG', `Testing ${timing.name}...`);
      const result = await this.testWithTiming(timing.delay);
      this.results.timingVariations.push({ ...timing, ...result });
    }
  }

  async testWithTiming(delay) {
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let success = false;
      let toolsFound = 0;

      const timeout = setTimeout(() => {
        server.kill();
        resolve({ success, toolsFound });
      }, 5000);

      server.stderr.on('data', (data) => {
        if (data.toString().includes('running on stdio')) {
          this.sendTimedInitSequence(server, delay);
        }
      });

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.result && response.result.tools) {
              success = true;
              toolsFound = response.result.tools.length;
              clearTimeout(timeout);
              server.kill();
              resolve({ success, toolsFound });
            }
          } catch (e) {
            // Continue
          }
        }
      });

      server.on('error', () => {
        clearTimeout(timeout);
        resolve({ success: false, toolsFound: 0 });
      });
    });
  }

  sendTimedInitSequence(server, delay) {
    try {
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-01',
          capabilities: {},
          clientInfo: { name: 'timing-test', version: '1.0.0' }
        }
      }) + '\n');

      setTimeout(() => {
        server.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {}
        }) + '\n');

        setTimeout(() => {
          server.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
          }) + '\n');
        }, delay);
      }, delay);
    } catch (error) {
      // Ignore write errors for timing tests
    }
  }

  async testDifferentInitSequences() {
    this.log('INFO', 'Testing different initialization sequences...');
    
    const sequences = [
      {
        name: 'Standard sequence',
        steps: ['initialize', 'initialized', 'tools/list']
      },
      {
        name: 'Skip initialized notification',
        steps: ['initialize', 'tools/list']
      },
      {
        name: 'Immediate tools/list',
        steps: ['tools/list']
      },
      {
        name: 'Double initialize',
        steps: ['initialize', 'initialize', 'initialized', 'tools/list']
      }
    ];

    for (const sequence of sequences) {
      this.log('DEBUG', `Testing ${sequence.name}...`);
      const result = await this.testInitSequence(sequence.steps);
      this.results.differentInitSequences.push({ ...sequence, ...result });
    }
  }

  async testInitSequence(steps) {
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let success = false;
      let toolsFound = 0;
      let stepIndex = 0;

      const timeout = setTimeout(() => {
        server.kill();
        resolve({ success, toolsFound });
      }, 4000);

      server.stderr.on('data', (data) => {
        if (data.toString().includes('running on stdio')) {
          this.executeSteps(server, steps);
        }
      });

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.result && response.result.tools) {
              success = true;
              toolsFound = response.result.tools.length;
              clearTimeout(timeout);
              server.kill();
              resolve({ success, toolsFound });
            }
          } catch (e) {
            // Continue
          }
        }
      });

      server.on('error', () => {
        clearTimeout(timeout);
        resolve({ success: false, toolsFound: 0 });
      });
    });
  }

  executeSteps(server, steps) {
    let id = 1;
    
    steps.forEach((step, index) => {
      setTimeout(() => {
        try {
          if (step === 'initialize') {
            server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: id++,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-01',
                capabilities: {},
                clientInfo: { name: 'sequence-test', version: '1.0.0' }
              }
            }) + '\n');
          } else if (step === 'initialized') {
            server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized',
              params: {}
            }) + '\n');
          } else if (step === 'tools/list') {
            server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: id++,
              method: 'tools/list',
              params: {}
            }) + '\n');
          }
        } catch (error) {
          // Ignore write errors
        }
      }, index * 200);
    });
  }

  async testProtocolVersions() {
    this.log('INFO', 'Testing protocol version compatibility...');
    
    const versions = [
      '2024-11-01',
      '2024-10-01', 
      '2025-03-26',
      'invalid-version'
    ];

    for (const version of versions) {
      this.log('DEBUG', `Testing protocol version ${version}...`);
      const result = await this.testProtocolVersion(version);
      this.results.protocolVersions.push({ version, ...result });
    }
  }

  async testProtocolVersion(version) {
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let initSuccess = false;
      let toolsSuccess = false;
      let serverVersion = null;

      const timeout = setTimeout(() => {
        server.kill();
        resolve({ initSuccess, toolsSuccess, serverVersion });
      }, 3000);

      server.stderr.on('data', (data) => {
        if (data.toString().includes('running on stdio')) {
          try {
            server.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: version,
                capabilities: {},
                clientInfo: { name: 'version-test', version: '1.0.0' }
              }
            }) + '\n');
          } catch (error) {
            // Ignore
          }
        }
      });

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            
            if (response.result && response.result.protocolVersion) {
              initSuccess = true;
              serverVersion = response.result.protocolVersion;
              
              // Send tools request
              setTimeout(() => {
                server.stdin.write(JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'notifications/initialized',
                  params: {}
                }) + '\n');
                
                setTimeout(() => {
                  server.stdin.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {}
                  }) + '\n');
                }, 100);
              }, 100);
              
            } else if (response.result && response.result.tools) {
              toolsSuccess = true;
              clearTimeout(timeout);
              server.kill();
              resolve({ initSuccess, toolsSuccess, serverVersion });
            }
          } catch (e) {
            // Continue
          }
        }
      });

      server.on('error', () => {
        clearTimeout(timeout);
        resolve({ initSuccess: false, toolsSuccess: false, serverVersion: null });
      });
    });
  }

  async runAllTests() {
    this.log('INFO', '=== Starting Final Comprehensive MCP Protocol Test ===\n');
    
    await this.testBasicProtocol();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.testTimingVariations();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.testDifferentInitSequences();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.testProtocolVersions();
    
    this.generateFinalReport();
  }

  generateFinalReport() {
    console.log('\n' + '='.repeat(80));
    console.log('                    FINAL MCP PROTOCOL TEST REPORT');
    console.log('='.repeat(80));

    // Basic Protocol Test
    console.log('\n🔹 BASIC PROTOCOL COMPLIANCE:');
    if (this.results.basicProtocol) {
      const status = this.results.basicProtocol.success ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} - ${this.results.basicProtocol.toolsFound} tools discovered`);
      if (this.results.basicProtocol.errors.length > 0) {
        console.log(`   Errors: ${this.results.basicProtocol.errors.join(', ')}`);
      }
    }

    // Timing Variations
    console.log('\n🔹 TIMING SENSITIVITY:');
    this.results.timingVariations.forEach(test => {
      const status = test.success ? '✅' : '❌';
      console.log(`   ${status} ${test.name}: ${test.toolsFound} tools`);
    });

    // Init Sequences
    console.log('\n🔹 INITIALIZATION SEQUENCES:');
    this.results.differentInitSequences.forEach(test => {
      const status = test.success ? '✅' : '❌';
      console.log(`   ${status} ${test.name}: ${test.toolsFound} tools`);
    });

    // Protocol Versions
    console.log('\n🔹 PROTOCOL VERSION COMPATIBILITY:');
    this.results.protocolVersions.forEach(test => {
      const initStatus = test.initSuccess ? '✅' : '❌';
      const toolsStatus = test.toolsSuccess ? '✅' : '❌';
      console.log(`   ${test.version}: Init ${initStatus} Tools ${toolsStatus} (Server: ${test.serverVersion || 'unknown'})`);
    });

    // Summary and Recommendations
    console.log('\n🔹 SUMMARY AND RECOMMENDATIONS:');
    console.log('-'.repeat(50));

    const basicWorks = this.results.basicProtocol?.success;
    const allTimingsWork = this.results.timingVariations.every(t => t.success);
    const standardSequenceWorks = this.results.differentInitSequences.find(s => s.name === 'Standard sequence')?.success;
    const protocolVersionsWork = this.results.protocolVersions.filter(p => p.version !== 'invalid-version').every(p => p.toolsSuccess);

    if (basicWorks && allTimingsWork && standardSequenceWorks && protocolVersionsWork) {
      console.log('🎉 PERFECT PROTOCOL IMPLEMENTATION');
      console.log('   The MCP server implements the protocol correctly with no issues');
      console.log('   It should work reliably with Claude Desktop and other MCP clients');
    } else if (basicWorks && standardSequenceWorks) {
      console.log('✅ GOOD PROTOCOL IMPLEMENTATION');
      console.log('   The MCP server works correctly with standard protocols');
      if (!allTimingsWork) {
        console.log('   ⚠️  Some timing sensitivity detected - ensure proper initialization delays');
      }
      if (!protocolVersionsWork) {
        console.log('   ⚠️  Some protocol version compatibility issues');
      }
    } else if (basicWorks) {
      console.log('⚠️  PARTIAL PROTOCOL IMPLEMENTATION');
      console.log('   Basic functionality works but some edge cases have issues');
      console.log('   Should work with most clients but may have reliability issues');
    } else {
      console.log('❌ PROTOCOL IMPLEMENTATION ISSUES');
      console.log('   Significant problems detected with the MCP protocol implementation');
      console.log('   Tool discovery is not working reliably');
    }

    console.log('\n🔹 SPECIFIC ISSUES FOUND:');
    console.log('-'.repeat(50));

    const issues = [];
    
    if (!basicWorks) {
      issues.push('Basic protocol sequence fails');
    }
    
    if (!allTimingsWork) {
      const failedTimings = this.results.timingVariations.filter(t => !t.success);
      issues.push(`Timing issues with: ${failedTimings.map(t => t.name).join(', ')}`);
    }
    
    const failedSequences = this.results.differentInitSequences.filter(s => !s.success);
    if (failedSequences.length > 0) {
      issues.push(`Init sequence issues: ${failedSequences.map(s => s.name).join(', ')}`);
    }
    
    const failedVersions = this.results.protocolVersions.filter(p => p.version !== 'invalid-version' && !p.toolsSuccess);
    if (failedVersions.length > 0) {
      issues.push(`Protocol version issues: ${failedVersions.map(p => p.version).join(', ')}`);
    }

    if (issues.length === 0) {
      console.log('   ✅ No specific issues detected');
    } else {
      issues.forEach(issue => console.log(`   ❌ ${issue}`));
    }

    console.log('\n🔹 CLAUDE DESKTOP COMPATIBILITY:');
    console.log('-'.repeat(50));
    
    if (basicWorks && standardSequenceWorks) {
      console.log('   ✅ HIGH - Should work reliably with Claude Desktop');
      console.log('   ✅ Standard initialization sequence supported');
      console.log('   ✅ Tool discovery functions correctly');
    } else if (basicWorks) {
      console.log('   ⚠️  MEDIUM - May work but could have reliability issues');
      console.log('   ⚠️  Some initialization sequences fail');
    } else {
      console.log('   ❌ LOW - Likely to have issues with Claude Desktop');
      console.log('   ❌ Basic protocol compliance problems');
    }

    console.log('\n' + '='.repeat(80));
  }
}

// Run the final test
const finalTest = new FinalProtocolTest();

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, cleaning up...');
  process.exit(0);
});

finalTest.runAllTests().catch(error => {
  console.error('Final test failed:', error);
  process.exit(1);
});