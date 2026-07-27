/**
 * Shareable profile and QR code — §6.21.
 *
 * ── WhatsApp is the share button that matters ──────────────────────────────
 * This is how the market actually passes things around. A generic "copy link"
 * as the primary action asks a mother to copy, switch apps, find the chat and
 * paste; `wa.me` collapses that to one tap and lands in the app she was going
 * to use anyway. The Web Share API is offered first where it exists, because
 * it is the same idea with the native sheet.
 *
 * ── The QR is generated in the browser ─────────────────────────────────────
 * `qrcode` renders to a canvas locally. The obvious alternative — an image URL
 * from a QR service — would send every tutor's profile URL to a third party on
 * every render, and the URL identifies a named person. It would also break the
 * moment that service went down or started charging, on a project whose whole
 * infrastructure budget is zero.
 *
 * A tutor prints this. So the print stylesheet keeps the code and the URL and
 * drops everything else — a QR on a page that also prints navigation is a QR
 * somebody has to cut out.
 *
 * ── The clean URL ──────────────────────────────────────────────────────────
 * `/t/:slug`, not `/tutors/:slug?ref=search&page=2`. Short enough to read
 * aloud, short enough for a small QR with high error correction, and carrying
 * no trace of how the sharer got there.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';

import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { Check, ExternalLink } from '../ui/Icon';

/** The canonical public URL for a tutor. One definition, used by both actions. */
export function profileUrl(slug) {
  const origin = globalThis.location?.origin ?? 'https://ustaad.com';
  return `${origin}/t/${slug}`;
}

export function ShareProfile({ slug, displayName }) {
  const { t } = useTranslation(['search', 'common']);
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(false);

  const url = profileUrl(slug);

  useEffect(() => {
    if (!canvasRef.current) return;

    QRCode.toCanvas(canvasRef.current, url, {
      width: 176,
      margin: 1,
      // High error correction, so the code still scans after being printed,
      // photocopied and pinned to a noticeboard — which is what happens to it.
      errorCorrectionLevel: 'H',
      color: { dark: '#1B3A57', light: '#FFFFFF' },
    }).catch(() => setQrError(true));
  }, [url]);

  const share = async () => {
    const text = t('share.message', { name: displayName });

    // The native sheet where it exists — same idea, fewer taps.
    if (navigator.share) {
      try {
        await navigator.share({ title: displayName, text, url });
        return;
      } catch {
        // Dismissed, or unavailable. Fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `${t('share.message', { name: displayName })} ${url}`,
  )}`;

  return (
    <Card className="print:border-0 print:shadow-none">
      <CardBody className="space-y-4">
        <h2 className="font-display text-subtitle text-ink print:hidden">{t('share.title')}</h2>

        <div className="flex flex-col items-center gap-3">
          {qrError ? (
            <p className="text-caption text-slate">{t('share.qrFailed')}</p>
          ) : (
            <canvas
              ref={canvasRef}
              // The canvas is an image of the URL printed beneath it, so it is
              // decorative for a screen reader rather than a second copy.
              aria-hidden="true"
              className="rounded-record border border-slate-line bg-white p-2"
            />
          )}

          {/* Printed under the code, so a photograph of the page still works
              if the code will not scan. */}
          <p className="break-all text-center font-mono text-caption text-slate">{url}</p>
        </div>

        <div className="flex flex-col gap-2 print:hidden">
          {/* One tap, into the app this market actually uses. */}
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-tap-lg items-center justify-center gap-2 rounded-control bg-verdigris px-4 text-small font-medium text-white hover:bg-verdigris-deep"
          >
            {t('share.whatsapp')}
            <ExternalLink size="sm" />
          </a>

          <Button variant="secondary" onClick={share} fullWidth>
            {copied ? (
              <>
                <Check size="sm" />
                {t('share.copied')}
              </>
            ) : (
              t('share.copyLink')
            )}
          </Button>

          <Button variant="ghost" onClick={() => globalThis.print?.()} fullWidth>
            {t('share.print')}
          </Button>
        </div>

        <p className="text-caption text-slate print:hidden">{t('share.note')}</p>
      </CardBody>
    </Card>
  );
}
