export function detectConflict(localDraft, remoteDraft) {
  if (!remoteDraft) return { conflicted: false, keep: 'local', stash: null };
  if (localDraft.text === remoteDraft.text) {
    return { conflicted: false, keep: 'remote', stash: null };
  }
  if (remoteDraft.updatedAt > localDraft.updatedAt) {
    return { conflicted: true, keep: 'remote', stash: localDraft.text };
  }
  return { conflicted: true, keep: 'local', stash: remoteDraft.text };
}
