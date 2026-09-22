export interface Bolt {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  duration: number;
}

export class BoltField {
  bolts: Bolt[] = [];

  launch(origin: { x: number; y: number }, targets: readonly { x: number; y: number }[]): void {
    for (const target of targets) {
      this.bolts.push({
        sx: origin.x,
        sy: origin.y,
        tx: target.x,
        ty: target.y,
        t: 0,
        duration: 0.36,
      });
    }
    if (this.bolts.length > 40) this.bolts.splice(0, this.bolts.length - 40);
  }

  update(dt: number): void {
    for (const bolt of this.bolts) bolt.t += dt / bolt.duration;
    this.bolts = this.bolts.filter((bolt) => bolt.t < 1);
  }

  clear(): void {
    this.bolts = [];
  }
}
