import { describe, expect, it } from 'vitest';
import { classicTheme } from '../src/theme/classic';
import { deepSeaTheme } from '../src/theme/deepSea';
import type { ChaserPose, JammerPose } from '../src/theme/types';

const RED_BODY = '#ff2a36';
const MINE_BODY = '#e4232e';
const FRIGHT = '#2228e6';
const FRIGHT_FLASH = '#f7fbff';
const FACE = '#f7fbff';
const FROST_RING = '#8fd0ff';
const FROST_SPARK = '#e8f6ff';
const OLD_DEEP_FRIGHT = '#8ec8e6';
const OLD_DEEP_FROZEN = '#b7e6ff';

describe('frozen red jammers stay red', () => {
  it('keeps the classic red body and adds only an outside frost cue', () => {
    const liveLog = record(classicTheme.paint.jammer, jammer('red', false));
    const frozenLog = record(classicTheme.paint.jammer, jammer('red', true));

    expect(liveLog.fills).toContain(RED_BODY);
    expect(frozenLog.fills.slice(0, liveLog.fills.length)).toEqual(liveLog.fills);
    expect(frozenLog.fills).not.toContain(FROST_RING);
    expect(frozenLog.fills).not.toContain(OLD_DEEP_FROZEN);
    expect(frozenLog.fills.slice(liveLog.fills.length)).toEqual([FROST_SPARK, FROST_SPARK, FROST_SPARK, FROST_SPARK]);
    expect(frozenLog.strokes.slice(0, liveLog.strokes.length)).toEqual(liveLog.strokes);
    expect(frozenLog.strokes.at(-1)).toBe(FROST_RING);
    expect(liveLog.strokes).not.toContain(FROST_RING);
  });

  it('keeps the deep sea mine red, including spikes and the center dot', () => {
    const liveLog = record(deepSeaTheme.paint.jammer, jammer('red', false));
    const frozenLog = record(deepSeaTheme.paint.jammer, jammer('red', true));

    expect(liveLog.fills).toContain(MINE_BODY);
    expect(liveLog.fills).toContain('#ffd0d4');
    expect(liveLog.fills).toContain('#fff');
    expect(frozenLog.fills.slice(0, liveLog.fills.length)).toEqual(liveLog.fills);
    expect(frozenLog.fills).not.toContain(OLD_DEEP_FROZEN);
    expect(frozenLog.fills).not.toContain(FROST_RING);
    expect(frozenLog.fills.slice(liveLog.fills.length)).toEqual([FROST_SPARK, FROST_SPARK, FROST_SPARK, FROST_SPARK]);
    expect(frozenLog.strokes.slice(0, liveLog.strokes.length)).toEqual(liveLog.strokes);
    expect(frozenLog.strokes).toContain('#ffd8dc');
    expect(frozenLog.strokes.at(-1)).toBe(FROST_RING);
  });

  it('leaves pale urchins and white jammers alone', () => {
    expect(record(classicTheme.paint.jammer, jammer('white', false))).toEqual(
      record(classicTheme.paint.jammer, jammer('white', true)),
    );
    expect(record(deepSeaTheme.paint.jammer, jammer('white', false))).toEqual(
      record(deepSeaTheme.paint.jammer, jammer('white', true)),
    );
  });
});

describe('deep sea frightened color', () => {
  it('paints shark, jellyfish, squid, and anglerfish in dark saturated blue with a light face', () => {
    for (const species of [0, 1, 2, 3]) {
      const log = record(deepSeaTheme.paint.chaser, chaser(species, false));
      expect(log.fills).toContain(FRIGHT);
      expect(log.fills).toContain(FACE);
      expect(log.fills).not.toContain(OLD_DEEP_FRIGHT);
    }
  });

  it('keeps the end-of-fright flash pale', () => {
    for (const species of [0, 1, 2, 3]) {
      const log = record(deepSeaTheme.paint.chaser, chaser(species, true));
      expect(log.fills).toContain(FRIGHT_FLASH);
      expect(log.fills).not.toContain(FRIGHT);
      expect(log.fills).not.toContain(OLD_DEEP_FRIGHT);
    }
  });

  it('leaves the classic frightened ghost dark blue', () => {
    const log = record(classicTheme.paint.chaser, chaser(0, false));
    expect(log.fills).toContain(FRIGHT);
    const flash = record(classicTheme.paint.chaser, chaser(0, true));
    expect(flash.fills).toContain('#f4f6ff');
    expect(flash.fills).not.toContain(FRIGHT);
  });
});

function jammer(kind: JammerPose['kind'], frozen: boolean): JammerPose {
  return { kind, frozen, s: 2, time: 0.4 };
}

function chaser(species: number, flash: boolean): ChaserPose {
  return {
    sx: 40,
    sy: 40,
    dir: { x: 1, y: 0 },
    color: '#ff4b3a',
    mode: 'frightened',
    flash,
    eyesOnly: false,
    s: 2,
    homeX: species,
    time: 0.8,
    species,
    alpha: 1,
  };
}

function record<T>(draw: (ctx: CanvasRenderingContext2D, pose: T) => void, pose: T) {
  const { ctx, fills, strokes } = styleLog();
  draw(ctx, pose);
  return { fills, strokes };
}

function styleLog(): { ctx: CanvasRenderingContext2D; fills: string[]; strokes: string[] } {
  const fills: string[] = [];
  const strokes: string[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'fill') return () => fills.push(String(target.fillStyle));
      if (prop === 'stroke') return () => strokes.push(String(target.strokeStyle));
      if (prop in target) return target[prop as string];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes };
}
