import { repositoryIntelligence } from '../repository/intelligence/service.js';
import { isTestPath } from '../repository/intelligence/languages.js';

async function relaiCodeInspect(workspace, config, args = {}, context = {}) {
  return repositoryIntelligence.codeInspect(workspace, config, args, { signal: context.signal, watch: context.watch });
}

export { relaiCodeInspect, isTestPath };
