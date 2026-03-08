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
  /** Sensor update interval in ms (default 100) */
  updateInterval: number;
}

const DEFAULT_CONFIG: MotionFilterConfig = {
  stableThresholdMs: 500,
  gyroThreshold: 0.15,
  accelThreshold: 0.3,
  updateInterval: 100,
};

export class MotionFilter {
  private config: MotionFilterConfig;
  private stableSince: number | null = null;
  private gyroSub: { remove: () => void } | null = null;
  private accelSub: { remove: () => void } | null = null;
  private lastAccel = { x: 0, y: 0, z: 0 };

  constructor(config?: Partial<MotionFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring device motion sensors.
   */
  async start() {
    Gyroscope.setUpdateInterval(this.config.updateInterval);
    Accelerometer.setUpdateInterval(this.config.updateInterval);

    this.gyroSub = Gyroscope.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
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

  private markUnstable() {
    this.stableSince = null;
  }
}
