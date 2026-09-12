type AnalyticsUseCase = 'explore' | 'edit' | 'execute' | 'validate' | 'browser' | 'desktop' | 'review_recover' | 'publish' | 'work_session' | 'other';
type WorkflowIntent = 'auto' | 'investigation' | 'bugfix' | 'feature' | 'refactor' | 'migration' | 'cleanup' | 'documentation' | 'performance' | 'review' | 'release' | 'other';
type AnalyticsTaskIntent = WorkflowIntent | 'untracked';

const WORKFLOW_INTENTS = Object.freeze<WorkflowIntent[]>([
  'auto',
  'investigation',
  'bugfix',
  'feature',
  'refactor',
  'migration',
  'cleanup',
  'documentation',
  'performance',
  'review',
  'release',
  'other'
]);

const ANALYTICS_USE_CASES = Object.freeze([
  { id: 'explore', label: 'Explore & understand', shortLabel: 'Explore', primary: true },
  { id: 'edit', label: 'Edit code & files', shortLabel: 'Edit', primary: true },
  { id: 'execute', label: 'Run & manage processes', shortLabel: 'Execute', primary: true },
  { id: 'validate', label: 'Validate & test', shortLabel: 'Validate', primary: true },
  { id: 'browser', label: 'Browser & UI automation', shortLabel: 'Browser', primary: true },
  { id: 'desktop', label: 'Desktop control', shortLabel: 'Desktop', primary: true },
  { id: 'review_recover', label: 'Review & recover', shortLabel: 'Review', primary: true },
  { id: 'publish', label: 'Git & publish', shortLabel: 'Publish', primary: true },
  { id: 'work_session', label: 'Work-session control', shortLabel: 'Work', primary: false },
  { id: 'other', label: 'Other', shortLabel: 'Other', primary: true }
] as const);

const ANALYTICS_TASK_INTENTS = Object.freeze<AnalyticsTaskIntent[]>([...WORKFLOW_INTENTS, 'untracked']);
const USE_CASE_BY_ID = new Map<string, (typeof ANALYTICS_USE_CASES)[number]>(ANALYTICS_USE_CASES.map(item => [item.id, item]));
const TASK_INTENT_SET = new Set<string>(ANALYTICS_TASK_INTENTS);

const TASK_INTENT_LABELS: Readonly<Record<AnalyticsTaskIntent, string>> = Object.freeze({
  auto: 'Unclassified',
  investigation: 'Investigation',
  bugfix: 'Bug fixes',
  feature: 'Feature work',
  refactor: 'Refactoring',
  migration: 'Migration & upgrades',
  cleanup: 'Cleanup',
  documentation: 'Documentation',
  performance: 'Performance',
  review: 'Review & audit',
  release: 'Release & publishing',
  other: 'Other',
  untracked: 'Untracked'
});

function normalizeAnalyticsUseCase(value: unknown): AnalyticsUseCase {
  const id = String(value || '').trim().toLowerCase();
  return USE_CASE_BY_ID.has(id) ? id as AnalyticsUseCase : 'other';
}

function normalizeAnalyticsTaskIntent(value: unknown, fallback: AnalyticsTaskIntent = 'untracked'): AnalyticsTaskIntent {
  const intent = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (TASK_INTENT_SET.has(intent)) return intent as AnalyticsTaskIntent;
  return TASK_INTENT_SET.has(fallback) ? fallback : 'untracked';
}

function analyticsUseCaseLabel(value: unknown): string {
  return USE_CASE_BY_ID.get(normalizeAnalyticsUseCase(value))?.label || 'Other';
}

function analyticsUseCaseShortLabel(value: unknown): string {
  return USE_CASE_BY_ID.get(normalizeAnalyticsUseCase(value))?.shortLabel || 'Other';
}

function analyticsTaskIntentLabel(value: unknown): string {
  return TASK_INTENT_LABELS[normalizeAnalyticsTaskIntent(value, 'auto')] || 'Other';
}

function isPrimaryAnalyticsUseCase(value: unknown): boolean {
  return USE_CASE_BY_ID.get(normalizeAnalyticsUseCase(value))?.primary !== false;
}

export {
  ANALYTICS_TASK_INTENTS,
  ANALYTICS_USE_CASES,
  WORKFLOW_INTENTS,
  analyticsTaskIntentLabel,
  analyticsUseCaseLabel,
  analyticsUseCaseShortLabel,
  isPrimaryAnalyticsUseCase,
  normalizeAnalyticsTaskIntent,
  normalizeAnalyticsUseCase
};
export type { AnalyticsTaskIntent, AnalyticsUseCase, WorkflowIntent };
