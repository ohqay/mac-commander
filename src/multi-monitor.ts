import { screen, Display, Region, Point } from "@nut-tree-fork/nut-js";
import { performanceMonitor } from "./performance-monitor.js";

export interface Monitor {
  id: number;
  name: string;
  isPrimary: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
  rotation: number;
}

export interface MultiMonitorConfig {
  arrangement: 'horizontal' | 'vertical' | 'grid';
  primaryDisplay: number;
  totalBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export class MultiMonitorManager {
  private displays: Display[] = [];
  private monitorsCache: Monitor[] | null = null;
  private cacheTimestamp: number = 0;
  private cacheTTL: number = 5000; // 5 seconds cache

  /**
   * Get all available monitors
   */
  async getMonitors(): Promise<Monitor[]> {
    // Check cache
    if (this.monitorsCache && Date.now() - this.cacheTimestamp < this.cacheTTL) {
      return this.monitorsCache;
    }

    const operationId = `get_monitors_${Date.now()}`;
    performanceMonitor.startOperation(operationId);

    try {
      // Get all displays from nut.js
      const displays = await screen.listDisplays();
      this.displays = displays;

      // Convert to our Monitor interface
      const monitors: Monitor[] = displays.map((display, index) => ({
        id: index,
        name: `Display ${index + 1}`,
        isPrimary: index === 0, // Usually the first display is primary
        bounds: {
          x: display.bounds.left,
          y: display.bounds.top,
          width: display.bounds.width,
          height: display.bounds.height
        },
        workArea: {
          x: display.workArea.left,
          y: display.workArea.top,
          width: display.workArea.width,
          height: display.workArea.height
        },
        scaleFactor: display.scaleFactor || 1,
        rotation: 0 // nut.js doesn't provide rotation info
      }));

      this.monitorsCache = monitors;
      this.cacheTimestamp = Date.now();

      performanceMonitor.endOperation(operationId, {
        monitorCount: monitors.length
      });

      return monitors;
    } catch (error) {
      performanceMonitor.endOperation(operationId, {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to get monitors: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a specific monitor by ID
   */
  async getMonitor(monitorId: number): Promise<Monitor | null> {
    const monitors = await this.getMonitors();
    return monitors.find(m => m.id === monitorId) || null;
  }

  /**
   * Get the primary monitor
   */
  async getPrimaryMonitor(): Promise<Monitor> {
    const monitors = await this.getMonitors();
    const primary = monitors.find(m => m.isPrimary);
    
    if (!primary) {
      throw new Error('No primary monitor found');
    }
    
    return primary;
  }

  /**
   * Get monitor at specific coordinates
   */
  async getMonitorAtPoint(x: number, y: number): Promise<Monitor | null> {
    const monitors = await this.getMonitors();
    
    return monitors.find(monitor => 
      x >= monitor.bounds.x && 
      x < monitor.bounds.x + monitor.bounds.width &&
      y >= monitor.bounds.y && 
      y < monitor.bounds.y + monitor.bounds.height
    ) || null;
  }

  /**
   * Get the current monitor (where the mouse is)
   */
  async getCurrentMonitor(): Promise<Monitor | null> {
    const mousePos = await screen.currentMousePosition();
    return this.getMonitorAtPoint(mousePos.x, mousePos.y);
  }

  /**
   * Detect monitor arrangement
   */
  async getMonitorArrangement(): Promise<MultiMonitorConfig> {
    const monitors = await this.getMonitors();
    
    if (monitors.length === 0) {
      throw new Error('No monitors detected');
    }

    // Calculate total bounds
    const minX = Math.min(...monitors.map(m => m.bounds.x));
    const minY = Math.min(...monitors.map(m => m.bounds.y));
    const maxX = Math.max(...monitors.map(m => m.bounds.x + m.bounds.width));
    const maxY = Math.max(...monitors.map(m => m.bounds.y + m.bounds.height));

    const totalBounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };

    // Detect arrangement
    let arrangement: 'horizontal' | 'vertical' | 'grid' = 'horizontal';
    
    if (monitors.length === 2) {
      const [first, second] = monitors;
      const horizontalOverlap = this.calculateOverlap(
        first.bounds.y, 
        first.bounds.y + first.bounds.height,
        second.bounds.y, 
        second.bounds.y + second.bounds.height
      );
      
      const verticalOverlap = this.calculateOverlap(
        first.bounds.x, 
        first.bounds.x + first.bounds.width,
        second.bounds.x, 
        second.bounds.x + second.bounds.width
      );
      
      // If monitors have more horizontal overlap, they're arranged vertically
      arrangement = horizontalOverlap > verticalOverlap ? 'vertical' : 'horizontal';
    } else if (monitors.length > 2) {
      arrangement = 'grid';
    }

    const primaryDisplay = monitors.findIndex(m => m.isPrimary);

    return {
      arrangement,
      primaryDisplay: primaryDisplay >= 0 ? primaryDisplay : 0,
      totalBounds
    };
  }

  /**
   * Calculate overlap between two ranges
   */
  private calculateOverlap(start1: number, end1: number, start2: number, end2: number): number {
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * Translate coordinates from one monitor to another
   */
  async translateCoordinates(
    x: number, 
    y: number, 
    fromMonitorId: number, 
    toMonitorId: number
  ): Promise<Point> {
    const monitors = await this.getMonitors();
    const fromMonitor = monitors.find(m => m.id === fromMonitorId);
    const toMonitor = monitors.find(m => m.id === toMonitorId);

    if (!fromMonitor || !toMonitor) {
      throw new Error('Invalid monitor ID');
    }

    // Calculate relative position on source monitor (0-1)
    const relativeX = (x - fromMonitor.bounds.x) / fromMonitor.bounds.width;
    const relativeY = (y - fromMonitor.bounds.y) / fromMonitor.bounds.height;

    // Apply to target monitor
    const targetX = toMonitor.bounds.x + (relativeX * toMonitor.bounds.width);
    const targetY = toMonitor.bounds.y + (relativeY * toMonitor.bounds.height);

    return new Point(Math.round(targetX), Math.round(targetY));
  }

  /**
   * Get a region that spans multiple monitors
   */
  async getSpanningRegion(monitorIds: number[]): Promise<Region> {
    const monitors = await this.getMonitors();
    const selectedMonitors = monitors.filter(m => monitorIds.includes(m.id));

    if (selectedMonitors.length === 0) {
      throw new Error('No valid monitors selected');
    }

    const minX = Math.min(...selectedMonitors.map(m => m.bounds.x));
    const minY = Math.min(...selectedMonitors.map(m => m.bounds.y));
    const maxX = Math.max(...selectedMonitors.map(m => m.bounds.x + m.bounds.width));
    const maxY = Math.max(...selectedMonitors.map(m => m.bounds.y + m.bounds.height));

    return new Region(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * Move mouse across monitors smoothly
   */
  async moveMouseAcrossMonitors(
    targetX: number,
    targetY: number,
    duration: number = 1000
  ): Promise<void> {
    const currentPos = await screen.currentMousePosition();
    const currentMonitor = await this.getMonitorAtPoint(currentPos.x, currentPos.y);
    const targetMonitor = await this.getMonitorAtPoint(targetX, targetY);

    if (!currentMonitor || !targetMonitor) {
      // Fallback to simple move
      await screen.moveMouse(new Point(targetX, targetY));
      return;
    }

    // If crossing monitors, create path that goes through the edge
    if (currentMonitor.id !== targetMonitor.id) {
      const arrangement = await this.getMonitorArrangement();
      
      // Calculate edge crossing point
      let edgePoint: Point;
      
      if (arrangement.arrangement === 'horizontal') {
        // Moving horizontally between monitors
        const isMovingRight = targetX > currentPos.x;
        const edgeX = isMovingRight 
          ? currentMonitor.bounds.x + currentMonitor.bounds.width - 1
          : currentMonitor.bounds.x;
        
        edgePoint = new Point(edgeX, currentPos.y);
      } else {
        // Moving vertically between monitors
        const isMovingDown = targetY > currentPos.y;
        const edgeY = isMovingDown 
          ? currentMonitor.bounds.y + currentMonitor.bounds.height - 1
          : currentMonitor.bounds.y;
        
        edgePoint = new Point(currentPos.x, edgeY);
      }

      // Move to edge first, then to target
      const halfDuration = duration / 2;
      await this.smoothMove(currentPos, edgePoint, halfDuration);
      await this.smoothMove(edgePoint, new Point(targetX, targetY), halfDuration);
    } else {
      // Same monitor, simple smooth move
      await this.smoothMove(currentPos, new Point(targetX, targetY), duration);
    }
  }

  /**
   * Smooth mouse movement
   */
  private async smoothMove(from: Point, to: Point, duration: number): Promise<void> {
    const steps = Math.max(10, Math.floor(duration / 16)); // ~60fps
    const stepDelay = duration / steps;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Easing function for natural movement
      const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      
      const x = Math.round(from.x + (to.x - from.x) * easedT);
      const y = Math.round(from.y + (to.y - from.y) * easedT);
      
      await screen.moveMouse(new Point(x, y));
      
      if (i < steps) {
        await new Promise(resolve => setTimeout(resolve, stepDelay));
      }
    }
  }

  /**
   * Clear monitor cache
   */
  clearCache(): void {
    this.monitorsCache = null;
    this.cacheTimestamp = 0;
  }
}

// Singleton instance
export const multiMonitorManager = new MultiMonitorManager();