export function ancestry(commits, headId) {
  const byId = new Map(commits.map((c) => [c.id, c]));
  const chain = [];
  const seen = new Set();
  let current = byId.get(headId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function chaptersAt(commits, commitId) {
  const chain = ancestry(commits, commitId).reverse();
  const state = {};
  for (const commit of chain) {
    for (const [chapterId, snapshot] of Object.entries(commit.chapters)) {
      state[chapterId] = { ...snapshot };
    }
  }
  return state;
}

export function buildGraph(commits) {
  const sorted = [...commits].sort(
    (x, y) => y.createdAt - x.createdAt || x.id.localeCompare(y.id),
  );
  const lanes = new Map();
  const nodes = sorted.map((c, row) => {
    if (!lanes.has(c.versionId)) lanes.set(c.versionId, lanes.size);
    return {
      id: c.id,
      parentId: c.parentId,
      message: c.message,
      versionId: c.versionId,
      row,
      lane: lanes.get(c.versionId),
    };
  });
  return { nodes, laneCount: lanes.size };
}
