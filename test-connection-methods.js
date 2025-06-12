#!/usr/bin/env node

/**
 * Alternative Connection Methods Test
 * 
 * This script tests the MCP server using different connection approaches
 * to identify any transport or protocol issues that might prevent
 * tool discovery in different environments.
 */

import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ConnectionTester {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
      'INFO': '✅',
      'WARN': '⚠️ ',
      'ERROR': '❌',
      'DEBUG': '🔍'
    }[level] || 'ℹ️ ';

    console.log(`${prefix} ${message}`);
    if (data) {
      console.log('   ', JSON.stringify(data, null, 2));
    }
  }

  addTestResult(testName, passed, message, details = null) {
    const result = {
      testName,
      passed,
      message,
      details,
      timestamp: Date.now() - this.startTime
    };
    this.testResults.push(result);
    
    const status = passed ? '✅ PASS' : '❌ FAIL';
    this.log(passed ? 'INFO' : 'ERROR', `${status}: ${testName} - ${message}`, details);
  }

  async testStdioConnection() {
    this.log('INFO', 'Testing STDIO connection (standard MCP transport)...');
    
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let responses = [];
      let hasResponse = false;
      const timeout = setTimeout(() => {
        if (!hasResponse) {
          this.addTestResult(
            'STDIO Connection',
            false,
            'Timeout waiting for response via STDIO',
            { timeout: '5000ms' }
          );
          server.kill();
          resolve(false);
        }
      }, 5000);

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            responses.push(response);
            if (response.result && response.result.protocolVersion) {
              hasResponse = true;
              clearTimeout(timeout);
              this.addTestResult(
                'STDIO Connection',
                true,
                'Successfully connected via STDIO',
                { 
                  protocolVersion: response.result.protocolVersion,
                  serverInfo: response.result.serverInfo
                }
              );
              server.kill();
              resolve(true);
            }
          } catch (e) {
            // Ignore non-JSON output
          }
        }
      });

      server.stderr.on('data', (data) => {
        this.log('DEBUG', `STDIO stderr: ${data.toString().trim()}`);
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        this.addTestResult(
          'STDIO Connection',
          false,
          'STDIO connection failed',
          error.message
        );
        resolve(false);
      });

      // Send initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-01',
          capabilities: {},
          clientInfo: {
            name: 'connection-tester',
            version: '1.0.0'
          }
        }
      };

      try {
        server.stdin.write(JSON.stringify(initRequest) + '\n');
      } catch (error) {
        clearTimeout(timeout);
        this.addTestResult(
          'STDIO Connection',
          false,
          'Failed to write to STDIO',
          error.message
        );
        server.kill();
        resolve(false);
      }
    });
  }

  async testNodeModuleExecution() {
    this.log('INFO', 'Testing direct Node.js module execution...');
    
    try {
      // Test if the built module can be imported and executed
      const modulePath = join(__dirname, 'build', 'index.js');
      
      // Check if build exists
      try {
        await fs.access(modulePath);
        this.addTestResult(
          'Module Accessibility',
          true,
          'Built module file is accessible',
          { path: modulePath }
        );
      } catch (error) {
        this.addTestResult(
          'Module Accessibility',
          false,
          'Built module file not found',
          { path: modulePath, error: error.message }
        );
        return false;
      }

      // Test module execution with different node flags
      const testConfigs = [
        { name: 'Standard Execution', args: ['build/index.js'] },
        { name: 'ES Module Mode', args: ['--input-type=module', 'build/index.js'] },
        { name: 'Strict Mode', args: ['--use-strict', 'build/index.js'] }
      ];

      for (const config of testConfigs) {
        const result = await this.testNodeExecution(config.name, config.args);
        if (!result) {
          this.log('WARN', `${config.name} failed, trying next configuration...`);
        }
      }

      return true;
    } catch (error) {
      this.addTestResult(
        'Node Module Execution',
        false,
        'Failed to test module execution',
        error.message
      );
      return false;
    }
  }

  async testNodeExecution(testName, args) {
    return new Promise((resolve) => {
      const server = spawn('node', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      });

      let success = false;
      const timeout = setTimeout(() => {
        if (!success) {
          this.addTestResult(
            testName,
            false,
            'Node execution timeout',
            { args, timeout: '3000ms' }
          );
          server.kill();
          resolve(false);
        }
      }, 3000);

      server.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('running on stdio') || output.includes('operational')) {
          success = true;
          clearTimeout(timeout);
          this.addTestResult(
            testName,
            true,
            'Node execution successful',
            { args }
          );
          server.kill();
          resolve(true);
        } else if (output.includes('Error') || output.includes('error')) {
          clearTimeout(timeout);
          this.addTestResult(
            testName,
            false,
            'Node execution error',
            { args, error: output.trim() }
          );
          server.kill();
          resolve(false);
        }
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        this.addTestResult(
          testName,
          false,
          'Node process error',
          { args, error: error.message }
        );
        resolve(false);
      });

      server.on('exit', (code) => {
        if (!success) {
          clearTimeout(timeout);
          this.addTestResult(
            testName,
            code === 0,
            code === 0 ? 'Process exited cleanly' : 'Process exited with error',
            { args, exitCode: code }
          );
          resolve(code === 0);
        }
      });
    });
  }

  async testEnvironmentVariables() {
    this.log('INFO', 'Testing with different environment variables...');
    
    const envConfigs = [
      { 
        name: 'Default Environment',
        env: {}
      },
      {
        name: 'Debug Logging',
        env: { MCP_LOG_LEVEL: 'DEBUG' }
      },
      {
        name: 'Production Mode',
        env: { NODE_ENV: 'production' }
      },
      {
        name: 'Specific Protocol Version',
        env: { MCP_PROTOCOL_VERSION: '2024-11-01' }
      }
    ];

    for (const config of envConfigs) {
      await this.testWithEnvironment(config.name, config.env);
    }
  }

  async testWithEnvironment(testName, envVars) {
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...envVars }
      });

      let success = false;
      const timeout = setTimeout(() => {
        if (!success) {
          this.addTestResult(
            testName,
            false,
            'Environment test timeout',
            { env: envVars }
          );
          server.kill();
          resolve();
        }
      }, 3000);

      server.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('running on stdio') || output.includes('operational')) {
          success = true;
          clearTimeout(timeout);
          this.addTestResult(
            testName,
            true,
            'Environment test successful',
            { env: envVars }
          );
          server.kill();
          resolve();
        }
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        this.addTestResult(
          testName,
          false,
          'Environment test error',
          { env: envVars, error: error.message }
        );
        resolve();
      });
    });
  }

  async testDifferentInputMethods() {
    this.log('INFO', 'Testing different JSON-RPC input methods...');
    
    const inputTests = [
      {
        name: 'Standard JSON-RPC',
        input: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-01', capabilities: {} }
        }) + '\n'
      },
      {
        name: 'Pretty Printed JSON',
        input: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-01', capabilities: {} }
        }, null, 2) + '\n'
      },
      {
        name: 'Compact JSON',
        input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-01","capabilities":{}}}\n'
      },
      {
        name: 'Multiple Requests',
        input: [
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-01","capabilities":{}}}',
          '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
        ].join('\n') + '\n'
      }
    ];

    for (const test of inputTests) {
      await this.testInputMethod(test.name, test.input);
    }
  }

  async testInputMethod(testName, input) {
    return new Promise((resolve) => {
      const server = spawn('node', ['build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let hasValidResponse = false;
      const timeout = setTimeout(() => {
        if (!hasValidResponse) {
          this.addTestResult(
            testName,
            false,
            'No valid response to input method',
            { inputLength: input.length }
          );
          server.kill();
          resolve();
        }
      }, 3000);

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.result || response.error) {
              hasValidResponse = true;
              clearTimeout(timeout);
              this.addTestResult(
                testName,
                true,
                'Input method accepted',
                { 
                  hasResult: !!response.result,
                  hasError: !!response.error
                }
              );
              server.kill();
              resolve();
              return;
            }
          } catch (e) {
            // Continue checking other lines
          }
        }
      });

      server.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('running on stdio')) {
          // Server started, now send input
          try {
            server.stdin.write(input);
          } catch (error) {
            clearTimeout(timeout);
            this.addTestResult(
              testName,
              false,
              'Failed to write input',
              error.message
            );
            server.kill();
            resolve();
          }
        }
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        this.addTestResult(
          testName,
          false,
          'Input method test error',
          error.message
        );
        resolve();
      });
    });
  }

  async testClaudeDesktopCompatibility() {
    this.log('INFO', 'Testing Claude Desktop configuration compatibility...');
    
    // Test the configuration format that would be used in Claude Desktop
    const configTest = {
      "mcpServers": {
        "macos-simulator-mcp": {
          "command": "node",
          "args": ["build/index.js"]
        }
      }
    };

    // Simulate how Claude Desktop would start the server
    return new Promise((resolve) => {
      const server = spawn(configTest.mcpServers["macos-simulator-mcp"].command, 
                           configTest.mcpServers["macos-simulator-mcp"].args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      });

      let serverReady = false;
      let toolsDiscovered = false;

      const timeout = setTimeout(() => {
        this.addTestResult(
          'Claude Desktop Compatibility',
          serverReady && toolsDiscovered,
          serverReady ? 
            (toolsDiscovered ? 'Fully compatible with Claude Desktop' : 'Server starts but tools not discoverable') :
            'Server failed to start in Claude Desktop mode',
          { 
            serverReady,
            toolsDiscovered,
            config: configTest
          }
        );
        server.kill();
        resolve();
      }, 5000);

      server.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('running on stdio') || output.includes('operational')) {
          serverReady = true;
          
          // Send the initialization sequence that Claude Desktop would send
          const initSequence = [
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-01',
                capabilities: {},
                clientInfo: {
                  name: 'claude-desktop',
                  version: '1.0.0'
                }
              }
            }
          ];

          for (const request of initSequence) {
            try {
              server.stdin.write(JSON.stringify(request) + '\n');
            } catch (error) {
              clearTimeout(timeout);
              this.addTestResult(
                'Claude Desktop Compatibility',
                false,
                'Failed to send initialization sequence',
                error.message
              );
              server.kill();
              resolve();
              return;
            }
          }
        }
      });

      server.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.result && response.result.protocolVersion) {
              // Send tools/list request
              const toolsRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
              };
              server.stdin.write(JSON.stringify(toolsRequest) + '\n');
            } else if (response.result && response.result.tools) {
              toolsDiscovered = response.result.tools.length > 0;
              clearTimeout(timeout);
              this.addTestResult(
                'Claude Desktop Compatibility',
                true,
                `Compatible with Claude Desktop - discovered ${response.result.tools.length} tools`,
                {
                  toolCount: response.result.tools.length,
                  protocolVersion: response.result.protocolVersion || 'unknown'
                }
              );
              server.kill();
              resolve();
            }
          } catch (e) {
            // Continue processing other lines
          }
        }
      });

      server.on('error', (error) => {
        clearTimeout(timeout);
        this.addTestResult(
          'Claude Desktop Compatibility',
          false,
          'Claude Desktop compatibility test failed',
          error.message
        );
        resolve();
      });
    });
  }

  async runAllTests() {
    try {
      this.log('INFO', '=== Starting Alternative Connection Methods Test ===');
      
      // Test different connection methods
      await this.testStdioConnection();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testNodeModuleExecution();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testEnvironmentVariables();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testDifferentInputMethods();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await this.testClaudeDesktopCompatibility();

      this.log('INFO', '=== Alternative Connection Methods Test Complete ===');
      this.generateReport();

    } catch (error) {
      this.log('ERROR', 'Test suite failed', error);
      this.generateReport();
    }
  }

  generateReport() {
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(t => t.passed).length;
    const failedTests = totalTests - passedTests;
    const duration = Date.now() - this.startTime;

    console.log('\n' + '='.repeat(80));
    console.log('              ALTERNATIVE CONNECTION METHODS TEST REPORT');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ${failedTests > 0 ? '❌' : '✅'}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log('='.repeat(80));

    // Group results by test category
    const categories = {
      'Connection': this.testResults.filter(t => t.testName.includes('Connection')),
      'Execution': this.testResults.filter(t => t.testName.includes('Execution') || t.testName.includes('Module')),
      'Environment': this.testResults.filter(t => t.testName.includes('Environment')),
      'Input Methods': this.testResults.filter(t => t.testName.includes('JSON') || t.testName.includes('input')),
      'Compatibility': this.testResults.filter(t => t.testName.includes('Compatibility'))
    };

    console.log('\nRESULTS BY CATEGORY:');
    console.log('-'.repeat(40));
    for (const [category, tests] of Object.entries(categories)) {
      if (tests.length > 0) {
        const passed = tests.filter(t => t.passed).length;
        const status = passed === tests.length ? '✅' : (passed > 0 ? '⚠️ ' : '❌');
        console.log(`${status} ${category}: ${passed}/${tests.length} passed`);
      }
    }

    if (failedTests > 0) {
      console.log('\nFAILED TESTS:');
      console.log('-'.repeat(40));
      this.testResults
        .filter(t => !t.passed)
        .forEach(test => {
          console.log(`❌ ${test.testName}: ${test.message}`);
          if (test.details) {
            console.log(`   Details: ${JSON.stringify(test.details, null, 2)}`);
          }
        });
    }

    console.log('\nDIAGNOSTIC SUMMARY:');
    console.log('-'.repeat(40));
    
    const stdioTest = this.testResults.find(t => t.testName === 'STDIO Connection');
    const compatTest = this.testResults.find(t => t.testName === 'Claude Desktop Compatibility');
    
    console.log(`STDIO Transport: ${stdioTest?.passed ? '✅ Working' : '❌ Failed'}`);
    console.log(`Claude Desktop Compatible: ${compatTest?.passed ? '✅ Yes' : '❌ No'}`);
    
    const nodeTests = this.testResults.filter(t => t.testName.includes('Execution'));
    const nodeWorking = nodeTests.some(t => t.passed);
    console.log(`Node.js Execution: ${nodeWorking ? '✅ Working' : '❌ Failed'}`);

    console.log('\n' + '='.repeat(80));

    // Provide specific recommendations based on results
    console.log('\nRECOMMENDATIONS:');
    console.log('-'.repeat(40));
    
    if (stdioTest?.passed && compatTest?.passed) {
      console.log('✅ Server is working correctly with standard MCP protocols');
      console.log('✅ Should work properly with Claude Desktop');
    } else if (stdioTest?.passed && !compatTest?.passed) {
      console.log('⚠️  Server works with STDIO but may have Claude Desktop compatibility issues');
      console.log('   Check that the initialization sequence matches Claude Desktop expectations');
    } else if (!stdioTest?.passed) {
      console.log('❌ STDIO transport is not working properly');
      console.log('   This is the primary transport method for MCP servers');
      console.log('   Check for JSON formatting, process communication, or permission issues');
    }

    if (!nodeWorking) {
      console.log('❌ Node.js execution issues detected');
      console.log('   Check Node.js version, module imports, and build process');
    }

    console.log('\n' + '='.repeat(80));
  }
}

// Run the tests
const tester = new ConnectionTester();

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, cleaning up...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Start the test suite
tester.runAllTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});