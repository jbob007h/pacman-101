import { GHOST_ATTACK_WINDOW } from '../config';

/**
 * Batches frightened-ghost eats. The first eat opens a window. Further eats
 * only increment the count. When the window elapses, the count is the attack.
 */
export class GhostAttackWindow {
  private remaining = 0;
  private eaten = 0;

  eat(): void {
    if (this.remaining <= 0) {
      this.remaining = GHOST_ATTACK_WINDOW;
      this.eaten = 0;
    }
    this.eaten += 1;
  }

  /** Ghosts in the window that just closed, or null while it is still open. */
  tick(dt: number): number | null {
    if (this.remaining <= 0 || dt <= 0) return null;
    this.remaining -= dt;
    if (this.remaining > 0) return null;
    const count = this.eaten;
    this.remaining = 0;
    this.eaten = 0;
    return count > 0 ? count : null;
  }

  reset(): void {
    this.remaining = 0;
    this.eaten = 0;
  }
}
