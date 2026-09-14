/* ------------------------------------------------------------------
   Tiny 3x5 bitmap font (uppercase + digits + punctuation).
   Each glyph is 16 chars: the character, then 5 rows of 3 bits.
   Drawn with fillRect so it stays razor sharp at any upscale.
------------------------------------------------------------------- */
const DATA =
  'A010101111101101B110101110101110C011100100100011D110101101101110' +
  'E111100110100111F111100110100100G011100101101011H101101111101101' +
  'I111010010010111J001001001101010K101101110101101L100100100100111' +
  'M101111111101101N110101101101101O010101101101010P110101110100100' +
  'Q010101101110001R110101110101101S011100010001110T111010010010010' +
  'U101101101101111V101101101101010W101101111111101X101101010101101' +
  'Y101101010010010Z111001010100111';

const GLYPHS = {};
for (let i = 0; i < DATA.length; i += 16) GLYPHS[DATA[i]] = DATA.slice(i + 1, i + 16);
// digits + punctuation (added separately so the parse above stays unambiguous)
Object.assign(GLYPHS, {
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111',
  '3': '111001011001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001001001001', '8': '111101111101111',
  '9': '111101111001111', ' ': '000000000000000', '!': '010010010000010',
  '?': '110001010000010', '+': '000010111010000', '-': '000000111000000',
  '.': '000000000000010', ',': '000000000010010', ':': '000010000010000',
  '/': '001001010100100', '*': '101010101000000', '>': '100010001010100',
  '<': '001010100010001', '%': '101001010100101', '#': '101111101111101',
  '=': '000111000111000', '(': '010100100100010', ')': '010001001001010',
  "'": '010010000000000', '"': '101101000000000', '[': '011010010010011',
  ']': '110010010010110', '_': '000000000000111',
});

export function textWidth(text, scale = 1) {
  return text.length * 4 * scale - scale;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x  left/centre/right depending on align
 * @param {number} y  top
 */
export function drawText(ctx, text, x, y, scale = 1, color = '#fff', align = 'left', shadow = null) {
  text = String(text).toUpperCase();
  const w = textWidth(text, scale);
  let cx = align === 'center' ? Math.round(x - w / 2) : align === 'right' ? Math.round(x - w) : Math.round(x);
  const cy = Math.round(y);
  for (let pass = shadow ? 0 : 1; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? shadow : color;
    let px = cx;
    for (const ch of text) {
      const g = GLYPHS[ch] || GLYPHS['?'];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r * 3 + c] === '1') {
            ctx.fillRect(px + c * scale, cy + r * scale + (pass === 0 ? scale : 0), scale, scale);
          }
        }
      }
      px += 4 * scale;
    }
  }
  return w;
}
