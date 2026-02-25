import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubCommit {
  id: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  files: string[];
}

export interface GitHubPR {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  author: string;
  merged_at: string | null;
  url: string;
}

export interface GitHubData {
  commits: GitHubCommit[];
  prs: GitHubPR[];
  readme: string;
  techStack: string[];
  extractedIntelligence: {
    features: string[];
    decisions: string[];
    performanceMentions: string[];
  };
  extractedAt: string;
}

// ─── Main fetch function ───────────────────────────────────────────────────────

export async function fetchGitHubData(repo: string): Promise<GitHubData> {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error('Repository must be in "owner/repo" format');
  }

  const [commits, prs, readme, techStack] = await Promise.all([
    fetchCommits(owner, repoName),
    fetchPullRequests(owner, repoName),
    fetchReadme(owner, repoName),
    extractTechStack(owner, repoName),
  ]);

  const extractedIntelligence = extractIntelligence(commits, prs);

  return {
    commits,
    prs,
    readme,
    techStack,
    extractedIntelligence,
    extractedAt: new Date().toISOString(),
  };
}

// ─── Fetch commits (last 7 days) ──────────────────────────────────────────────

async function fetchCommits(owner: string, repo: string): Promise<GitHubCommit[]> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data } = await octokit.repos.listCommits({
    owner,
    repo,
    since: since.toISOString(),
    per_page: 100,
  });

  return data.map((commit) => ({
    id: commit.sha,
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.commit.author?.name || 'Unknown',
    date: commit.commit.author?.date || new Date().toISOString(),
    url: commit.html_url,
    files: (commit as { files?: Array<{ filename: string }> }).files?.map((f) => f.filename) || [],
  }));
}

// ─── Fetch pull requests ──────────────────────────────────────────────────────

async function fetchPullRequests(owner: string, repo: string): Promise<GitHubPR[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [{ data: merged }, { data: open }] = await Promise.all([
    octokit.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    }),
    octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 50,
    }),
  ]);

  const allPRs = [...merged, ...open];

  return allPRs
    .filter((pr) => {
      if (pr.state === 'open') return true;
      return pr.merged_at && new Date(pr.merged_at) > sevenDaysAgo;
    })
    .map((pr) => ({
      id: `pr_${pr.number}`,
      number: pr.number,
      title: pr.title,
      description: pr.body || '',
      status: pr.merged_at ? 'merged' : pr.state,
      author: pr.user?.login || 'Unknown',
      merged_at: pr.merged_at ?? null,
      url: pr.html_url,
    }));
}

// ─── Fetch README ─────────────────────────────────────────────────────────────

async function fetchReadme(owner: string, repo: string): Promise<string> {
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo });
    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return '';
  } catch {
    console.log(`[GitHub] No README found for ${owner}/${repo}`);
    return '';
  }
}

// ─── Extract tech stack from package.json / requirements.txt ─────────────────

async function extractTechStack(owner: string, repo: string): Promise<string[]> {
  const techStack: string[] = [];

  // Try package.json
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: 'package.json' });
    if ('content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      techStack.push(...Object.keys(deps));
    }
  } catch {
    console.log(`[GitHub] No package.json found`);
  }

  // Try requirements.txt
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: 'requirements.txt' });
    if ('content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const packages = content
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => line.split('==')[0].split('>=')[0].split('<=')[0].trim());
      techStack.push(...packages);
    }
  } catch {
    console.log(`[GitHub] No requirements.txt found`);
  }

  // Try /docs folder
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: 'docs' });
    if (Array.isArray(data)) {
      console.log(`[GitHub] Found ${data.length} files in /docs`);
    }
  } catch {
    // No docs folder — fine
  }

  return Array.from(new Set(techStack)); // deduplicate
}

// ─── Extract intelligence from commits & PRs ──────────────────────────────────

interface ExtractedIntelligence {
  features: string[];
  decisions: string[];
  performanceMentions: string[];
}

function extractIntelligence(
  commits: GitHubCommit[],
  prs: GitHubPR[],
): ExtractedIntelligence {
  const features: string[] = [];
  const decisions: string[] = [];
  const performanceMentions: string[] = [];

  // Feature patterns: "Add X", "Implement X", "Build X"
  const featureRe = /^(add|implement|build|create|introduce)\s+(.+)/i;
  // Decision patterns in PR bodies
  const decisionRe =
    /(?:we decided to|going with|chose .+ because|decision:|we['']re using)\s+(.+?)(?:\.|$)/gi;
  // Performance patterns
  const perfRe =
    /(?:latency|performance|speed|slow|fast|optimi[sz]|ms|millisecond|seconds?)\b.{0,80}/gi;

  // Scan commit messages for features
  for (const commit of commits) {
    const firstLine = commit.message.split('\n')[0];
    const match = firstLine.match(featureRe);
    if (match) {
      features.push(firstLine);
    }
    const perfMatches = firstLine.match(perfRe);
    if (perfMatches) {
      performanceMentions.push(...perfMatches.map((m) => m.trim()));
    }
  }

  // Scan PR titles for features and PR bodies for decisions/performance
  for (const pr of prs) {
    const titleMatch = pr.title.match(featureRe);
    if (titleMatch) {
      features.push(pr.title);
    }

    // Decisions from PR body
    let decMatch: RegExpExecArray | null;
    while ((decMatch = decisionRe.exec(pr.description)) !== null) {
      decisions.push(decMatch[0].trim());
    }

    // Performance from PR body
    const perfBodyMatches = pr.description.match(perfRe);
    if (perfBodyMatches) {
      performanceMentions.push(...perfBodyMatches.map((m) => m.trim()));
    }
  }

  return {
    features: Array.from(new Set(features)).slice(0, 20),
    decisions: Array.from(new Set(decisions)).slice(0, 10),
    performanceMentions: Array.from(new Set(performanceMentions)).slice(0, 10),
  };
}
