import { Rpc } from "@opencode/plugin/rpc"

const pr = {
  type: "object",
  properties: {
    repo: { type: "string" },
    watched: { type: "boolean" },
    number: { type: "integer" },
    title: { type: "string" },
    url: { type: "string" },
    state: { type: "string" },
    draft: { type: "boolean" },
    mergeable: { type: "string" },
    reviewDecision: { type: "string" },
    checks: { type: "string" },
    failing: { type: "integer" },
    pending: { type: "integer" },
    unresolved: { type: "integer" },
  },
  required: [
    "repo",
    "watched",
    "number",
    "title",
    "url",
    "state",
    "draft",
    "mergeable",
    "reviewDecision",
    "checks",
    "failing",
    "pending",
    "unresolved",
  ],
  additionalProperties: false,
}

export const PrPill = Rpc.define({
  id: "pr-pill",
  methods: {
    status: {
      input: {
        type: "object",
        properties: {
          directory: { type: "string" },
          scope: { type: "string" },
          watch: { type: "array", items: { type: "string" } },
        },
        required: ["directory"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          repo: { type: "string" },
          branch: { type: "string" },
          scope: { type: "string" },
          prs: { type: "array", items: pr },
          missing: { type: "array", items: { type: "string" } },
        },
        required: ["repo", "branch", "scope", "prs", "missing"],
        additionalProperties: false,
      },
      errors: {},
    },
  },
  events: {},
})
