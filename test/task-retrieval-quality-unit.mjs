import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rankBootstrapGroups } from '../src/context/taskContinuity.js';
import { getTaskHistoryDir, readRelevantTaskEpisodes } from '../src/taskHistoryStore.ts';
import { writeSession } from '../src/taskHistoryStorage.ts';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-retrieval-quality-'));
const config = { stateDir: temp, auditLogPath: path.join(temp, 'audit.jsonl') };
const historyDir = getTaskHistoryDir(config);
const base = Date.parse('2026-09-01T00:00:00.000Z');

function completed(id, values = {}) {
  return {
    id,
    taskId: id,
    sessionId: id,
    version: 3,
    workspace: 'repo',
    title: id,
    objective: id,
    resultSummary: `Completed ${id}.`,
    status: 'completed',
    completionKnown: true,
    validation: 'passed',
    startedAt: new Date(base).toISOString(),
    updatedAt: new Date(base).toISOString(),
    completedAt: new Date(base).toISOString(),
    ...values
  };
}

try {
  writeSession(historyDir, completed('analytics-initial-render', {
    title: 'Overview analytics fails during initial mount',
    objective: 'Repair the overview analytics initial rendering failure',
    resultSummary: 'Fixed the analytics overview so its first mount renders data without requiring navigation.',
    changedFiles: [
      'src/ui/features/usage/react.js',
      ...Array.from({ length: 7 }, (_, index) => `src/ui/features/usage/${'nested-segment-'.repeat(20)}${index}.js`)
    ],
    updatedAt: new Date(base + 1_000).toISOString()
  }));
  writeSession(historyDir, completed('module-loader-error', {
    title: 'Repair browser module loader failure',
    objective: 'Fix production dashboard module resolution',
    resultSummary: 'Resolved ERR_MODULE_NOT_FOUND for QueryClient during dashboard startup.',
    changedFiles: ['src/ui/api.js'],
    updatedAt: new Date(base + 2_000).toISOString()
  }));
  writeSession(historyDir, completed('connector-timeout-recovery', {
    title: 'Secure connector timeout recovery',
    objective: 'Recover connector requests that exceed their deadline',
    resultSummary: 'Fixed connector timeout handling without changing unrelated connection behavior.',
    changedFiles: ['src/bridge/semanticSearch.js'],
    updatedAt: new Date(base + 3_000).toISOString()
  }));
  writeSession(historyDir, completed('deep-event-signature', {
    title: 'Repair production startup regression',
    objective: 'Restore production startup behavior',
    resultSummary: 'Restored startup behavior without unrelated changes.',
    changedFiles: ['src/runtime/startup.js'],
    events: [
      { eventId: 'deep-event-start', tool: 'relai_work', status: 'succeeded', summary: 'Started task.' },
      { eventId: 'deep-event-failure', tool: 'relai_exec', status: 'failed', summary: 'Command failed.', error: { code: 'UNIQUE_BOOTSTRAP_SENTINEL', message: 'Synthetic historical failure.' } }
    ],
    updatedAt: new Date(base + 3_500).toISOString()
  }));
  writeSession(historyDir, {
    ...completed('inactive-exact-words', {
      title: 'Analytics panel blank until switching tabs',
      objective: 'Analytics panel blank until switching tabs',
      resultSummary: 'This work was never explicitly completed.',
      updatedAt: new Date(base + 4_000).toISOString()
    }),
    status: 'inactive',
    completionKnown: false,
    completedAt: null
  });

  for (let index = 0; index < 100; index += 1) {
    writeSession(historyDir, completed(`newer-unrelated-${String(index).padStart(3, '0')}`, {
      title: `Update unrelated workspace preference ${index}`,
      objective: `Adjust unrelated settings preference number ${index}`,
      resultSummary: `Updated an unrelated preference safely for case ${index}.`,
      changedFiles: [`src/settings/preference-${index}.js`],
      updatedAt: new Date(base + 10_000 + index * 1_000).toISOString()
    }));
  }
  writeSession(historyDir, completed('lexical-distractor', {
    title: 'Polish analytics tab switch animation',
    objective: 'Improve analytics panel tab switching animation and styling',
    resultSummary: 'Updated the visual transition only; data loading behavior was unchanged.',
    changedFiles: ['src/ui/features/usage/styles.css'],
    updatedAt: new Date(base + 200_000).toISOString()
  }));

  const cases = [
    {
      query: 'The analytics panel is blank until I switch tabs',
      expected: 'analytics-initial-render'
    },
    {
      query: 'Dashboard startup fails with ERR_MODULE_NOT_FOUND for QueryClient',
      expected: 'module-loader-error'
    },
    {
      query: 'Initial display is broken in src/ui/features/usage/react.js',
      expected: 'analytics-initial-render'
    },
    {
      query: 'Blank content in src/ui/features/usage/metrics-loader.js',
      expected: 'analytics-initial-render'
    },
    {
      query: 'Connector request keeps hitting its timeout deadline',
      expected: 'connector-timeout-recovery'
    },
    {
      query: 'Investigate UNIQUE_BOOTSTRAP_SENTINEL',
      expected: 'deep-event-signature'
    }
  ];

  let top1 = 0;
  let top3 = 0;
  for (const item of cases) {
    const results = readRelevantTaskEpisodes(config, 'repo', item.query, { limit: 3 });
    const goals = results.map(result => result.goal || '');
    const expectedIndex = goals.findIndex(goal => {
      if (item.expected === 'analytics-initial-render') return /overview analytics/i.test(goal);
      if (item.expected === 'module-loader-error') return /production dashboard module resolution/i.test(goal);
      if (item.expected === 'deep-event-signature') return /production startup behavior/i.test(goal);
      return /connector requests that exceed/i.test(goal);
    });
    if (expectedIndex === 0) top1 += 1;
    if (expectedIndex >= 0 && expectedIndex < 3) top3 += 1;
    assert.notEqual(expectedIndex, -1, `expected ${item.expected} in top 3 for: ${item.query}`);
  }

  assert.equal(top1, cases.length, 'adversarial retrieval fixtures should rank the correct completed task first');
  assert.equal(top3, cases.length, 'adversarial retrieval fixtures should always contain the correct task in the top three');

  const paraphrase = readRelevantTaskEpisodes(config, 'repo', 'The analytics panel is blank until I switch tabs', { limit: 3 });
  assert.match(paraphrase[0]?.goal || '', /overview analytics/i, 'same underlying task must survive substantially different wording');
  assert.equal(paraphrase.some(item => /animation/i.test(item.goal || '')), false, 'shared navigation vocabulary must not outrank the matching failure symptom');
  assert.equal(paraphrase.some(item => /blank until switching tabs/i.test(item.goal || '')), false, 'inactive work must not be presented as a proven completed solution');
  assert(['medium', 'strong'].includes(paraphrase[0]?.matchStrength), 'paraphrase retrieval should have at least medium confidence');
  assert(paraphrase[0]?.confidence >= 0.4);
  assert(paraphrase[0]?.matchReasons?.some(reason => /shared intent/i.test(reason)));
  assert((paraphrase[0]?.changes || []).length <= 6, 'retrieved task context must keep changed-file evidence bounded');
  assert((paraphrase[0]?.changes || []).every(file => file.length <= 160), 'retrieved task paths must be compact enough for bootstrap context');
  assert.equal(rankBootstrapGroups('analytics blank first render', { relatedTasks: [paraphrase[0]] }, 4096).relatedTasks?.length, 1,
    'the strongest real historical task should fit the normal bootstrap budget even when the stored task changed many long paths');

  const oldMatch = readRelevantTaskEpisodes(config, 'repo', 'Overview analytics initial rendering failure', { limit: 3 });
  assert.match(oldMatch[0]?.goal || '', /overview analytics/i, 'a correct task older than 80 newer same-workspace tasks must remain retrievable');

  const renamedFile = readRelevantTaskEpisodes(config, 'repo', 'Blank content in src/ui/features/usage/metrics-loader.js', { limit: 3 });
  assert.match(renamedFile[0]?.goal || '', /overview analytics/i, 'same-subsystem evidence must survive a renamed or different file in the same feature area');
  assert(renamedFile[0]?.matchReasons?.some(reason => /same area/i.test(reason)), 'same-subsystem retrieval should explain the matching directory evidence');

  const deepEvent = readRelevantTaskEpisodes(config, 'repo', 'Investigate UNIQUE_BOOTSTRAP_SENTINEL', { limit: 3 });
  assert.match(deepEvent[0]?.goal || '', /production startup behavior/i, 'exact error or test evidence must remain searchable even when compact full-history summaries omit event arrays');
  assert(deepEvent[0]?.matchReasons?.some(reason => /same identifier/i.test(reason)), 'exact event evidence should explain the identifier match');

  const generic = readRelevantTaskEpisodes(config, 'repo', 'update analytics styling', { limit: 3 });
  assert.equal(generic.some(item => /overview analytics/i.test(item.goal || '')), false, 'one shared domain word must not create a false positive');

  for (const unrelatedQuery of [
    'Rename analytics tab label',
    'Optimize chart rendering performance',
    'Change analytics navigation route',
    'Add analytics navigation breadcrumb',
    'Change analytics empty-state copy',
    'Add keyboard navigation to analytics tabs'
  ]) {
    const unrelated = readRelevantTaskEpisodes(config, 'repo', unrelatedQuery, { limit: 3 });
    assert.equal(unrelated.some(item => /overview analytics/i.test(item.goal || '')), false,
      `presentation or optimization work must not retrieve the historical blank-render bug: ${unrelatedQuery}`);
  }

  const softerParaphrase = readRelevantTaskEpisodes(config, 'repo', 'Improve analytics initial load behavior', { limit: 3 });
  assert.match(softerParaphrase[0]?.goal || '', /overview analytics/i,
    'mode-aware ranking must still allow a softer paraphrase of the same initial-load problem');

  const reserved = rankBootstrapGroups('analytics blank first render', {
    suggestedSkills: [
      { name: 'analytics-review', reason: 'analytics '.repeat(45) },
      { name: 'render-review', reason: 'render '.repeat(45) }
    ],
    relatedTasks: [{
      goal: 'Overview analytics initial render',
      outcome: 'Fixed initial rendering.',
      confidence: 0.91,
      matchStrength: 'strong',
      matchReasons: ['same path: src/ui/features/usage/react.js']
    }]
  }, 700);
  assert.equal(reserved.relatedTasks?.length, 1, 'a strong historical task match must receive bootstrap budget before lower-value supplemental context');

  console.log(`Task retrieval quality: top1=${top1}/${cases.length}, top3=${top3}/${cases.length}; full 500-task retained history is eligible for ranking.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
