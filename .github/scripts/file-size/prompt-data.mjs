export function isPromptDataFile(repoPath) {
  const segments = repoPath.split('/');
  return segments[0] === 'shared' && segments[1] === 'prompt-base';
}
