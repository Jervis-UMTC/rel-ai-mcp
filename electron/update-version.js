import semver from 'semver';

function parseStableVersion(value) {
  const version = String(value || '').trim();
  const parsed = semver.parse(version);
  if (!parsed || parsed.version !== version || parsed.prerelease.length > 0) return null;
  return [parsed.major, parsed.minor, parsed.patch];
}

function isStableVersion(value) {
  return Boolean(parseStableVersion(value));
}

function compareVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return Number.NaN;
  return semver.compare(leftParts.join('.'), rightParts.join('.'));
}

export { compareVersions, isStableVersion, parseStableVersion };
