/**
 * Change Detection Module
 *
 * Lightweight pixel-diff based change detection at reduced resolution (320x240).
 * Identifies which quadrants changed for dynamic tiling.
 * Runs in <5ms on-device.
 *
 * Note: Actual pixel comparison requires native image processing.
 * This module provides the interface; the implementation will use
 * expo-image-manipulator or a native module for pixel access.
 */

export interface ChangeDetectionResult {
  /** Overall diff percentage (0-100) */
  diffPercentage: number;
  /** Whether the change exceeds the threshold for triggering comparison */
  hasMeaningfulChange: boolean;
  /** Which quadrants (0-3) have significant changes */
  changedQuadrants: number[];
}

export interface ChangeDetectorConfig {
  /** Minimum diff percentage to consider meaningful (default 5%) */
  diffThreshold: number;
  /** Per-quadrant threshold (default 8%) */
  quadrantThreshold: number;
  /** Resolution to downsample to for comparison */
  compareWidth: number;
  compareHeight: number;
}

const DEFAULT_CONFIG: ChangeDetectorConfig = {
  diffThreshold: 5,
  quadrantThreshold: 8,
  compareWidth: 320,
  compareHeight: 240,
};

export class ChangeDetector {
  private config: ChangeDetectorConfig;
  private previousFrame: Uint8Array | null = null;

  constructor(config?: Partial<ChangeDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compare current frame against previous frame.
   * Accepts raw grayscale pixel data at compareWidth x compareHeight.
   *
   * Returns change detection result with quadrant analysis.
   */
  detectChange(currentFrame: Uint8Array): ChangeDetectionResult {
    if (!this.previousFrame || this.previousFrame.length !== currentFrame.length) {
      this.previousFrame = new Uint8Array(currentFrame);
      return {
        diffPercentage: 0,
        hasMeaningfulChange: false,
        changedQuadrants: [],
      };
    }

    const { compareWidth, compareHeight } = this.config;
    const totalPixels = compareWidth * compareHeight;
    const halfW = Math.floor(compareWidth / 2);
    const halfH = Math.floor(compareHeight / 2);

    // Per-quadrant diff counts
    const quadrantDiffs = [0, 0, 0, 0];
    const quadrantTotals = [0, 0, 0, 0];
    let totalDiff = 0;

    for (let y = 0; y < compareHeight; y++) {
      for (let x = 0; x < compareWidth; x++) {
        const idx = y * compareWidth + x;
        const diff = Math.abs(currentFrame[idx] - this.previousFrame[idx]);

        // Determine quadrant (0=TL, 1=TR, 2=BL, 3=BR)
        const q = (y < halfH ? 0 : 2) + (x < halfW ? 0 : 1);
        quadrantTotals[q]++;

        if (diff > 30) {
          // Pixel-level threshold
          totalDiff++;
          quadrantDiffs[q]++;
        }
      }
    }

    const diffPercentage = (totalDiff / totalPixels) * 100;

    const changedQuadrants: number[] = [];
    for (let q = 0; q < 4; q++) {
      if (quadrantTotals[q] > 0) {
        const qPercent = (quadrantDiffs[q] / quadrantTotals[q]) * 100;
        if (qPercent >= this.config.quadrantThreshold) {
          changedQuadrants.push(q);
        }
      }
    }

    // Reuse buffer to avoid GC pressure (~75KB per frame)
    this.previousFrame.set(currentFrame);

    return {
      diffPercentage,
      hasMeaningfulChange: diffPercentage >= this.config.diffThreshold,
      changedQuadrants,
    };
  }

  /**
   * Reset the detector (e.g., when switching rooms).
   */
  reset() {
    this.previousFrame = null;
  }
}
