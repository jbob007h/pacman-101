export interface Bolt {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  duration: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export interface IncomingShot {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  duration: number;
  strength: number;
}

/** Flight from a side panel to the ghost house, in seconds. */
const INCOMING_FLIGHT = 0.42;

export class BoltField {
  bolts: Bolt[] = [];
  incoming: IncomingShot[] = [];
  particles: Particle[] = [];
  /** 1 right after an incoming impact, then falls to 0. */
  shake = 0;
  /** 1 right after an incoming impact, then falls to 0. */
  flash = 0;

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

  /** A sim's attack flying toward the ghost house. Jammers spawn when it arrives. */
  queueIncoming(from: { x: number; y: number }, to: { x: number; y: number }, strength: number): void {
    this.incoming.push({
      sx: from.x,
      sy: from.y,
      tx: to.x,
      ty: to.y,
      t: 0,
      duration: INCOMING_FLIGHT,
      strength,
    });
  }

  update(dt: number, onImpact?: (strength: number) => void): void {
    for (const bolt of this.bolts) bolt.t += dt / bolt.duration;
    this.bolts = this.bolts.filter((bolt) => bolt.t < 1);

    if (dt > 0) {
      this.shake = Math.max(0, this.shake - dt / 0.28);
      this.flash = Math.max(0, this.flash - dt / 0.22);
    }

    const stillFlying: IncomingShot[] = [];
    for (const shot of this.incoming) {
      shot.t += dt / shot.duration;
      if (shot.t >= 1) {
        this.impact(shot.tx, shot.ty);
        onImpact?.(shot.strength);
        continue;
      }
      stillFlying.push(shot);
    }
    this.incoming = stillFlying;

    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  clear(): void {
    this.bolts = [];
    this.incoming = [];
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
  }

  private impact(x: number, y: number): void {
    this.shake = 1;
    this.flash = 1;
    const count = 20;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 80 + (i % 5) * 22;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4,
        max: 0.4,
      });
    }
  }
}
