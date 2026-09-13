import assert from 'node:assert/strict';
import {
  ANALYTICS_USE_CASES,
  analyticsTaskIntentLabel,
  analyticsUseCaseForOperation,
  analyticsUseCaseLabel,
  analyticsUseCaseShortLabel,
  isPrimaryAnalyticsUseCase,
  normalizeAnalyticsTaskIntent,
  normalizeAnalyticsUseCase
} from '../src/analyticsTaxonomy.js';
import { OPERATION_ID_VALUES } from '../src/tools/operationIds.js';

for (const operation of OPERATION_ID_VALUES) {
  assert.notEqual(analyticsUseCaseForOperation(operation), 'other', `operation ${operation} must have an explicit analytics use-case mapping`);
}

assert.equal(analyticsUseCaseForOperation('read'), 'explore');
assert.equal(analyticsUseCaseForOperation('edit'), 'edit');
assert.equal(analyticsUseCaseForOperation('process.start'), 'execute');
assert.equal(analyticsUseCaseForOperation('validate.checks'), 'validate');
assert.equal(analyticsUseCaseForOperation('browser'), 'browser');
assert.equal(analyticsUseCaseForOperation('computer'), 'desktop');
assert.equal(analyticsUseCaseForOperation('changes.restore'), 'review_recover');
assert.equal(analyticsUseCaseForOperation('publish.push'), 'publish');
assert.equal(analyticsUseCaseForOperation('work.finish'), 'work_session');
assert.equal(analyticsUseCaseForOperation('future.unknown.operation'), 'other');

assert.equal(normalizeAnalyticsUseCase('review_recover'), 'review_recover');
assert.equal(normalizeAnalyticsUseCase('not-real'), 'other');
assert.equal(isPrimaryAnalyticsUseCase('work_session'), false);
assert.equal(isPrimaryAnalyticsUseCase('explore'), true);
assert.equal(ANALYTICS_USE_CASES.filter(item => item.primary).length, 9);
assert.equal(analyticsUseCaseLabel('review_recover'), 'Review & recover');
assert.equal(analyticsUseCaseShortLabel('review_recover'), 'Review');

assert.equal(normalizeAnalyticsTaskIntent('bugfix'), 'bugfix');
assert.equal(normalizeAnalyticsTaskIntent('BUG-FIX', 'auto'), 'auto');
assert.equal(normalizeAnalyticsTaskIntent('', 'untracked'), 'untracked');
assert.equal(analyticsTaskIntentLabel('bugfix'), 'Bug fixes');
assert.equal(analyticsTaskIntentLabel('auto'), 'Unclassified');
assert.equal(analyticsTaskIntentLabel('untracked'), 'Untracked');

console.log('Analytics taxonomy contracts passed.');
