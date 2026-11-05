import assert from "node:assert/strict"
import test from "node:test"
import { parseRemoteUrl, parseTarget, summarizeChecks } from "../status.js"

test("parseTarget accepts a pull request URL", () => {
  assert.deepEqual(parseTarget("https://github.com/acme/app/pull/123"), {
    url: "https://github.com/acme/app/pull/123",
    owner: "acme",
    repo: "app",
    number: 123,
  })
})

test("parseTarget accepts owner/repo#number", () => {
  assert.deepEqual(parseTarget("acme/app#456"), {
    url: "https://github.com/acme/app/pull/456",
    owner: "acme",
    repo: "app",
    number: 456,
  })
})

test("parseTarget rejects anything else", () => {
  assert.equal(parseTarget("#123"), undefined)
  assert.equal(parseTarget("https://gitlab.com/acme/app/-/merge_requests/1"), undefined)
  assert.equal(parseTarget(""), undefined)
})

test("parseRemoteUrl handles the usual git remotes", () => {
  assert.equal(parseRemoteUrl("git@github.com:acme/app.git"), "acme/app")
  assert.equal(parseRemoteUrl("ssh://git@github.com/acme/app.git"), "acme/app")
  assert.equal(parseRemoteUrl("https://github.com/acme/app.git"), "acme/app")
  assert.equal(parseRemoteUrl("https://github.com/acme/my.repo"), "acme/my.repo")
  assert.equal(parseRemoteUrl("https://gitlab.com/acme/app.git"), "acme/app")
  assert.equal(parseRemoteUrl(""), "")
})

test("summarizeChecks counts failing and pending checks", () => {
  assert.deepEqual(
    summarizeChecks([
      { conclusion: "SUCCESS", status: "COMPLETED" },
      { conclusion: "FAILURE", status: "COMPLETED" },
      { status: "IN_PROGRESS" },
    ]),
    { checks: "failing", failing: 1, pending: 1 },
  )

  assert.deepEqual(summarizeChecks([{ status: "QUEUED" }]), {
    checks: "pending",
    failing: 0,
    pending: 1,
  })

  assert.deepEqual(summarizeChecks([{ conclusion: "SUCCESS" }]), {
    checks: "passing",
    failing: 0,
    pending: 0,
  })

  assert.deepEqual(summarizeChecks([]), { checks: "none", failing: 0, pending: 0 })
})
