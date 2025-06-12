# macOS Simulator MCP - Testing Guide

This document provides comprehensive information about the testing infrastructure for the macOS Simulator MCP project.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Test Coverage](#test-coverage)
- [Continuous Integration](#continuous-integration)
- [Best Practices](#best-practices)

## Overview

The macOS Simulator MCP project uses **Vitest** as its testing framework. Vitest provides excellent TypeScript and ESM support, fast execution, and a familiar Jest-like API.

### Key Features

- **Unit Tests**: Test individual functions and components in isolation
- **Integration Tests**: Test how different parts of the system work together
- **End-to-End Tests**: Test complete user workflows and scenarios
- **Mocking**: Comprehensive mocks for external dependencies (nut-js, canvas, tesseract.js)
- **Coverage Reporting**: Track test coverage with detailed reports

## Test Structure

```
tests/
├── unit/                      # Unit tests for individual modules
│   ├── error-detection.test.ts
│   ├── image-utils.test.ts
│   ├── mcp-tools.test.ts
│   ├── mcp-tools-advanced.test.ts
│   └── ocr-utils.test.ts
├── integration/               # Integration tests for workflows
│   ├── screenshot-ocr-workflow.test.ts
│   └── window-management-workflow.test.ts
├── e2e/                      # End-to-end tests
│   └── user-automation-scenario.test.ts
├── mocks/                    # Mock implementations
│   ├── canvas.mock.ts
│   ├── nut-js.mock.ts
│   └── tesseract.mock.ts
├── fixtures/                 # Test data and fixtures
└── setup.ts                  # Global test setup
```

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI (opens browser-based UI)
npm run test:ui

# Run tests once (CI mode)
npm run test:run
```

### Running Specific Tests

```bash
# Run tests matching a pattern
npx vitest image-utils

# Run tests in a specific directory
npx vitest tests/unit

# Run tests with a specific name pattern
npx vitest -t "should capture screenshot"
```

### Debug Mode

```bash
# Run tests with Node.js inspector
node --inspect-brk ./node_modules/.bin/vitest run
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { imageToBase64 } from '../../src/image-utils';
import '../mocks/canvas.mock';

describe('imageToBase64', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert image to base64', async () => {
    const mockImage = {
      width: 100,
      height: 100,
      channels: 3,
      data: new Uint8Array(100 * 100 * 3),
      toRGB: vi.fn().mockResolvedValue({
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      }),
    };

    const result = await imageToBase64(mockImage);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { mockScreen } from '../mocks/nut-js.mock';
import { extractTextFromImage } from '../../src/ocr-utils';

describe('Screenshot to OCR workflow', () => {
  it('should extract text from screenshot', async () => {
    // Take screenshot
    const screenshot = await mockScreen.grab();
    
    // Extract text
    const text = await extractTextFromImage(screenshot);
    
    expect(text).toBeTruthy();
  });
});
```

### Using Mocks

The project includes comprehensive mocks for external dependencies:

1. **nut-js mock**: Simulates screen capture, mouse, keyboard, and window management
2. **canvas mock**: Simulates image processing operations
3. **tesseract.js mock**: Simulates OCR functionality

```typescript
import '../mocks/nut-js.mock';
import { mockMouse, mockKeyboard } from '../mocks/nut-js.mock';

// The mocks are automatically applied when imported
```

## Test Coverage

### Coverage Goals

- **Overall**: 80% minimum coverage
- **Critical paths**: 100% coverage for core functionality
- **New code**: All new code must include tests

### Viewing Coverage Reports

After running tests with coverage:

```bash
npm run test:coverage
```

Coverage reports are generated in multiple formats:
- **Console**: Summary displayed in terminal
- **HTML**: Detailed report at `coverage/index.html`
- **LCOV**: For CI integration at `coverage/lcov.info`

### Coverage Configuration

Coverage settings are defined in `vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 80,
    statements: 80,
  },
}
```

## Continuous Integration

Tests are automatically run on GitHub Actions for:
- Every push to main branch
- Every pull request
- Multiple Node.js versions (18, 20, 22)

See `.github/workflows/test.yml` for CI configuration.

## Best Practices

### 1. Test Organization

- **One test file per source file**: `image-utils.ts` → `image-utils.test.ts`
- **Group related tests**: Use `describe` blocks for logical grouping
- **Clear test names**: Use descriptive names that explain what is being tested

### 2. Mock Management

- **Clear mocks between tests**: Always use `vi.clearAllMocks()` in `beforeEach`
- **Mock at appropriate level**: Mock external dependencies, not internal functions
- **Verify mock calls**: Use `expect(mock).toHaveBeenCalledWith(...)`

### 3. Async Testing

- **Always await async operations**: Prevent race conditions
- **Use proper async assertions**: `await expect(...).rejects.toThrow()`
- **Set appropriate timeouts**: Configure for long-running operations

### 4. Test Data

- **Use realistic test data**: Mock data should resemble real-world scenarios
- **Create reusable fixtures**: Store common test data in `fixtures/`
- **Avoid hardcoded values**: Use constants or generators

### 5. Error Testing

- **Test error cases**: Always test error handling paths
- **Verify error messages**: Check that errors contain helpful information
- **Test recovery**: Ensure the system can recover from errors

### 6. Performance

- **Keep tests fast**: Mock heavy operations like file I/O and network calls
- **Parallelize when possible**: Vitest runs tests in parallel by default
- **Avoid unnecessary setup**: Only set up what's needed for each test

## Adding New Tests

When adding new functionality:

1. **Write tests first** (TDD approach)
2. **Start with unit tests** for individual functions
3. **Add integration tests** for workflows
4. **Include error cases** and edge conditions
5. **Update documentation** if needed

### Example: Adding a New Tool Test

```typescript
// tests/unit/new-tool.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../mocks/nut-js.mock';

describe('new_tool', () => {
  let toolHandler: any;
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup tool handler
  });

  it('should perform expected action', async () => {
    const request = {
      params: {
        name: 'new_tool',
        arguments: { /* tool arguments */ },
      },
    };

    const result = await toolHandler(request);
    
    expect(result.content[0].text).toBe('Expected result');
  });

  it('should handle errors gracefully', async () => {
    // Test error handling
  });
});
```

## Troubleshooting

### Common Issues

1. **Mock not working**: Ensure mock is imported before the module being tested
2. **Timeout errors**: Increase timeout in test or `vitest.config.ts`
3. **Coverage gaps**: Check HTML report to identify uncovered lines
4. **Flaky tests**: Look for race conditions or missing awaits

### Debug Tips

- Use `console.log` for debugging (mocked in tests)
- Run single test with `it.only()`
- Use `--reporter=verbose` for detailed output
- Check mock call history with `mock.mock.calls`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
- [MCP SDK Documentation](https://modelcontextprotocol.io/)