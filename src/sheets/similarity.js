// Classic Levenshtein edit distance between two strings.
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Flags pairs of names close enough to plausibly be the same person
// mis-typed, without merging them — that decision stays with a human via
// the Name Aliases tab. Threshold scales gently with name length so short
// names need near-exact matches while longer ones tolerate a couple of
// character slips (e.g. "Josh Chung" vs "Joshua Chung").
export function findPossibleDuplicates(names) {
  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
      const threshold = Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
      if (distance > 0 && distance <= threshold) {
        pairs.push({ a, b, distance });
      }
    }
  }
  return pairs;
}
