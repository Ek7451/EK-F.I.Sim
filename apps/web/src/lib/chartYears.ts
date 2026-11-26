import type { YearRecord } from '@fisim/engine';
import { agesText } from './outcome';

type YearAges = Pick<YearRecord, 'year' | 'ages'>;

export const yearWithAges = (r: YearAges): string => `${r.year} · ${agesText(r)}`;

export function householdAges(people: { name: string; birthYear: number }[], year: number): string {
  return people.map((p) => `${p.name}, age ${year - p.birthYear}`).join(' · ');
}

/** Keep the underlying year values for zoom, selection and mark lines. Format ticks and default tooltip headers. */
export function chartYearLabels(c: { ink3: string }, source: YearAges[] | ((year: number) => string)) {
  const format = (value: string | number): string => {
    const year = Number(value);
    if (typeof source === 'function') return source(year);
    const record = source[year - source[0]?.year];
    return record ? yearWithAges(record) : String(value);
  };
  return {
    axisLabel: {
      color: c.ink3,
      fontSize: 11,
      margin: 8,
      formatter: format,
      hideOverlap: true,
      alignMinLabel: 'left' as const,
      alignMaxLabel: 'right' as const,
    },
    axisPointer: { label: { formatter: (p: { value: string | number }) => format(p.value) } },
  };
}
