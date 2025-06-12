import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolHandler } from './types.js';
import { logger } from '../logger.js';

/**
 * Registry for managing all available tools
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, ToolHandler> = new Map();
  
  private constructor() {
    logger.debug('ToolRegistry initialized');
  }
  
  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }
  
  /**
   * Register a new tool handler
   */
  register(handler: ToolHandler): void {
    if (this.tools.has(handler.name)) {
      logger.warn(`Tool ${handler.name} is already registered, overwriting`);
    }
    
    this.tools.set(handler.name, handler);
    logger.debug(`Tool registered: ${handler.name}`);
  }
  
  /**
   * Register multiple tool handlers at once
   */
  registerAll(handlers: ToolHandler[]): void {
    handlers.forEach(handler => this.register(handler));
  }
  
  /**
   * Get a tool handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }
  
  /**
   * Check if a tool is registered
   */
  hasHandler(name: string): boolean {
    return this.tools.has(name);
  }
  
  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
  
  /**
   * Get tool information for MCP protocol
   */
  getToolsInfo(): Array<{
    name: string;
    description: string;
    inputSchema: any;
  }> {
    return Array.from(this.tools.values()).map(handler => ({
      name: handler.name,
      description: handler.description,
      inputSchema: zodToJsonSchema(handler.schema)
    }));
  }
  
  /**
   * Clear all registered tools (useful for testing)
   */
  clear(): void {
    this.tools.clear();
    logger.debug('All tools unregistered');
  }
}