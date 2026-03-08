/**
 * Comparison Manager — "The Silent Trigger"
 *
 * Orchestrates when to send frames to the server for AI comparison.
 * Only triggers when: hasMeaningfulChange AND isStable AND cooldownElapsed.
 *
 * Handles burst capture (2 frames 500ms apart) and SSE response parsing.
 */

import { MotionFilter } from "../sensors/motion-filter";
import { ChangeDetector, type ChangeDetectionResult } from "./change-detector";

export interface ComparisonFinding {
  category: string;
  description: string;
  severity: string;
  confidence: number;
  findingCategory: string;
  isClaimable: boolean;
  objectClass?: string;
}

export interface ComparisonResult {
  findings: ComparisonFinding[];
  summary: string;
  readiness_score: number;
}

export interface ComparisonManagerConfig {
  /** Minimum interval between comparisons in ms (default 5000) */
  minIntervalMs: number;
  /** Maximum concurrent comparisons (default 1) */
  maxConcurrent: number;
}

const DEFAULT_CONFIG: ComparisonManagerConfig = {
  minIntervalMs: 5000,
  maxConcurrent: 1,
};

type ComparisonCallback = (result: ComparisonResult, roomId: string) => void;
type StatusCallback = (status: "processing" | "complete" | "error") => void;

export class ComparisonManager {
  private config: ComparisonManagerConfig;
  private motionFilter: MotionFilter;
  private changeDetector: ChangeDetector;
  private lastComparisonTime = 0;
  private activeComparisons = 0;
  private paused = false;

  private onFinding: ComparisonCallback | null = null;
  private onStatus: StatusCallback | null = null;

  constructor(
    motionFilter: MotionFilter,
    changeDetector: ChangeDetector,
    config?: Partial<ComparisonManagerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.motionFilter = motionFilter;
    this.changeDetector = changeDetector;
  }

  /**
   * Register callback for when findings are received.
   */
  onResult(callback: ComparisonCallback) {
    this.onFinding = callback;
  }

  /**
   * Register callback for comparison status updates.
   */
  onStatusChange(callback: StatusCallback) {
    this.onStatus = callback;
  }

  /**
   * Check if conditions are met for triggering a comparison.
   */
  shouldTrigger(changeResult: ChangeDetectionResult): boolean {
    if (this.paused) return false;
    if (this.activeComparisons >= this.config.maxConcurrent) return false;
    if (!changeResult.hasMeaningfulChange) return false;
    if (!this.motionFilter.isStable()) return false;

    const elapsed = Date.now() - this.lastComparisonTime;
    if (elapsed < this.config.minIntervalMs) return false;

    return true;
  }

  /**
   * Execute a comparison by sending frames to the SSE endpoint.
   *
   * @param captureFrames - Function that captures 1-2 high-res frames (burst capture)
   * @param baselineUrl - URL of the baseline image for this angle
   * @param roomName - Name of the current room
   * @param roomId - ID of the current room
   * @param options - Additional options (inspectionMode, knownConditions, etc.)
   */
  async triggerComparison(
    captureFrames: () => Promise<string[]>,
    baselineUrl: string,
    roomName: string,
    roomId: string,
    options: {
      inspectionMode?: string;
      knownConditions?: string[];
      inspectionId?: string;
      baselineImageId?: string;
      apiUrl: string;
      authToken: string;
    },
  ) {
    this.activeComparisons++;
    this.lastComparisonTime = Date.now();
    this.onStatus?.("processing");

    try {
      // Burst capture: 2 frames 500ms apart
      const frames = await captureFrames();

      // POST to SSE endpoint
      const res = await fetch(`${options.apiUrl}/api/vision/compare-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.authToken}`,
        },
        body: JSON.stringify({
          baselineUrl,
          currentImages: frames,
          roomName,
          inspectionMode: options.inspectionMode || "turnover",
          knownConditions: options.knownConditions || [],
          inspectionId: options.inspectionId,
          roomId,
          baselineImageId: options.baselineImageId,
        }),
      });

      if (!res.ok) {
        this.onStatus?.("error");
        return;
      }

      // Parse SSE response
      const text = await res.text();
      const resultMatch = text.match(/event: result\ndata: (.+)\n/);
      if (resultMatch) {
        try {
          const result: ComparisonResult = JSON.parse(resultMatch[1]);
          this.onFinding?.(result, roomId);
        } catch {
          // Parse error — ignore
        }
      }

      this.onStatus?.("complete");
    } catch {
      this.onStatus?.("error");
    } finally {
      this.activeComparisons--;
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
