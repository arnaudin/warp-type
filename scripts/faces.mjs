/**
 * The faces Warp Type ships, and where they came from.
 *
 * `name` is what the plugin presents to users; `source` is the typeface the
 * outlines were derived from. Those differ for Bowlby One, whose OFL grant
 * carries Reserved Font Names ("Bowlby", "Bowlby One", "Bowlby One SC").
 * Baking a subset into path data is a Modified Version under OFL 1.1, and the
 * reserved name may not be used for the font a user picks from a menu — so the
 * derived face is presented as Monolith and credits its source everywhere else.
 * The other three declare no reserved name and keep theirs.
 */
export const FACES = [
  {
    id: 'monolith',
    name: 'Monolith',
    blurb: 'Fat grotesque, tiny counters',
    dir: 'bowlby',
    source: 'Bowlby One',
    renamed: true,
    upstream: 'ofl/bowlbyone/BowlbyOne-Regular.ttf',
    license: 'ofl/bowlbyone/OFL.txt',
    licenseName: 'SIL Open Font License 1.1',
  },
  {
    id: 'archivo',
    name: 'Archivo Black',
    blurb: 'Clean heavy neo-grotesque',
    dir: 'archivo',
    source: 'Archivo Black',
    renamed: false,
    upstream: 'ofl/archivoblack/ArchivoBlack-Regular.ttf',
    license: 'ofl/archivoblack/OFL.txt',
    licenseName: 'SIL Open Font License 1.1',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    blurb: 'Fat slab serif, 70s poster',
    dir: 'ultra',
    source: 'Ultra',
    renamed: false,
    upstream: 'apache/ultra/Ultra-Regular.ttf',
    license: 'apache/ultra/LICENSE.txt',
    licenseName: 'Apache License 2.0',
  },
  {
    id: 'modak',
    name: 'Modak',
    blurb: 'Inflated bubble face',
    dir: 'modak',
    source: 'Modak',
    renamed: false,
    upstream: 'ofl/modak/Modak-Regular.ttf',
    license: 'ofl/modak/OFL.txt',
    licenseName: 'SIL Open Font License 1.1',
  },
];

/**
 * The characters baked into the core. Latin display work, so: both cases,
 * figures, and the punctuation an album cover actually uses. Anything outside
 * this set is dropped at layout time.
 */
export const CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_' +
  'abcdefghijklmnopqrstuvwxyz' +
  '‘’“”–—';
