# Enhanced Screenshot Functionality

## Overview

The macOS Simulator MCP server now includes enhanced screenshot functionality with automatic temporary folder management and AI-accessible screenshot viewing capabilities.

## Key Features

### 1. **Automatic Temporary Storage**
- Screenshots are automatically saved to a temporary folder when no `outputPath` is specified
- Temporary folder location: `/tmp/mcp-screenshots` (or OS-specific temp directory)
- Automatic cleanup keeps the 20 most recent screenshots by default

### 2. **Smart File Naming**
- Timestamp-based filenames: `screenshot-YYYY-MM-DDTHH-MM-SS-###.png`
- Sequential counter prevents filename collisions
- Example: `screenshot-2025-06-12T07-23-56-001.png`

### 3. **AI Screenshot Management**
- **`list_screenshots`**: List all saved screenshots with metadata
- **`view_screenshot`**: Load and view specific screenshots as base64
- **`cleanup_screenshots`**: Clean up old screenshots manually

## Enhanced Tools

### `screenshot` (Enhanced)
**Default Behavior Change**: When no `outputPath` is specified, screenshots are now saved to temporary folder AND returned as base64.

```json
{
  "name": "screenshot",
  "arguments": {
    "region": {
      "x": 100,
      "y": 100,
      "width": 500,
      "height": 300
    }
  }
}
```

**Response includes**:
- Base64 image data for immediate use
- Filename of saved screenshot in temp folder
- Path information for reference

### `list_screenshots` (New)
List all screenshots saved in the temporary folder with detailed metadata.

```json
{
  "name": "list_screenshots",
  "arguments": {}
}
```

**Response**:
```json
{
  "tempFolder": "/tmp/mcp-screenshots",
  "count": 3,
  "screenshots": [
    {
      "filename": "screenshot-2025-06-12T07-23-56-003.png",
      "filepath": "/tmp/mcp-screenshots/screenshot-2025-06-12T07-23-56-003.png",
      "size": 45678,
      "created": "2025-06-12T07:23:56.789Z",
      "modified": "2025-06-12T07:23:56.789Z"
    }
  ]
}
```

### `view_screenshot` (New)
Load and view a specific screenshot by filename.

```json
{
  "name": "view_screenshot",
  "arguments": {
    "filename": "screenshot-2025-06-12T07-23-56-001.png"
  }
}
```

**Response**:
```json
{
  "filename": "screenshot-2025-06-12T07-23-56-001.png",
  "filepath": "/tmp/mcp-screenshots/screenshot-2025-06-12T07-23-56-001.png",
  "size": 45678,
  "created": "2025-06-12T07:23:56.789Z",
  "modified": "2025-06-12T07:23:56.789Z",
  "base64Data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### `cleanup_screenshots` (New)
Clean up old screenshots from the temporary folder.

```json
{
  "name": "cleanup_screenshots",
  "arguments": {
    "keepLast": 5
  }
}
```

**Response**:
```
"Cleanup completed: deleted 3 screenshots, kept 5 most recent ones."
```

## Usage Workflows

### 1. **Standard Screenshot Workflow**
```javascript
// Take a screenshot (automatically saved to temp folder)
const screenshot = await callTool("screenshot", {});

// List available screenshots
const list = await callTool("list_screenshots", {});

// View a specific screenshot later
const viewed = await callTool("view_screenshot", {
  filename: "screenshot-2025-06-12T07-23-56-001.png"
});
```

### 2. **AI Processing Workflow**
```javascript
// 1. Take multiple screenshots for analysis
await callTool("screenshot", { region: { x: 0, y: 0, width: 800, height: 600 }});
await callTool("screenshot", { region: { x: 800, y: 0, width: 800, height: 600 }});

// 2. List all screenshots
const screenshots = await callTool("list_screenshots", {});

// 3. Process each screenshot
for (const screenshot of screenshots.screenshots) {
  const imageData = await callTool("view_screenshot", {
    filename: screenshot.filename
  });
  
  // AI can now analyze the base64Data
  analyzeImage(imageData.base64Data);
}

// 4. Clean up when done
await callTool("cleanup_screenshots", { keepLast: 2 });
```

### 3. **Continuous Monitoring Workflow**
```javascript
// Take periodic screenshots
setInterval(async () => {
  const screenshot = await callTool("screenshot", {});
  
  // Process the current screenshot
  processScreenshot(screenshot);
  
  // Automatic cleanup happens in background (keeps 20 most recent)
}, 5000);
```

## File Management

### **Automatic Cleanup**
- Triggered after each screenshot save
- Keeps 20 most recent screenshots by default
- Deletes older screenshots automatically
- Logs cleanup actions for debugging

### **Manual Cleanup**
Use `cleanup_screenshots` tool with custom retention:
- `keepLast: 5` - Keep 5 most recent
- `keepLast: 10` - Keep 10 most recent
- Default: 5 screenshots when using manual cleanup

### **Security Features**
- Filename validation prevents directory traversal
- Only screenshots with proper naming pattern are accessible
- Temporary folder isolation from system files

## Backward Compatibility

All existing functionality remains unchanged:
- Specifying `outputPath` works exactly as before
- Base64 return behavior preserved when no path specified
- All existing tools and parameters unchanged

## Error Handling

### Common Errors and Solutions

**"Screenshot not found"**
- Use `list_screenshots` to see available files
- Check filename format matches expected pattern

**"Failed to save to temp folder"**
- Fallback to base64-only response
- Check disk space and permissions
- Temp folder creation logged for debugging

**"Invalid screenshot filename format"**
- Only files matching `screenshot-*.png` pattern accepted
- Use `list_screenshots` to get valid filenames

## Performance Considerations

- Automatic cleanup prevents unlimited disk usage
- Base64 encoding happens on-demand for `view_screenshot`
- File metadata cached for faster `list_screenshots` responses
- Temporary folder uses OS-appropriate location for optimal performance

## Integration Examples

### With OCR Tools
```javascript
// Take screenshot and extract text
const screenshot = await callTool("screenshot", {});
const text = await callTool("extract_text", {});

// Later, review the screenshot that text was extracted from
const list = await callTool("list_screenshots", {});
const latest = list.screenshots[0];
const image = await callTool("view_screenshot", { filename: latest.filename });
```

### With Error Detection
```javascript
// Take screenshot for error checking
const screenshot = await callTool("screenshot", {});
const errors = await callTool("check_for_errors", {});

if (errors.length > 0) {
  // Screenshot is saved for later review
  console.log("Error detected - screenshot saved for analysis");
}
```

## Technical Implementation

- **Storage**: OS temporary directory with dedicated subfolder
- **Naming**: ISO timestamp format with sequential counters
- **Cleanup**: Background cleanup after each save + manual tool
- **Access**: File-based access with security validation
- **Format**: PNG format for all saved screenshots
- **Metadata**: File stats including creation time, size, and modification time