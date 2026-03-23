/**
 * Motion Filter
 *
 * Uses device accelerometer + gyroscope to determine if the phone
 * is stable enough for a high-quality capture. Prevents sending
 * motion-blurred frames to the comparison API.
 */

import { Gyroscope, Accelerometer } from "expo-sensors";

export interface MotionFilterConfig {
  /** Minimum stable duration in ms before capture is allowed (default 500) */
  stableThresholdMs: number;
  /** Maximum angular velocity (rad/s) to consider "stable" (default 0.15) */
  gyroThreshold: number;
  /** Maximum linear acceleration delta to consider "stable" (default 0.3) */
  accelThreshold: number;
  /** Relaxed angular velocity threshold for walking captures */
  walkthroughGyroThreshold: number;
  /** Relaxed acceleration delta threshold for walking captures */
  walkthroughAccelThreshold: number;
  /** Sensor update interval in ms (default 100) */
  updateInterval: number;
}

const DEFAULT_CONFIG: MotionFilterConfig = {
  stableThresholdMs: 500,
  gyroThreshold: 0.15,
  accelThreshold: 0.3,
  walkthroughGyroThreshold: 0.8,
  walkthroughAccelThreshold: 1.2,
  updateInterval: 100,
};

export class MotionFilter {
  private config: MotionFilterConfig;
  private stableSince: number | null = null;
  private gyroSub: { remove: () => void } | null = null;
  private accelSub: { remove: () => void } | null = null;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private lastGyroMagnitude = Number.POSITIVE_INFINITY;
  private lastAccelDelta = Number.POSITIVE_INFINITY;
  private lastSampleAt = 0;

  constructor(config?: Partial<MotionFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring device motion sensors.
   */
  async start() {
    // Prevent double-subscribe if start() called without stop()
    if (this.gyroSub || this.accelSub) {
      this.stop();
    }

    Gyroscope.setUpdateInterval(this.config.updateInterval);
    Accelerometer.setUpdateInterval(this.config.updateInterval);

    this.gyroSub = Gyroscope.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      this.lastGyroMagnitude = magnitude;
      this.lastSampleAt = Date.now();
      if (magnitude > this.config.gyroThreshold) {
        this.markUnstable();
      }
    });

    this.accelSub = Accelerometer.addListener(({ x, y, z }) => {
      const dx = Math.abs(x - this.lastAccel.x);
      const dy = Math.abs(y - this.lastAccel.y);
      const dz = Math.abs(z - this.lastAccel.z);
      this.lastAccel = { x, y, z };

      const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.lastAccelDelta = delta;
      this.lastSampleAt = Date.now();
      if (delta > this.config.accelThreshold) {
        this.markUnstable();
      } else if (!this.stableSince) {
        this.stableSince = Date.now();
      }
    });
  }

  /**
   * Stop monitoring sensors.
   */
  stop() {
    this.gyroSub?.remove();
    this.accelSub?.remove();
    this.gyroSub = null;
    this.accelSub = null;
  }

  /**
   * Check if the device has been stable long enough for a quality capture.
   */
  isStable(): boolean {
    if (!this.stableSince) return false;
    return Date.now() - this.stableSince >= this.config.stableThresholdMs;
  }

  /**
   * Check if device is currently experiencing significant motion.
   */
  isMoving(): boolean {
    return !this.stableSince;
  }

  /**
   * Relaxed motion gate for walkthrough capture.
   * Allows capture while the user is moving steadily through a room,
   * as long as the phone is not experiencing sharp shake or abrupt turns.
   */
  isWalkthroughReady(): boolean {
    if (this.lastSampleAt === 0) return false;
    return (
      this.lastGyroMagnitude <= this.config.walkthroughGyroThreshold &&
      this.lastAccelDelta <= this.config.walkthroughAccelThreshold
    );
  }

  private markUnstable() {
    this.stableSince = null;
  }
}
