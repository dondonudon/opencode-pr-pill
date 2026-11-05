const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "CANCELLED",
  "STARTUP_FAILURE",
  "ERROR",
])
const FAILING_STATES = new Set(["FAILURE", "ERROR"])
const PENDING_STATUSES = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "REQUESTED", "WAITING"])
const PENDING_STATES = new Set(["PENDING", "EXPECTED"])

const EMPTY = { repo: "", branch: "", scope: "branch", prs: [] }

const PR_FIELDS =
  "number,title,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup"

const REPO_TTL_MS = 5 * 60_000
const GH_TTL_MS = 20_000
const repoCache = new Map()
const ghCache = new Map()

/**
 * Short-lived memo for `gh` calls. A rejected load is not kept, and a load that resolves
 * `undefined` is treated as a failure so an outage is not cached.
 */
function cached(key, load) {
  const hit = ghCache.get(key)
  if (hit) {
    if (hit.promise) return hit.promise
    if (Date.now() - hit.at < GH_TTL_MS) return Promise.resolve(hit.value)
  }

  const promise = load().then(
    (value) => {
      if (value === undefined) ghCache.delete(key)
      else ghCache.set(key, { at: Date.now(), value })
      return value
    },
    (error) => {
      ghCache.delete(key)
      throw error
    },
  )

  ghCache.set(key, { promise })
  return promise
}

const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`

function str(value) {
  return typeof value === "string" ? value : ""
}

export function summarizeChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : []
  let failing = 0
  let pending = 0

  for (const check of list) {
    if (!check || typeof check !== "object") continue
    const conclusion = str(check.conclusion).toUpperCase()
    const state = str(check.state).toUpperCase()
    const status = str(check.status).toUpperCase()

    if (FAILING_CONCLUSIONS.has(conclusion) || FAILING_STATES.has(state)) {
      failing += 1
    } else if (PENDING_STATUSES.has(status) || PENDING_STATES.has(state)) {
      pending += 1
    }
  }

  const checks =
    failing > 0 ? "failing" : pending > 0 ? "pending" : list.length > 0 ? "passing" : "none"

  return { checks, failing, pending }
}

function unresolvedThreads(run, directory, owner, repo, number) {
  return cached(`threads:${owner}/${repo}#${number}`, async () => {
    try {
      const out = await run(
        "gh",
        [
          "api",
          "graphql",
          "-f",
          `query=${THREADS_QUERY}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `repo=${repo}`,
          "-F",
          `number=${number}`,
        ],
        directory,
      )
      const data = JSON.parse(out)
      const nodes = data?.data?.repository?.pullRequest?.reviewThreads?.nodes
      if (!Array.isArray(nodes)) return undefined
      return nodes.filter((node) => node && node.isResolved !== true).length
    } catch {
      return undefined
    }
  })
}

function canonicalUrl(item) {
  const parsed = parseTarget(str(item?.url))
  return parsed?.url ?? str(item?.url)
}

export function parseTarget(target) {
  if (typeof target !== "string") return undefined
  const value = target.trim()
  const url = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(value)
  if (url) {
    return {
      url: `https://github.com/${url[1]}/${url[2]}/pull/${url[3]}`,
      owner: url[1],
      repo: url[2],
      number: Number(url[3]),
    }
  }
  const short = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(value)
  if (short) {
    return {
      url: `https://github.com/${short[1]}/${short[2]}/pull/${short[3]}`,
      owner: short[1],
      repo: short[2],
      number: Number(short[3]),
    }
  }
  return undefined
}

async function toPr(run, directory, item, repoName, watched) {
  const summary = summarizeChecks(item?.statusCheckRollup)
  const [owner, repo] = repoName.split("/")
  let unresolved = -1
  if (owner && repo) {
    unresolved = (await unresolvedThreads(run, directory, owner, repo, item.number)) ?? -1
  }
  return {
    repo: repoName,
    watched,
    number: Number(item?.number) || 0,
    title: str(item?.title),
    url: canonicalUrl(item),
    state: str(item?.state),
    draft: item?.isDraft === true,
    mergeable: str(item?.mergeable),
    reviewDecision: str(item?.reviewDecision),
    checks: summary.checks,
    failing: summary.failing,
    pending: summary.pending,
    unresolved,
  }
}

