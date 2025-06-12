# Error Handling and Reliability Guide

This document describes the error handling and reliability features implemented in the macOS Simulator MCP server.

## Overview

The macOS Simulator MCP server includes comprehensive error handling to ensure reliability and provide helpful feedback when issues occur. Key features include:

- Custom error classes for different failure scenarios
- Permission checking and validation
- Retry logic with exponential backoff
- Circuit breakers for critical operations
- Structured logging with performance metrics
- Input validation with detailed error messages
- Health checks and diagnostics

## Error Types

### Custom Error Classes

The server uses specific error classes to categorize different types of failures:

- **PermissionError**: Missing system permissions (Screen Recording, Accessibility)
- **ScreenCaptureError**: Screenshot operations failed
- **WindowNotFoundError**: Target window doesn't exist
- **OCRError**: Text recognition failed
- **ValidationError**: Invalid input parameters
- **TimeoutError**: Operation exceeded time limit
- **CoordinateOutOfBoundsError**: Coordinates outside screen bounds
- **FileSystemError**: File operations failed
- **AutomationError**: UI automation failed

### User-Friendly Error Messages

All errors are translated into user-friendly messages that include:
- Clear description of what went wrong
- Actionable steps to resolve the issue
- Relevant context and details

## Permission Management

### Required Permissions

The server requires these macOS permissions:
- **Screen Recording**: For screenshots and screen capture
- **Accessibility**: For mouse/keyboard control and window management

### Permission Checking

Before executing tools, the server checks required permissions:

```typescript
// Example: Screenshot tool checks Screen Recording permission
await ensurePermissions({ screenRecording: true });

// Example: Click tool checks Accessibility permission
await ensurePermissions({ accessibility: true });
```

### Granting Permissions

If permissions are missing, users receive detailed instructions:

1. Open System Preferences > Security & Privacy > Privacy
2. For Screen Recording:
   - Select "Screen Recording" from the left sidebar
   - Check the box next to your terminal application
3. For Accessibility:
   - Select "Accessibility" from the left sidebar
   - Check the box next to your terminal application
4. Restart the application after granting permissions

## Retry Logic and Circuit Breakers

### Retry Mechanism

Transient failures are automatically retried with exponential backoff:

```typescript
await withRetry(
  async () => { /* operation */ },
  'operation_name',
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    timeoutMs: 60000
  }
);
```

### Circuit Breakers

Critical operations use circuit breakers to prevent cascading failures:

- **Screen Capture**: Opens after 3 failures, resets after 30 seconds
- **OCR Operations**: Opens after 5 failures, resets after 60 seconds

When a circuit breaker is open, operations fail fast without attempting execution.

## Input Validation

### Enhanced Validation

All tool inputs are validated with detailed error messages:

- Coordinate validation ensures points are within screen bounds
- File paths are checked for existence and permissions
- Text input length is limited to prevent performance issues
- Key combinations are validated for correctness

### Validation Examples

```typescript
// Coordinates must be within screen bounds
{ x: -10, y: 50 } // Error: X coordinate must be non-negative

// File paths must have existing parent directories
{ outputPath: "/nonexistent/dir/file.png" } // Error: Parent directory does not exist

// Key combinations must be valid
{ key: "cmd+invalid+key" } // Error: Invalid key combination
```

## Logging and Monitoring

### Log Levels

Configure logging with the `MCP_LOG_LEVEL` environment variable:
- `DEBUG`: Detailed information including performance metrics
- `INFO`: General operational information (default)
- `WARN`: Warning messages
- `ERROR`: Error messages only

### File Logging

Enable file logging with `MCP_LOG_TO_FILE=true`. Logs are saved to:
`~/.macos-simulator-mcp/logs/mcp-[timestamp].log`

### Performance Metrics

In DEBUG mode, the server logs performance statistics every minute:
- Operation execution times
- Success/failure rates
- Average, min, and max durations

## Health Checks and Diagnostics

### Diagnostic Tool

Run a comprehensive health check:

```json
{
  "name": "diagnostic",
  "arguments": {}
}
```

The diagnostic report includes:
- Permission status
- Screen capture capability
- Mouse control functionality
- OCR system status
- System information

### Health Status Levels

- **Healthy**: All systems operational
- **Degraded**: Non-critical features may not work
- **Unhealthy**: Critical features are unavailable

## Troubleshooting Guide

### Common Issues and Solutions

1. **"Permission denied: screenRecording"**
   - Grant Screen Recording permission in System Preferences
   - Restart the terminal or application

2. **"Screenshot returned null"**
   - Check if screen is locked or display is sleeping
   - Verify Screen Recording permission is granted
   - Try restarting the MCP server

3. **"Window not found"**
   - Ensure the window title matches (partial match supported)
   - Check if the application is running
   - Try using `list_windows` to see available windows

4. **"OCR timeout"**
   - Large images may take longer to process
   - Try capturing a smaller region
   - Check system resources (CPU/memory)

5. **"Coordinates out of bounds"**
   - Use `get_screen_info` to check screen dimensions
   - Ensure coordinates account for display scaling
   - Check if using multiple displays

### Debug Mode

Enable debug mode for detailed troubleshooting:

```bash
export MCP_LOG_LEVEL=DEBUG
export MCP_LOG_TO_FILE=true
```

This provides:
- Detailed operation logs
- Performance timing for each step
- Complete error stack traces
- Input/output validation details

## Best Practices

1. **Always check permissions** before performing operations
2. **Use the diagnostic tool** when setting up or troubleshooting
3. **Handle errors gracefully** in your client code
4. **Monitor circuit breaker status** for system health
5. **Enable debug logging** when investigating issues
6. **Validate inputs** before sending to the server

## Recovery Strategies

### Automatic Recovery

The server implements several automatic recovery mechanisms:
- Retry with exponential backoff for transient failures
- Circuit breakers prevent cascading failures
- OCR worker restart on initialization failure
- Graceful degradation when non-critical features fail

### Manual Recovery

When automatic recovery fails:
1. Run the diagnostic tool to identify issues
2. Check and fix permissions if needed
3. Restart the MCP server
4. Clear any temporary files or caches
5. Check system resources (CPU, memory, disk space)

## Error Reporting

When reporting issues, include:
1. The complete error message
2. Diagnostic tool output
3. Relevant log entries (with DEBUG enabled)
4. Steps to reproduce the issue
5. System information (macOS version, hardware)