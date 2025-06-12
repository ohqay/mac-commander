# Practical MCP Server Improvements

## 1. Consistency Improvements

### Add Post-Action Delays
Add a small delay after click, type_text, and key_press to ensure UI has time to respond:

```typescript
// In click handler, after the click:
await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay

// In type_text handler, after typing:
await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay per action

// In key_press handler, after key press:
await new Promise(resolve => setTimeout(resolve, 150)); // 150ms for key combos
```

### Standardize Response Formats
Make all tools return consistent response structures:

```typescript
interface StandardResponse {
  success: boolean;
  action: string;
  details: any;
  screenshot?: string; // Optional screenshot path for verification
}
```

## 2. Reliability Improvements

### Add Verification Options
Add optional verification to click and type actions:

```typescript
// Enhanced click with verification
const ClickToolSchema = z.object({
  x: z.number(),
  y: z.number(),
  button: z.enum(["left", "right", "middle"]).default("left"),
  doubleClick: z.boolean().default(false),
  verify: z.boolean().default(false).describe("Take screenshot after click to verify")
});

// If verify is true, take a screenshot after click and return its path
```

### Better Window Focus Handling
Ensure windows are properly focused before interactions:

```typescript
// Before any click/type operation in a window:
if (args.windowTitle) {
  await focusWindow(args.windowTitle);
  await new Promise(resolve => setTimeout(resolve, 200)); // Wait for focus
}
```

## 3. Essential Missing Tools

### wait_for_element
Wait for specific UI elements to appear:

```typescript
{
  name: "wait_for_element",
  description: "Wait for text or UI element to appear on screen before continuing",
  inputSchema: {
    text: z.string().describe("Text to wait for"),
    timeout: z.number().default(10000).describe("Maximum wait time in milliseconds"),
    region: z.object({...}).optional()
  }
}

// Implementation: Poll every 500ms using find_text until found or timeout
```

### right_click
Separate right-click tool for clarity:

```typescript
{
  name: "right_click",
  description: "Right-click at specific coordinates (equivalent to click with button='right')",
  inputSchema: {
    x: z.number(),
    y: z.number()
  }
}
```

### hover
Hover over elements (useful for tooltips and menus):

```typescript
{
  name: "hover",
  description: "Hover mouse over specific coordinates for a duration",
  inputSchema: {
    x: z.number(),
    y: z.number(),
    duration: z.number().default(1000).describe("Hover duration in milliseconds")
  }
}
```

### scroll
Basic scrolling functionality:

```typescript
{
  name: "scroll",
  description: "Scroll up or down in the current window or region",
  inputSchema: {
    direction: z.enum(["up", "down"]),
    amount: z.number().default(5).describe("Number of scroll units"),
    x: z.number().optional().describe("X coordinate to scroll at"),
    y: z.number().optional().describe("Y coordinate to scroll at")
  }
}
```

## 4. Error Message Improvements

### More Helpful Error Messages
Instead of generic errors, provide actionable guidance:

```typescript
// Before:
throw new Error("Click failed");

// After:
throw new AutomationError(
  "Click failed - the coordinates may be outside screen bounds or the target may not be clickable. " +
  "Try using find_text to locate the element first, or verify the window is active.",
  'click',
  { x: args.x, y: args.y, screenBounds: { width: screenWidth, height: screenHeight } }
);
```

### Add Coordinate Validation
Validate coordinates before attempting actions:

```typescript
// Add to click, mouse_move, etc.
const screenInfo = await getScreenDimensions();
if (args.x < 0 || args.x > screenInfo.width || args.y < 0 || args.y > screenInfo.height) {
  throw new ValidationError(
    `Coordinates (${args.x}, ${args.y}) are outside screen bounds (${screenInfo.width}x${screenInfo.height})`,
    'click'
  );
}
```

## 5. Tool Response Enhancements

### Return More Context
Make responses more useful for the AI:

```typescript
// Enhanced find_text response
{
  found: true,
  searchText: "Submit",
  locations: [{
    text: "Submit",
    x: 100,
    y: 200,
    width: 80,
    height: 30,
    center: { x: 140, y: 215 }, // Add center point for easy clicking
    confidence: 95
  }],
  screenshot: "/tmp/mcp-screenshots/find-text-result.png" // Include screenshot for context
}
```

### Add Success Indicators
Make it clear when actions succeed:

```typescript
// Enhanced type_text response
{
  success: true,
  action: "type_text",
  text: "Hello World",
  characterCount: 11,
  estimatedDuration: 550, // ms
  message: "Successfully typed 11 characters"
}
```

## 6. Performance Optimizations

### Cache Window Information
Reduce redundant window queries:

```typescript
class WindowCache {
  private cache: Map<string, WindowInfo> = new Map();
  private maxAge = 5000; // 5 seconds
  
  async getWindow(title: string): Promise<WindowInfo> {
    const cached = this.cache.get(title);
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached;
    }
    
    const window = await findWindowByTitle(title);
    this.cache.set(title, { ...window, timestamp: Date.now() });
    return window;
  }
}
```

### Batch Permission Checks
Check permissions once per session instead of per-tool:

```typescript
class PermissionManager {
  private permissionsChecked = false;
  private permissionResults: PermissionStatus;
  
  async ensurePermissions(): Promise<void> {
    if (this.permissionsChecked) return;
    
    this.permissionResults = await checkAllPermissions();
    this.permissionsChecked = true;
    
    if (!this.permissionResults.allGranted) {
      logger.warn('Some permissions missing', this.permissionResults);
    }
  }
}
```

## Implementation Priority

1. **Post-action delays** - Immediate reliability improvement
2. **wait_for_element** - Solves timing issues
3. **Coordinate validation** - Prevents errors
4. **Better error messages** - Helps AI self-correct
5. **Response standardization** - Consistency
6. **Scroll tool** - Essential for modern UIs
7. **Verification options** - Confidence in actions
8. **Window caching** - Performance boost

These improvements focus on making the existing tools work more reliably rather than adding complexity.