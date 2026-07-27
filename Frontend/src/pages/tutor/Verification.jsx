/**
 * Documents and the verification status — §6.6, §6.28.
 *
 * The two halves of the same thing: what she hands over, and what the platform
 * decided about it.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DocumentUpload } from '../../components/tutor/DocumentUpload';
import {
  CompletenessPanel,
  VerificationStatus,
  computeCompleteness,
} from '../../components/tutor/VerificationStatus';
import { ErrorState, SkeletonCard } from '../../components/ui/Card';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

export default function Verification() {
  const { t } = useTranslation(['tutor', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();

  const profile = useQuery({
    queryKey: ['tutor', 'profile'],
    queryFn: async () => (await api.get('/tutors/profile'))?.profile ?? null,
  });
  const documents = useQuery({
    queryKey: ['tutor', 'documents'],
    queryFn: async () => (await api.get('/tutors/documents'))?.items ?? [],
  });
  const verification = useQuery({
    queryKey: ['tutor', 'verification'],
    queryFn: () => api.get('/tutors/verification'),
  });
  const claims = useQuery({
    queryKey: ['tutor', 'claims'],
    queryFn: async () => (await api.get('/tutors/claims'))?.items ?? [],
  });

  const completeness = useMemo(
    () =>
      computeCompleteness({
        profile: profile.data,
        claims: claims.data ?? [],
        documents: documents.data ?? [],
      }),
    [profile.data, claims.data, documents.data],
  );

  const submit = useMutation({
    mutationFn: () => api.post('/tutors/profile/submit'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tutor', 'profile'] });
      toast.show({ title: t('verification.submitted', { defaultValue: 'Sent for verification' }) });
    },
  });

  if (profile.isPending || documents.isPending) {
    return <SkeletonCard label={t('common:state.loading')} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        {submit.isError ? <ErrorState error={submit.error} /> : null}

        <VerificationStatus
          profile={profile.data}
          records={verification.data?.records ?? []}
          completeness={completeness}
          onSubmit={() => submit.mutate()}
          submitting={submit.isPending}
        />

        <DocumentUpload
          documents={documents.data ?? []}
          onUploaded={() => queryClient.invalidateQueries({ queryKey: ['tutor', 'documents'] })}
        />
      </div>

      <aside className="lg:sticky lg:top-4">
        <CompletenessPanel completeness={completeness} />
      </aside>
    </div>
  );
}
