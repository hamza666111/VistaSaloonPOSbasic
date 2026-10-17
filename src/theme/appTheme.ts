const colorTokens = ['10271db3', '173e36', '183c2c03', '183d34', '194433', '1b462d09', '1e6556', '203e32', '243f32', '245b49', '253b36', '254635', '276b58', '284b37', '294e35', '2f6d56', '315b47', '325c43', '35583e', '35634b', '356b3d', '3d826d', '425c3d', '435448', '49664b', '567059', '5b7155', '5e7159', '64785f', '65835a', '6b806b', '6b9988', '729d83', '729e8c', '7a8874', '7b8878', '7b8972', '7d8c73', '819086', '83917a', '83917d', '87947d', '8a9581', '8b9788', '8baf93', '8d988a', '8fa99c', '90aa9b', '91ae98', '97b19f', '9aa18f', '9fb6a8', 'acbeb3', 'b6c6a6', 'b6c7bb', 'b7c7a4', 'b9d0a605', 'b9d0a607', 'b9d0a611', 'b9d0a617', 'bac8b9', 'c0d1c7', 'c6d6a7', 'd0dbc7', 'd0ddd6', 'd3e4cb', 'd6dfce', 'd7e4c6', 'd8e3d2', 'd8e5bd', 'dbe7c8', 'dce1d4', 'dce3d9', 'dce4d5', 'dfe6d7', 'dfe6dd', 'e3e7de', 'e4e9de', 'e4edda', 'e9f3e5', 'edf0e8', 'edf0e9', 'edf2e7', 'eef0e9', 'eef2e8', 'f0f3ec', 'f0f6ed', 'f9fbf5', 'fafbf7'];
const hexRgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const rgbHsl = ([r, g, b]: number[]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (delta) { h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4; h = (h * 60 + 360) % 360; }
  return { h, s: delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, l };
};
const hslRgb = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
};
const luminance = (rgb: number[]) => rgb.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export function accessibleAccent(hex: string) {
  const base = rgbHsl(hexRgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#245b49'));
  let rgb = hslRgb(base.h, base.s, base.l);
  while (1.05 / (luminance(rgb) + .05) < 4.5 && base.l > .06) { base.l -= .01; rgb = hslRgb(base.h, base.s, base.l); }
  return { ...base, rgb };
}
export function applyAppTheme(hex: string) {
  if (typeof document === 'undefined') return;
  const base = accessibleAccent(hex);
  const style = document.documentElement.style;
  for (const token of colorTokens) {
    const original = rgbHsl(hexRgb('#' + token.slice(0, 6)));
    const saturation = Math.min(.82, original.s * (base.s === 0 ? 0 : .65 + base.s));
    const lightness = original.l < .23 || original.l > .52 ? original.l : Math.min(.45, original.l + (base.l - .25) * .45);
    const rgb = token.slice(0, 6) === '245b49' ? base.rgb : hslRgb(base.h, saturation, lightness);
    style.setProperty('--theme-' + token, token.length === 8 ? `rgba(${rgb.join(',')},${parseInt(token.slice(6),16)/255})` : `rgb(${rgb.join(',')})`);
  }
  const levels: Record<string, number> = {50:.97,100:.94,200:.86,300:.75,400:.58,500:.43,600:.34,700:base.l,800:.21,900:.15,950:.1};
  for (const [level, lightness] of Object.entries(levels)) style.setProperty('--accent-' + level, (level === '700' ? base.rgb : hslRgb(base.h, Math.min(.82,base.s),lightness)).join(' '));
  style.setProperty('--app-accent', `rgb(${base.rgb.join(',')})`);
  style.setProperty('--app-accent-soft', `rgb(${hslRgb(base.h,base.s*.4,.94).join(',')})`);
  style.setProperty('--app-accent-ink', `rgb(${hslRgb(base.h,base.s,.23).join(',')})`);
}
