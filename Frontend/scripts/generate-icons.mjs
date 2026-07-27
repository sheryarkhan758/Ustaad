/**
 * Rasterise the PWA icon set from `public/icons/icon.svg`.
 *
 *     npm run icons
 *
 * ── Why PNGs are still needed in 2026 ──────────────────────────────────────
 * Chrome on Android accepts an SVG icon in the manifest, but the *install*
 * path — the home-screen shortcut, the splash screen, the task switcher — is
 * more reliable with real PNGs, and `purpose: "maskable"` in particular is
 * inconsistently handled from SVG. Since §10.4 makes the Android install the
 * project's answer to its Android requirement, this is not a place to rely on
 * the more elegant option working everywhere.
 *
 * ── The maskable variants are not the same image ───────────────────────────
 * Android crops a maskable icon to a circle, a squircle or a rounded square
 * depending on the launcher, and can take up to 20% off each edge. So the
 * maskable set is drawn at 80% scale on a full-bleed navy field: the seal
 * survives every mask, and no launcher clips the ring.
 *
 * `sharp` is an optional dependency. If it is absent this prints what to do
 * rather than failing the build — the SVG in the manifest still installs.
 */

import fs from 'node:fs';
import path from 'node:path';

const ICONS = path.resolve('public/icons');
const SOURCE = path.join(ICONS, 'icon.svg');

/** The maskable variant: same mark, inset into the safe zone. */
function maskableSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1B3A57"/>
  <g transform="translate(256 256) scale(0.8) translate(-256 -256)">
    <circle cx="256" cy="256" r="150" fill="none" stroke="#A8763E" stroke-width="10" opacity="0.85"/>
    <circle cx="256" cy="256" r="122" fill="none" stroke="#A8763E" stroke-width="5" opacity="0.5"/>
    <path d="M196 262l42 42 84-92" fill="none" stroke="#0F7B8A" stroke-width="34"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ ${SOURCE} not found.`);
    process.exitCode = 1;
    return;
  }

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    console.log('▸ `sharp` is not installed, so no PNGs were written.\n');
    console.log('  The manifest still references icon.svg and the app will install,');
    console.log('  but the maskable variants are what make the Android home-screen');
    console.log('  icon render correctly on every launcher (§10.4).\n');
    console.log('  To generate them:  npm i -D sharp && npm run icons');
    return;
  }

  const maskablePath = path.join(ICONS, 'maskable.svg');
  fs.writeFileSync(maskablePath, maskableSvg(), 'utf8');

  const jobs = [
    { from: SOURCE, size: 192, out: 'icon-192.png' },
    { from: SOURCE, size: 512, out: 'icon-512.png' },
    { from: maskablePath, size: 192, out: 'maskable-192.png' },
    { from: maskablePath, size: 512, out: 'maskable-512.png' },
    // Apple ignores the manifest and reads the link tag; it also does not
    // respect transparency, hence the opaque navy field in the source.
    { from: SOURCE, size: 180, out: 'apple-touch-icon.png' },
  ];

  for (const job of jobs) {
    await sharp(job.from).resize(job.size, job.size).png({ compressionLevel: 9 }).toFile(path.join(ICONS, job.out));
    console.log(`  ✓ ${job.out} (${job.size}×${job.size})`);
  }

  console.log(`\n✓ wrote ${jobs.length} icons into public/icons`);
}

main().catch((error) => {
  console.error('✗ icon generation failed:', error.message);
  process.exitCode = 1;
});
