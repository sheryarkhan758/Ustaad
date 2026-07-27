/**
 * Weekly availability — §6.8, FR-8.1.
 *
 * The grid is the whole screen. Slot generation for a booking is the template
 * here minus whatever is already booked, computed server-side — this page only
 * owns the template.
 */

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AvailabilityGrid } from '../../components/tutor/AvailabilityGrid';
import { Card, CardBody, CardHeader, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

export default function Schedule() {
  const { t } = useTranslation(['tutor', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();

  const profile = useQuery({
    queryKey: ['tutor', 'profile'],
    queryFn: async () => (await api.get('/tutors/profile'))?.profile ?? null,
  });

  const availability = useQuery({
    queryKey: ['tutor', 'availability'],
    queryFn: async () => (await api.get('/tutors/availability'))?.items ?? [],
  });

  /**
   * The grid hands back the whole week, so the write is a replace rather than
   * a diff. Simpler, and it cannot drift: a diff that mis-computes one removal
   * leaves a slot the tutor believes she deleted, and she finds out when
   * somebody books it.
   */
  const save = useMutation({
    mutationFn: async (slots) => {
      const existing = availability.data ?? [];
      for (const slot of existing) await api.del(`/tutors/availability/${slot.id}`);
      for (const slot of slots) await api.post('/tutors/availability', slot);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tutor', 'availability'] });
      toast.show({ title: t('availability.saved', { defaultValue: 'Availability saved' }) });
    },
  });

  if (availability.isPending) return <SkeletonCard label={t('common:state.loading')} />;

  return (
    <Card>
      <CardHeader title={t('availability.caption')} />
      <CardBody className="space-y-4">
        {availability.isError ? (
          <ErrorState error={availability.error} onRetry={availability.refetch} />
        ) : null}
        {save.isError ? <ErrorState error={save.error} /> : null}

        <AvailabilityGrid
          slots={availability.data ?? []}
          cityId={profile.data?.cityId}
          onChange={(slots) => save.mutate(slots)}
          disabled={save.isPending}
        />
      </CardBody>
    </Card>
  );
}
