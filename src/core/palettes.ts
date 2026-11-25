export interface Palette {
  id: string;
  name: string;
  bg: string;
  ink: string;
  /**
   * Colors are read per line, in order. Repeating an entry is deliberate — it
   * is how a theme groups lines (Doom paints lines 1–2 purple and 3–5 gray the
   * way the Master of Reality sleeve does).
   */
  colors: string[];
}

export const PALETTES: Palette[] = [
  {
    id: 'doom',
    name: 'Doom',
    bg: '#000000',
    ink: '#000000',
    colors: ['#a24fd6', '#a24fd6', '#adadad', '#adadad', '#adadad', '#a24fd6'],
  },
  {
    id: 'acid',
    name: 'Acid',
    bg: '#101007',
    ink: '#0a0a04',
    colors: ['#d8f24a', '#d8f24a', '#4ad98a', '#4ad98a', '#f2a03c', '#f2a03c'],
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    bg: '#2a1206',
    ink: '#1b0b03',
    colors: ['#f7d046', '#f18f3b', '#f18f3b', '#e0522c', '#e0522c', '#a52f22'],
  },
  {
    id: 'chrome',
    name: 'Chrome',
    bg: '#0b0d12',
    ink: '#05070a',
    colors: ['#e8ecf2', '#e8ecf2', '#8fa2b8', '#8fa2b8', '#5c6f8a', '#5c6f8a'],
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    bg: '#fdeef4',
    ink: '#3a1d2b',
    colors: ['#ff5d8f', '#ff5d8f', '#7b5cff', '#7b5cff', '#00c2b8', '#00c2b8'],
  },
  {
    id: 'ember',
    name: 'Ember',
    bg: '#f4efe6',
    ink: '#2b1f16',
    colors: ['#c1352c', '#c1352c', '#20211f', '#20211f', '#c1352c', '#20211f'],
  },
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
