import { For, Show, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import type { OpenCodeClient } from "@opencode/client/promise"
import { Command, Panel, Plugin, Store, TitlebarItem } from "@opencode/plugin/gui"
import { PrPill } from "./rpc.js"

type Pr = {
  repo: string
  watched: boolean
  number: number
  title: string
  url: string
  state: string
  draft: boolean
  mergeable: string
  reviewDecision: string
  checks: string
  failing: number
  pending: number
  unresolved: number
}

type Status = {
  repo: string
  branch: string
  scope: string
  prs: Pr[]
  missing: string[]
}

type Cached = Status & { at: number; watchedKey: string }

type Session = {
  key: string
  id: string
  directory: string
  server: { client: OpenCodeClient }
}

type WatchTarget = {
  url: string
  number: number
  repo: string
}

const TTL_MS = 60_000
const GREEN = "#30a46c"
const AMBER = "#f5a623"
const RED = "#e5484d"
const GRAY = "#8b8d98"
const URL_RE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i
const SHORT_RE = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/
const NUMBER_RE = /^#?(\d+)$/

const Watch = Schema.Struct({ targets: Schema.Array(Schema.String) })

/** A stable key for a watch list, so a cached status only answers for the targets it fetched. */
function watchKey(targets: string[]): string {
  return [...targets].sort().join("\n")
}

function parseWatch(value: string | undefined, repo: string | undefined): WatchTarget | undefined {
  if (!value) return undefined
  const text = value.trim()
  const url = URL_RE.exec(text)
  if (url) {
    return {
      url: `https://github.com/${url[1]}/${url[2]}/pull/${url[3]}`,
      number: Number(url[3]),
      repo: `${url[1]}/${url[2]}`,
    }
  }
  const short = SHORT_RE.exec(text)
  if (short) {
    return {
      url: `https://github.com/${short[1]}/${short[2]}/pull/${short[3]}`,
      number: Number(short[3]),
      repo: `${short[1]}/${short[2]}`,
    }
  }
  const number = NUMBER_RE.exec(text)
  if (number && repo) {
    return {
      url: `https://github.com/${repo}/pull/${number[1]}`,
      number: Number(number[1]),
      repo,
    }
  }
  return undefined
}

function canonicalUrl(value: string | undefined, repo: string | undefined): string | undefined {
  return parseWatch(value, repo)?.url
}

function dotColor(pr: Pr | undefined): string {
  if (!pr) return GRAY
  if (
    pr.checks === "failing" ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.mergeable === "CONFLICTING"
  ) {
    return RED
  }
  if (pr.checks === "pending" || pr.unresolved > 0) return AMBER
  if (pr.checks === "passing") return GREEN
  return GRAY
}

function detailFor(pr: Pr): string {
  const parts: string[] = []
  if (pr.checks === "failing") parts.push(`${pr.failing} failing`)
  else if (pr.checks === "pending") parts.push(`${pr.pending} running`)
  else if (pr.checks === "passing") parts.push("CI passing")
  else parts.push("no checks")

  if (pr.unresolved > 0) parts.push(`${pr.unresolved} unresolved`)
  if (pr.reviewDecision === "CHANGES_REQUESTED") parts.push("changes requested")
  else if (pr.reviewDecision === "APPROVED") parts.push("approved")
  if (pr.mergeable === "CONFLICTING") parts.push("conflicts")
  if (pr.draft) parts.push("draft")
  if (pr.state && pr.state !== "OPEN") parts.push(pr.state.toLowerCase())
  return parts.join(" · ")
}

function PrsPanel(props: {
  panel: { session: Session }
  cache: Record<string, Cached | undefined>
  busy: Record<string, boolean | undefined>
  loading: (session: Session) => boolean
  requested: Record<string, boolean | undefined>
  refresh: (session: Session, force?: boolean) => Promise<void>
  add: (session: Session) => Promise<void>
  remove: (session: Session, url: string) => void
  monitor: (session: Session, url: string) => Promise<void>
  open: (url: string) => void
  t: (key: string) => string
}) {
  const requestKey = (url: string) => `${props.panel.session.key}\n${url}`
  const requested = (url: string) => !!props.requested[requestKey(url)]
  const directory = () => props.panel.session.directory
  const entry = () => props.cache[props.panel.session.key]
  const watched = () => (entry()?.prs ?? []).filter((pr) => pr.watched).length

  createEffect(() => {
    void directory()
    void props.refresh(props.panel.session)
  })

  return (
    <div
      style={{
        padding: "10px",
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
        "font-size": "12px",
        "overflow-y": "auto",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          gap: "8px",
        }}
      >
        <div style={{ "min-width": 0 }}>
          <div
            style={{
              "font-weight": 600,
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {entry()?.repo || "Watched pull requests"}
          </div>
          <div
            style={{
              opacity: 0.6,
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {(() => {
              const parts: string[] = []
              const current = entry()
              if (current?.branch) parts.push(current.branch)
              if (watched() > 0) parts.push(`${watched()} watched`)
              if (props.busy[props.panel.session.key]) parts.push("refreshing…")
              return parts.join(" · ")
            })()}
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px", "flex": "0 0 auto" }}>
          <button
            title={props.t("watch.add")}
            onClick={() => void props.add(props.panel.session)}
            style={{
              background: "transparent",
              color: "inherit",
              border: "1px solid rgba(127,127,127,0.3)",
              "border-radius": "5px",
              padding: "3px 8px",
              cursor: "pointer",
              "font-size": "12px",
              "line-height": 1,
            }}
          >
            +
          </button>
          <button
            onClick={() => void props.refresh(props.panel.session, true)}
            style={{
              background: "transparent",
              color: "inherit",
              border: "1px solid rgba(127,127,127,0.3)",
              "border-radius": "5px",
              padding: "3px 8px",
              cursor: "pointer",
              "font-size": "11px",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <Show
        when={entry()?.prs.length}
        fallback={
          <div style={{ opacity: 0.6 }}>
            <div>{props.loading(props.panel.session) ? "Loading pull requests…" : props.t("empty")}</div>
            <Show when={!props.loading(props.panel.session)}>
              <div style={{ "margin-top": "4px" }}>{props.t("empty.hint")}</div>
            </Show>
          </div>
        }
      >
        <For each={entry()!.prs}>
          {(pr) => (
            <div
              style={{
                display: "block",
                width: "100%",
                "text-align": "left",
                border: "1px solid rgba(127,127,127,0.25)",
                "border-radius": "6px",
                padding: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  "min-width": 0,
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    "border-radius": "50%",
                    background: dotColor(pr),
                    flex: "0 0 auto",
                  }}
                />
                <button
                  onClick={() => props.open(pr.url)}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                    "min-width": 0,
                    flex: 1,
                    background: "transparent",
                    color: "inherit",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                    "text-align": "left",
                  }}
                >
                  <span style={{ "font-weight": 600, flex: "0 0 auto" }}>
                    #{pr.number}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {pr.title}
                  </span>
                </button>
                <button
                  title={props.t("monitor.hint")}
                  disabled={requested(pr.url)}
                  onClick={() => void props.monitor(props.panel.session, pr.url)}
                  style={{
                    background: "transparent",
                    color: "inherit",
                    border: "1px solid rgba(127,127,127,0.3)",
                    "border-radius": "4px",
                    padding: "1px 6px",
                    cursor: requested(pr.url) ? "default" : "pointer",
                    opacity: requested(pr.url) ? 0.5 : 0.8,
                    "font-size": "10px",
                    "line-height": 1.4,
                    "flex": "0 0 auto",
                  }}
                >
                  {requested(pr.url) ? props.t("monitor.requested") : props.t("monitor.start")}
                </button>
                <Show when={pr.watched}>
                  <span
                    style={{
                      opacity: 0.55,
                      "font-size": "10px",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.04em",
                      "flex": "0 0 auto",
                    }}
                  >
                    {props.t("watch.badge")}
                  </span>
                  <button
                    title={props.t("watch.remove")}
                    onClick={() => props.remove(props.panel.session, pr.url)}
                    style={{
                      background: "transparent",
                      color: "inherit",
                      border: 0,
                      opacity: 0.55,
                      cursor: "pointer",
                      padding: "0 2px",
                      "font-size": "13px",
                      "line-height": 1,
                      "flex": "0 0 auto",
                    }}
                  >
                    ×
                  </button>
                </Show>
              </div>
              <div style={{ opacity: 0.65, "margin-top": "3px" }}>
                {pr.repo && entry()?.repo && pr.repo !== entry()!.repo ? `${pr.repo} · ` : ""}
                {detailFor(pr)}
              </div>
            </div>
          )}
        </For>
      </Show>

      <Show when={entry()?.missing.length}>
        <For each={entry()!.missing}>
          {(url) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                border: "1px solid rgba(229,72,77,0.35)",
                "border-radius": "6px",
                padding: "6px 8px",
                color: RED,
              }}
            >
              <span style={{ flex: 1, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis" }}>
                {props.t("watch.missing")}: {url}
              </span>
              {(() => {
                const match = URL_RE.exec(url)
                const target = match ? url : canonicalUrl(url, entry()?.repo)
                return target ? (
                  <button
                    title={props.t("watch.remove")}
                    onClick={() => props.remove(props.panel.session, target)}
                    style={{
                      background: "transparent",
                      color: "inherit",
                      border: 0,
                      cursor: "pointer",
                      "font-size": "13px",
                      "line-height": 1,
                    }}
                  >
                    ×
                  </button>
                ) : null
              })()}
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

export default Plugin.define({
  stores: { watch: Store.session(Watch, { targets: [] }) },
  i18n: {
    en: {
      "panel.title": "Pull requests",
      "watch.add": "Watch a pull request",
      "watch.title": "Watch a pull request",
      "watch.description": "Paste a GitHub pull request URL, or owner/repo#number.",
      "watch.placeholder": "https://github.com/owner/repo/pull/123",
      "watch.submit": "Watch",
      "watch.invalid.title": "Not a pull request",
      "watch.invalid.description": "Use a GitHub pull request URL, or owner/repo#number.",
      "watch.remove": "Stop watching",
      "watch.badge": "watched",
      "watch.missing": "Could not load",
      "monitor.start": "Monitor",
      "monitor.requested": "Requested",
      "monitor.title": "Work this pull request?",
      "monitor.hint": "Ask this session to monitor and fix the PR",
      "monitor.description":
        "Send this session a message to work {{url}} until it is ready. It may push commits. The request queues behind the current turn.",
      "monitor.confirm": "Start",
      "monitor.prompt":
        "Work this pull request to ready: {{url}}. If the `pr_monitor` tool is available, start it with action \"start\" and continue until the PR is ready. Otherwise, check CI, fix failing checks, resolve review threads (reply with the required prefix), push, and report what remains. This request came from the PR sidebar.",
      "monitor.error.title": "Could not start the monitor",
      empty: "No open pull request for this branch.",
      "empty.hint": "Use + to watch any pull request.",
    },
  },
  setup(ctx) {
    const [cache, setCache] = createStore<Record<string, Cached | undefined>>({})
    const [busy, setBusy] = createStore<Record<string, boolean | undefined>>({})
    const [requested, setRequested] = createStore<Record<string, boolean | undefined>>({})
    const inflight = new Set<string>()
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const later = (run: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id)
        run()
      }, ms)
      timers.add(id)
    }

    const requestKey = (session: Session, url: string) => `${session.key}\n${url}`

    const storeOf = (session: Session) => ctx.stores.watch(session)
    const targetsOf = (session: Session) => storeOf(session).value?.targets ?? []

    /**
     * Fetches status for one session. A session store loads over IPC, so wait for it: a fetch started
     * with an empty watch list would cache a status that omits the watched PRs.
     */
    const refresh = async (session: Session, force = false, override?: string[]) => {
      const key = session.key
      const store = storeOf(session)

      if (override === undefined && (!store.ready() || store.value === undefined)) return

      const targets = override ?? store.value?.targets ?? []
      const watchedKey = watchKey(targets)
      const current = cache[key]

      if (!force && current && current.watchedKey === watchedKey && Date.now() - current.at < TTL_MS) return
      if (inflight.has(key)) return

      inflight.add(key)
      setBusy(key, true)

      try {
        const result = (await ctx.client.rpc(PrPill).status({
          directory: session.directory,
          watch: targets,
        })) as Status

        // A watch added or removed while this ran makes the answer incomplete: drop it and fetch again.
        if (override === undefined && watchKey(targetsOf(session)) !== watchedKey) return

        if (result && Array.isArray(result.prs)) {
          setCache(key, { ...result, missing: result.missing ?? [], watchedKey, at: Date.now() })
        } else {
          setCache(key, { repo: "", branch: "", scope: "branch", prs: [], missing: [], watchedKey, at: Date.now() })
        }
      } catch {
        if (override === undefined && watchKey(targetsOf(session)) !== watchedKey) return

        setCache(key, { repo: "", branch: "", scope: "branch", prs: [], missing: [], watchedKey, at: Date.now() })
      } finally {
        inflight.delete(key)
        setBusy(key, false)

        if (override === undefined && watchKey(targetsOf(session)) !== watchedKey) void refresh(session, true)
      }
    }

    const add = async (session: Session) => {
      const current = cache[session.key]
      const value = await ctx.dialogs.prompt({
        title: ctx.t("watch.title"),
        description: ctx.t("watch.description"),
        placeholder: ctx.t("watch.placeholder"),
        submit: ctx.t("watch.submit"),
      })
      if (!value) return

      const target = parseWatch(value, current?.repo)
      if (!target) {
        await ctx.dialogs.alert({
          title: ctx.t("watch.invalid.title"),
          description: ctx.t("watch.invalid.description"),
        })
        return
      }

      const next = [...targetsOf(session).filter((item) => item !== target.url), target.url]
      storeOf(session).update((draft) => {
        if (!draft.targets.includes(target.url)) draft.targets.push(target.url)
      })

      // Show the row at once; the fetch replaces the placeholder with the real title and status.
      const previous = cache[session.key]
      setCache(session.key, {
        repo: previous?.repo ?? target.repo,
        branch: previous?.branch ?? "",
        scope: previous?.scope ?? "branch",
        prs: [
          ...(previous?.prs ?? []).filter((pr) => pr.url !== target.url),
          {
            repo: target.repo,
            watched: true,
            number: target.number,
            title: "Loading…",
            url: target.url,
            state: "OPEN",
            draft: false,
            mergeable: "",
            reviewDecision: "",
            checks: "none",
            failing: 0,
            pending: 0,
            unresolved: 0,
          },
        ],
        missing: (previous?.missing ?? []).filter((item) => item !== target.url),
        watchedKey: watchKey(next),
        at: 0,
      })

      await refresh(session, true, next)
    }

    const remove = (session: Session, url: string) => {
      const next = targetsOf(session).filter((target) => target !== url)
      storeOf(session).update((draft) => {
        draft.targets = draft.targets.filter((target) => target !== url)
      })

      const current = cache[session.key]
      if (current) {
        setCache(session.key, {
          ...current,
          prs: current.prs.filter((pr) => pr.url !== url),
          missing: current.missing.filter((item) => item !== url),
          watchedKey: watchKey(next),
          at: 0,
        })
      }

      void refresh(session, true, next)
    }

    const monitor = async (session: Session, url: string) => {
      const key = requestKey(session, url)
      if (requested[key]) return

      setRequested(key, true)

      const confirmed = await ctx.dialogs.confirm({
        title: ctx.t("monitor.title"),
        description: ctx.t("monitor.description", { url }),
        confirm: ctx.t("monitor.confirm"),
      })

      if (!confirmed) {
        setRequested(key, false)
        return
      }

      try {
        const client = session.server?.client ?? ctx.client

        await client.session.prompt({
          sessionID: session.id,
          text: ctx.t("monitor.prompt", { url }),
          delivery: "queue",
        })

        // Let the row be retried if the agent could not start a monitor.
        later(() => setRequested(key, false), 5 * 60_000)
      } catch (error) {
        setRequested(key, false)
        await ctx.dialogs.alert({
          title: ctx.t("monitor.error.title"),
          description: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const timer = setInterval(() => {
      const session = ctx.sessions.current()
      if (session) void refresh(session)
    }, TTL_MS)

    createEffect(() => {
      const session = ctx.sessions.current()
      if (!session) return

      // Track the session store so this reruns when its persisted watch list finishes loading.
      const store = storeOf(session)
      void store.ready()
      void store.value?.targets
      void refresh(session)
    })

    let tab: object | undefined
    const tabFor = () => {
      tab ??= {
        id: "prs",
        get title() {
          return ctx.t("panel.title")
        },
        pinned: true,
        label: (state: { session: Session }) => {
          const entry = cache[state.session.key]
          const pr = entry?.prs[0]
          const extra = entry && entry.prs.length > 1 ? ` +${entry.prs.length - 1}` : ""
          return (
            <span
              style={{
                display: "inline-flex",
                "align-items": "center",
                gap: "5px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  background: dotColor(pr),
                }}
              />
              <span>{pr ? `#${pr.number}${extra}` : "PRs"}</span>
            </span>
          )
        },
      }
      return tab
    }

    ctx.add(Command, {
      id: "prs",
      get title() {
        return ctx.t("panel.title")
      },
      group: "Pull requests",
      keywords: "pull request pr review checks ci",
      run: () => {
        const session = ctx.sessions.current()
        if (session) ctx.layout.open(`${ctx.id}:prs`, session)
      },
    })

    ctx.add(Command, {
      id: "watch",
      get title() {
        return ctx.t("watch.add")
      },
      group: "Pull requests",
      keywords: "watch pull request pr add follow",
      run: async () => {
        const session = ctx.sessions.current()
        if (!session) return
        await add(session)
      },
    })

    ctx.add(TitlebarItem, () => {
      const session = ctx.sessions.current()
      const entry = session ? cache[session.key] : undefined
      const pr = entry?.prs[0]
      if (!pr) return undefined
      const extra = entry!.prs.length > 1 ? ` +${entry!.prs.length - 1}` : ""
      return {
        id: "prs",
        label: `#${pr.number}${extra}`,
        title: ctx.t("panel.title"),
        icon: "github",
        run: () => {
          const current = ctx.sessions.current()
          if (current) ctx.layout.open(`${ctx.id}:prs`, current)
        },
      }
    })

    ctx.add(Panel, {
      id: "prs",
      region: "side",
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 45,
        kind: "menu",
        icon: "github",
      },
      list: (input) => {
        const entry = cache[input.session.key]
        const watches = ctx.stores.watch(input.session).value?.targets.length ?? 0

        if ((entry && entry.prs.length > 0) || watches > 0 || input.open.includes("prs")) return [tabFor()]

        return []
      },
      render: (props) => (
        <PrsPanel
          panel={props}
          cache={cache}
          busy={busy}
          loading={(session) => !storeOf(session).ready() || !!busy[session.key]}
          requested={requested}
          refresh={refresh}
          add={add}
          remove={remove}
          monitor={monitor}
          open={(url) => ctx.system.openExternal(url)}
          t={(key) => ctx.t(key)}
        />
      ),
    })

    return () => {
      clearInterval(timer)
      for (const id of timers) clearTimeout(id)
      timers.clear()
    }
  },
})
