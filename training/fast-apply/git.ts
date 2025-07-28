import { spawn } from 'child_process';

/**
 * Async generator that yields commit SHAs one at a time using git plumbing commands.
 * Uses git rev-list --all to get all commits reachable from any ref.
 *
 * @param gitDir Optional path to git directory (defaults to current repo)
 * @returns Async generator yielding commit SHA hashes
 */
export async function* getAllCommits(gitDir?: string): AsyncGenerator<string> {
  const args = gitDir
    ? ['--git-dir', gitDir, 'rev-list', '--all']
    : ['rev-list', '--all'];

  const git = spawn('git', args);

  let buffer = '';

  for await (const chunk of git.stdout) {
    buffer += chunk.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep last partial line

    for (const sha of lines) {
      if (sha.trim()) yield sha.trim();
    }
  }

  if (buffer.trim()) yield buffer.trim();
}

/**
 * Async function to get commit details using git cat-file (plumbing command)
 *
 * @param commitSha The commit SHA to inspect
 * @param gitDir Optional path to git directory
 * @returns Promise resolving to raw commit object content
 */
export async function getCommitDetails(commitSha: string, gitDir?: string): Promise<string> {
  const args = gitDir
    ? ['--git-dir', gitDir, 'cat-file', '-p', commitSha]
    : ['cat-file', '-p', commitSha];

  const git = spawn('git', args);
  let output = '';

  for await (const chunk of git.stdout) {
    output += chunk.toString();
  }

  const errorOutput = new Promise<string>((resolve) => {
    let error = '';
    git.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    git.on('close', () => resolve(error));
  });

  const error = await errorOutput;
  if (error.trim()) {
    throw new Error(`git error: ${error.trim()}`);
  }

  return output;
}

/**
 * Async function to get diff between commit and its parent(s) using plumbing commands
 *
 * @param commitSha The commit SHA to diff
 * @param gitDir Optional path to git directory
 * @returns Promise resolving to raw diff output
 */
export async function getCommitDiff(commitSha: string, gitDir?: string): Promise<string> {
  // Get commit object first
  const commit = await getCommitDetails(commitSha, gitDir);

  // Extract tree SHA from commit object
  const treeLine = commit.split('\n').find(line => line.startsWith('tree'));
  const treeSha = treeLine?.split(' ')[1];

  if (!treeSha) return '';

  // Check for parents
  const parents = commit.split('\n')
    .filter(line => line.startsWith('parent'))
    .map(line => line.split(' ')[1]);

  let args = gitDir ? ['--git-dir', gitDir] : [];

  if (parents.length === 0) {
    // First commit - diff against empty tree
    args.push('diff-tree', '-p', '--root', treeSha);
  } else {
    // Regular commit - get parent's tree
    const parentCommit = await getCommitDetails(parents[0], gitDir);
    const parentTreeLine = parentCommit.split('\n').find(line => line.startsWith('tree'));
    const parentTreeSha = parentTreeLine?.split(' ')[1];

    if (!parentTreeSha) {
      return '';
    }

    args.push('diff-tree', '-p', parentTreeSha, treeSha);
  }

  const git = spawn('git', args);
  let output = '';

  for await (const chunk of git.stdout) {
    output += chunk.toString();
  }

  const errorOutput = new Promise<string>((resolve) => {
    let error = '';
    git.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    git.on('close', () => resolve(error));
  });

  const error = await errorOutput;
  if (error.trim()) {
    // For empty diffs and some special cases, git might write to stderr
    // but still have valid output - only throw if stdout is empty
    if (output.trim() === '') {
      throw new Error(`git error: ${error.trim()}`);
    }
  }

  return output;
}
/**
 * Get file contents before and after a specific commit
 *
 * @param filePath The path to the file relative to repository root
 * @param commitSha The commit SHA to check
 * @param gitDir Optional path to git directory
 * @returns Promise<[beforeContents, afterContents]> Tuple of file contents before and after the commit
 */
export async function getFileContentsBeforeAfter(filePath: string, commitSha: string, gitDir?: string): Promise<[string, string]> {
  // Check file exists at the commit
  const args = gitDir ? ['--git-dir', gitDir] : [];

  try {
    // Get file contents after the commit
    const after = await new Promise<string>((resolve, reject) => {
      const cmd = spawn('git', [...args, 'show', `${commitSha}:${filePath}`]);
      let output = '';
      let error = '';

      cmd.stdout.on('data', (chunk) => output += chunk.toString());
      cmd.stderr.on('data', (chunk) => error += chunk.toString());
      cmd.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`git show error: ${error}`));
        } else {
          resolve(output);
        }
      });
    });

    // Get file contents before the commit
    const before = await new Promise<string>((resolve, reject) => {
      const commit = spawn('git', [...args, 'cat-file', '-p', commitSha]);
      let commitData = '';

      commit.stdout.on('data', (chunk) => commitData += chunk.toString());
      commit.on('close', () => {
        const parents = commitData.split('\n')
          .filter(line => line.startsWith('parent'))
          .map(line => line.split(' ')[1]);

        if (parents.length === 0) {
          // First commit - file didn't exist before
          resolve('');
          return;
        }

        const cmd = spawn('git', [...args, 'show', `${parents[0]}:${filePath}`]);
        let output = '';
        let error = '';

        cmd.stdout.on('data', (chunk) => output += chunk.toString());
        cmd.stderr.on('data', (chunk) => error += chunk.toString());
        cmd.on('close', (code) => {
          if (code !== 0) {
            // File didn't exist before this commit
            resolve('');
          } else {
            resolve(output);
          }
        });
      });
    });

    return [before, after];
  } catch (error) {
    throw new Error(`Error reading file ${filePath}: ${error}`);
  }
}

// Example usage:
// const [before, after] = await getFileContentsBeforeAfter('src/main.js', 'abc123');
// console.log('Before:', before);
// console.log('After:', after);
