interface BudgetPolicy {
  sessionActive?: boolean;
}

interface BudgetConfig {
  trustedBudgetMultiplier?: unknown;
}

function resolveBudget(baseValue: number, policy?: BudgetPolicy | null, config?: BudgetConfig | null): number {
  if (policy?.sessionActive !== true) return baseValue;
  const raw = Number(config?.trustedBudgetMultiplier);
  const multiplier = Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : 2;
  return Math.floor(baseValue * multiplier);
}

export { resolveBudget };
