/**
 * Verification documents — §6.6, SEC-7, NFR-9.
 *
 * ── What the tutor is being asked to hand over ─────────────────────────────
 * A photograph of her national identity card. That is the single most sensitive
 * thing this platform will ever hold, and asking for it without saying what
 * happens to it is how a product loses the people it most needs.
 *
 * So every document type states, on the card, **what it is used for and who can
 * see it** — before the file input, not in a policy page.
 *
 * ── Direct to a private bucket ─────────────────────────────────────────────
 * The browser requests a short-lived signed URL and PUTs the file straight to
 * Supabase Storage. The bytes never pass through the API.
 *
 * **The honest consequence:** because the server never holds the bytes, it
 * cannot sniff them. This form checks the declared type, the extension and the
 * size, and that is genuinely weaker than the magic-byte check the two public
 * forms get. That gap is recorded in `docs/SECURITY_REVIEW.md` under SEC-24 and
 * must not be described as closed.
 *
 * ── Progress is real ───────────────────────────────────────────────────────
 * `XMLHttpRequest` rather than `fetch`, because `fetch` still has no upload
 * progress event. On a slow connection a 4 MB CNIC photograph takes a long
 * time, and a spinner that never moves is indistinguishable from a hang — the
 * person cancels and tries again, which is worse for everyone.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/Button';
import { Badge, Card, CardBody, ErrorState } from '../ui/Card';
import { Check, Warning } from '../ui/Icon';
import { api } from '../../lib/api';

/** Mirrors the server's `DOC_TYPES`. */
const DOC_TYPES = ['cnic_front', 'cnic_back', 'degree', 'transcript'];

/** 8 MB. A phone photograph of a CNIC is comfortably under this. */
const MAX_BYTES = 8 * 1024 * 1024;

const ACCEPTED = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

/**
 * Declared type, extension and size.
 *
 * Deliberately *not* described as a content check — see the header. Naming what
 * this does and does not verify is the point.
 */
function validate(file, t) {
  if (!file) return t('documents.errorNoFile');
  if (file.size > MAX_BYTES) {
    return t('documents.errorTooLarge', { max: Math.round(MAX_BYTES / 1024 / 1024) });
  }

  const extensions = ACCEPTED[file.type];
  if (!extensions) return t('documents.errorType');

  const name = file.name.toLowerCase();
  if (!extensions.some((extension) => name.endsWith(extension))) {
    // A file declaring `image/jpeg` but named `.exe` is either a mistake or an
    // attempt. Both are refused, and the message names the declared type only.
    return t('documents.errorMismatch', { type: file.type });
  }

  return null;
}

function uploadWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url, true);
    request.setRequestHeader('content-type', file.type);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });

    request.addEventListener('load', () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`upload failed with status ${request.status}`)),
    );
    request.addEventListener('error', () => reject(new Error('upload failed')));
    request.addEventListener('abort', () => reject(new Error('upload cancelled')));

    request.send(file);
  });
}

function DocumentCard({ docType, existing, onUploaded }) {
  const { t } = useTranslation(['tutor', 'common']);
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const choose = useCallback(
    async (file) => {
      setError(null);

      const problem = validate(file, t);
      if (problem) {
        setError({ message: problem });
        return;
      }

      try {
        setProgress(0);

        // A short-lived, single-purpose credential. It authorises one PUT to
        // one path and expires in minutes (SEC-7).
        const ticket = await api.post('/tutors/documents/ticket', {
          docType,
          contentType: file.type,
          sizeBytes: file.size,
        });

        await uploadWithProgress(ticket.uploadUrl, file, setProgress);

        const saved = await api.post('/tutors/documents', {
          docType,
          storagePath: ticket.storagePath,
        });

        setProgress(null);
        onUploaded?.(saved.document);
      } catch (cause) {
        setProgress(null);
        setError(cause);
      }
    },
    [docType, onUploaded, t],
  );

  const uploaded = Boolean(existing);

  return (
    <Card className={uploaded ? 'border-verdigris/40' : ''}>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-subtitle text-ink">{t(`documents.${docType}.title`)}</p>
            {/* What it is for, and who sees it. Before the input, not after. */}
            <p className="mt-1 text-small text-slate">{t(`documents.${docType}.purpose`)}</p>
          </div>
          {uploaded ? (
            <Badge tone="info">
              <Check size="sm" />
              {t('documents.uploaded')}
            </Badge>
          ) : null}
        </div>

        <p className="rounded-control border border-slate-line bg-paper px-3 py-2 text-caption text-slate">
          {t('documents.whoSees')}
        </p>

        {error ? <ErrorState error={error} /> : null}

        {progress !== null ? (
          <div>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('documents.uploading')}
              className="h-2 w-full overflow-hidden rounded-full bg-paper-sunk"
            >
              <div
                className="h-full bg-verdigris transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-caption tnum text-slate">
              {t('documents.uploadingPercent', { percent: progress })}
            </p>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={Object.keys(ACCEPTED).join(',')}
              className="sr-only"
              id={`upload-${docType}`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so re-choosing the same file still fires `change`.
                event.target.value = '';
                if (file) choose(file);
              }}
            />
            <Button
              variant={uploaded ? 'secondary' : 'accent'}
              onClick={() => inputRef.current?.click()}
            >
              {uploaded ? t('documents.replace') : t('documents.choose')}
            </Button>
          </>
        )}

        <p className="text-caption text-slate">
          {t('documents.accepted', { max: Math.round(MAX_BYTES / 1024 / 1024) })}
        </p>
      </CardBody>
    </Card>
  );
}

export function DocumentUpload({ documents = [], onUploaded }) {
  const { t } = useTranslation('tutor');
  const byType = new Map(documents.map((document) => [document.docType, document]));

  return (
    <div className="space-y-4">
      {/* The promise, stated once and prominently. */}
      <div className="rounded-card border-2 border-seal/30 bg-seal-soft p-4">
        <p className="flex items-center gap-2 font-display text-subtitle text-seal-deep">
          <Warning />
          {t('documents.privacyTitle')}
        </p>
        <p className="mt-2 text-small text-ink">{t('documents.privacyBody')}</p>
        <p className="mt-2 text-small text-ink">{t('documents.privacyAccess')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_TYPES.map((docType) => (
          <DocumentCard
            key={docType}
            docType={docType}
            existing={byType.get(docType)}
            onUploaded={onUploaded}
          />
        ))}
      </div>
    </div>
  );
}
