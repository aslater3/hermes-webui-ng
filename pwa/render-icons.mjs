import { readFile, writeFile } from 'node:fs/promises';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
let initialised;
export async function renderIcons(root) {
  initialised ??= initWasm(readFile(new URL('./node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)));
  await initialised;
  const mark = (await readFile('client/hermes-mark.svg', 'utf8')).replace('<svg ', '<svg x="110" y="90" width="292" height="332" ').replaceAll('fill="#000"', 'fill="#fff"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#101216"/>${mark}</svg>`;
  for (const size of [180,192,512]) {
    const renderer = new Resvg(svg, { fitTo:{mode:'width',value:size},font:{loadSystemFonts:false} });
    const png = renderer.render(); await writeFile(`${root}/pwa/icon-${size}.png`, png.asPng()); png.free(); renderer.free();
  }
}
