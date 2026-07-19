export type AppId =
  | 'overview'
  | 'appview'
  | 'projector'
  | 'calendar'
  | 'drive'
  | 'mailer'
  | 'organizer';

export interface AppMeta {
  id: AppId;
  label: string;
  short: string;
  description: string;
  accent: string;
}

export const apps: AppMeta[] = [
  {
    id: 'overview',
    label: 'Overview',
    short: 'OV',
    description: 'Command center across all Kyber ERP modules',
    accent: 'from-indigo-500 to-sky-500'
  },
  {
    id: 'appview',
    label: 'AppView',
    short: 'AV',
    description: 'Accounting · AP/AR · HR · Procurement · Inventory · Sales',
    accent: 'from-violet-500 to-indigo-500'
  },
  {
    id: 'projector',
    label: 'Projector',
    short: 'PR',
    description: 'Project convos · tasks · reflections (com.etzhayyim.projector.*)',
    accent: 'from-fuchsia-500 to-pink-500'
  },
  {
    id: 'calendar',
    label: 'Calendar',
    short: 'CA',
    description: 'Events · RFC 5545 rrule · attendee DIDs',
    accent: 'from-emerald-500 to-teal-500'
  },
  {
    id: 'drive',
    label: 'Drive',
    short: 'DR',
    description: 'Files · folders · E2EE blob storage',
    accent: 'from-amber-500 to-orange-500'
  },
  {
    id: 'mailer',
    label: 'Mailer',
    short: 'MA',
    description: 'Mail interception · BEC detection · SMTP/Outlook bridge',
    accent: 'from-rose-500 to-red-500'
  },
  {
    id: 'organizer',
    label: 'Organizer',
    short: 'OR',
    description: 'Vault · Blake3 dedup · AI auto-classify · subscription recommender',
    accent: 'from-cyan-500 to-blue-500'
  }
];

export const appMap: Record<AppId, AppMeta> = Object.fromEntries(
  apps.map((a) => [a.id, a])
) as Record<AppId, AppMeta>;
