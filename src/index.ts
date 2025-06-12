#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolRegistry } from './core/tool-registry.js';
import { ExecutionContextImpl } from './core/execution-context.js';
import { logger } from './logger.js';
import { initTempFolder } from './screenshot-utils.js';
import { terminateOCR } from './ocr-utils.js';
import { getUserFriendlyErrorMessage, MCPError } from './errors.js';

// Import tool handlers
import { screenshotToolHandlers } from './tools/screenshot-tools.js';
import { automationToolHandlers } from './tools/automation-tools.js';
import { windowToolHandlers } from './tools/window-tools.js';
import { ocrToolHandlers } from './tools/ocr-tools.js';
import { utilityToolHandlers } from './tools/utility-tools.js';

// Create server instance
const server = new Server(
  {
    name: "macos-simulator-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize tool registry
const toolRegistry = ToolRegistry.getInstance();

// Register all tool handlers
async function registerAllTools() {
  // Register screenshot tools
  toolRegistry.registerAll(screenshotToolHandlers);
  
  // Register automation tools
  toolRegistry.registerAll(automationToolHandlers);
  
  // Register window tools
  toolRegistry.registerAll(windowToolHandlers);
  
  // Register OCR tools
  toolRegistry.registerAll(ocrToolHandlers);
  
  // Register utility tools
  toolRegistry.registerAll(utilityToolHandlers);
  
  logger.info(`Registered ${toolRegistry.getToolNames().length} tools`);
}

// Setup signal handlers
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await cleanup();
  process.exit(0);
});

// Cleanup function
async function cleanup() {
  try {
    logger.info("Starting cleanup...");
    await terminateOCR();
    logger.info("Cleanup completed");
  } catch (error) {
    logger.error("Error during cleanup", error as Error);
  }
}

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: toolRegistry.getToolsInfo(),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  const toolName = request.params.name;
  
  logger.info(`Executing tool: ${toolName}`);
  
  // Create execution context for this request
  const context = new ExecutionContextImpl();
  
  try {
    // Get the tool handler
    const handler = toolRegistry.getHandler(toolName);
    if (!handler) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    
    // Validate permissions if needed
    if (handler.validatePermissions) {
      await handler.validatePermissions();
    }
    
    // Parse and validate arguments
    const args = handler.schema.parse(request.params.arguments);
    
    // Execute the tool
    const result = await handler.execute(args, context);
    
    const duration = Date.now() - startTime;
    logger.info(`Tool ${toolName} completed in ${duration}ms`);
    
    // Return the result directly - it already has the correct format
    return result as any;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Tool ${toolName} failed after ${duration}ms`, error as Error);
    
    // Clean up context on error
    context.cleanup();
    
    if (error instanceof MCPError) {
      return {
        content: [
          {
            type: "text",
            text: getUserFriendlyErrorMessage(error),
          },
        ],
        isError: true,
      };
    }
    
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  } finally {
    // Always clean up context
    context.cleanup();
  }
});

// Main function
async function main() {
  try {
    logger.info("Starting macOS Simulator MCP server...");
    
    // Initialize temp folder for screenshots
    await initTempFolder();
    
    // Register all tools
    await registerAllTools();
    
    // Create stdio transport
    const transport = new StdioServerTransport();
    
    // Connect server to transport
    await server.connect(transport);
    
    logger.info("macOS Simulator MCP server running");
  } catch (error) {
    logger.error("Failed to start server", error as Error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  logger.error("Fatal error", error as Error);
  process.exit(1);
});