async function listBranchPrs(run, directory, branch, scope) {
  const listed = await cached(`list:${directory}:${branch}:${scope}`, async () => {
    let listed
    try {
      const raw = await run(
        "gh",
        ["pr", "list", "--head", branch, "--state", "open", "--limit", "5", "--json", PR_FIELDS],
        directory,
      )
      listed = JSON.parse(raw)
    } catch {
      return undefined
    }

    if (scope === "repo" && (!Array.isArray(listed) || listed.length === 0)) {
      try {
        const raw = await run(
          "gh",
          ["pr", "list", "--state", "open", "--author", "@me", "--limit", "10", "--json", PR_FIELDS],
          directory,
        )
        listed = JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    return Array.isArray(listed) ? listed : undefined
  })

  return Array.isArray(listed) ? listed : []
}

function viewPr(run, directory, target) {
  return cached(`view:${target}`, async () => {
    const raw = await run("gh", ["pr", "view", target, "--json", PR_FIELDS], directory)
    const item = JSON.parse(raw)
    if (!item || typeof item !== "object") throw new Error("empty response")
    return item
  })
}

/**
 * Reads `owner/repo` from a git remote URL. Local, so it avoids a `gh` round trip.
 * Handles `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`, and https remotes.
 */
export function parseRemoteUrl(url) {
  const value = str(url).trim().replace(/\.git$/i, "")
  if (!value) return ""

  let match = /^[^@/\s]+@[^:/\s]+:([^/\s]+)\/(.+)$/.exec(value)
  if (match) return `${match[1]}/${match[2]}`

  match = /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?[^/\s]+\/([^/\s]+)\/(.+)$/i.exec(value)
  if (match) return `${match[1]}/${match[2]}`

  match = /^(?:[^@/\s]+@)?[^:/\s]+[:/]([^/\s]+)\/([^/\s]+)$/.exec(value)
  if (match) return `${match[1]}/${match[2]}`

  return ""
}

async function resolveRepo(directory, run) {
  const hit = repoCache.get(directory)
  if (hit && Date.now() - hit.at < REPO_TTL_MS) return hit.name

  let name = ""
  try {
    name = parseRemoteUrl(await run("git", ["-C", directory, "remote", "get-url", "origin"], directory))
  } catch {
    name = ""
  }

  if (!name) {
    try {
      const raw = await run("gh", ["repo", "view", "--json", "nameWithOwner"], directory)
      const value = JSON.parse(raw)?.nameWithOwner
      if (typeof value === "string" && value.includes("/")) name = value
    } catch {
      name = ""
    }
  }

  if (name) repoCache.set(directory, { name, at: Date.now() })
  return name
}

export async function collectStatus(directory, run, options = {}) {
  const scope = options.scope === "repo" ? "repo" : "branch"
  const wanted = Array.isArray(options.watch) ? options.watch : []
  const parsed = []
  const missing = []

  for (const target of wanted) {
    const result = parseTarget(target)
    if (result) parsed.push(result)
    else missing.push(str(target))
  }

  if (typeof directory !== "string" || directory.length === 0) {
    return { ...EMPTY, scope, missing }
  }

  let branch = ""
  try {
    branch = (await run("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], directory)).trim()
  } catch {
    branch = ""
  }
  if (branch === "HEAD") branch = ""

  // Branch listing, watched PRs and repo resolution are independent: run them together.
  // `gh pr list` does not need the repo name, so nothing waits on the local remote lookup.
  const [nameWithOwner, branchList, watchedResults] = await Promise.all([
    branch ? resolveRepo(directory, run) : Promise.resolve(""),
    branch ? listBranchPrs(run, directory, branch, scope) : Promise.resolve([]),
    Promise.all(
      parsed.map(async (target) => {
        try {
          return { target, item: await viewPr(run, directory, target.url) }
        } catch {
          return { target, item: undefined }
        }
      }),
    ),
  ])

  const watchedUrls = new Set(parsed.map((item) => item.url))
  const seen = new Set()
  const tasks = []

  for (const item of branchList) {
    const url = canonicalUrl(item)
    if (seen.has(url)) continue
    seen.add(url)
    tasks.push(toPr(run, directory, item, nameWithOwner, watchedUrls.has(url)))
  }

  for (const result of watchedResults) {
    if (seen.has(result.target.url)) continue
    seen.add(result.target.url)
    if (!result.item) {
      missing.push(result.target.url)
      continue
    }
    const repoName = `${result.target.owner}/${result.target.repo}`
    tasks.push(toPr(run, directory, result.item, repoName, true))
  }

  const prs = await Promise.all(tasks)

  return { repo: nameWithOwner, branch, scope, prs, missing }
}
