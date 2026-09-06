// Incremental TypeScript migration boundary: production .ts modules are strict,
// while still-unmigrated .js dependencies remain explicitly untyped until their
// owning migration converts them or provides declarations.
declare module '*.js';
