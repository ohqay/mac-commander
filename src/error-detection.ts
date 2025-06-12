import { screen, Region, Image, imageResource, FileType } from "@nut-tree-fork/nut-js";
import { extractTextFromImage, findTextInImage, getTextLocations } from "./ocr-utils.js";

export interface ErrorPattern {
  name: string;
  description: string;
  patterns: string[];
  severity: "error" | "warning" | "info";
}

export interface DetectedError {
  pattern: ErrorPattern;
  location?: Region;
  confidence?: number;
  timestamp: Date;
}

// Common error patterns to look for in macOS applications
export const commonErrorPatterns: ErrorPattern[] = [
  {
    name: "red_error_badge",
    description: "Red circular error badge often used in macOS apps",
    patterns: ["error", "exclamation", "alert"],
    severity: "error",
  },
  {
    name: "modal_dialog",
    description: "Modal dialog boxes that might contain errors",
    patterns: ["OK", "Cancel", "Error", "Alert", "Warning"],
    severity: "warning",
  },
  {
    name: "crash_dialog",
    description: "Application crash or unexpected quit dialog",
    patterns: ["quit unexpectedly", "crashed", "report", "reopen"],
    severity: "error",
  },
  {
    name: "permission_dialog",
    description: "Permission request dialogs",
    patterns: ["would like to access", "permission", "allow", "deny"],
    severity: "info",
  },
];

export class ErrorDetector {
  private errorPatterns: ErrorPattern[];

  constructor(patterns: ErrorPattern[] = commonErrorPatterns) {
    this.errorPatterns = patterns;
  }

  async detectErrors(region?: Region): Promise<DetectedError[]> {
    const detectedErrors: DetectedError[] = [];
    
    try {
      // Take a screenshot of the specified region or entire screen
      const screenshot = region ? await screen.grabRegion(region) : await screen.grab();
      
      // Extract text from the screenshot
      const extractedText = await extractTextFromImage(screenshot);
      const textLocations = await getTextLocations(screenshot);
      
      // Check for error patterns in the extracted text
      for (const pattern of this.errorPatterns) {
        for (const searchTerm of pattern.patterns) {
          if (extractedText.toLowerCase().includes(searchTerm.toLowerCase())) {
            // Find the location of the error text
            const errorLocation = textLocations.find(loc => 
              loc.text.toLowerCase().includes(searchTerm.toLowerCase())
            );
            
            detectedErrors.push({
              pattern,
              location: errorLocation ? new Region(
                errorLocation.x,
                errorLocation.y,
                errorLocation.width,
                errorLocation.height
              ) : undefined,
              confidence: errorLocation?.confidence,
              timestamp: new Date(),
            });
          }
        }
      }
      
      return detectedErrors;
    } catch (error) {
      console.error("Error during error detection:", error);
      return detectedErrors;
    }
  }

  async findTextInRegion(searchText: string, region?: Region): Promise<boolean> {
    try {
      const screenshot = region ? await screen.grabRegion(region) : await screen.grab();
      return await findTextInImage(screenshot, searchText);
    } catch (error) {
      console.error("Error during text search:", error);
      return false;
    }
  }

  async checkForCommonErrors(): Promise<DetectedError[]> {
    // Simply use detectErrors with no region to check entire screen
    return await this.detectErrors();
  }

  async captureErrorContext(error: DetectedError): Promise<{
    screenshot: Image | null;
    timestamp: Date;
    description: string;
  }> {
    try {
      const screenshot = error.location 
        ? await screen.grabRegion(error.location)
        : await screen.grab();
      
      return {
        screenshot,
        timestamp: new Date(),
        description: `${error.pattern.name}: ${error.pattern.description}`,
      };
    } catch (e) {
      return {
        screenshot: null,
        timestamp: new Date(),
        description: `Failed to capture context: ${e}`,
      };
    }
  }
}