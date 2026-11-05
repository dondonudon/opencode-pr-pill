import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { PrPill } from "./rpc.js"
import { collectStatus } from "./status.js"

const execFileAsync = promisify(execFile)

async function run(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

export default Plugin.define({
  id: "pr-pill",
  async setup(ctx) {
    await ctx.rpc.register(PrPill, {
      status: async (input, context) => {
        const { directory, scope, watch } = input
        try {
          return await collectStatus(directory, run, { scope, watch })
        } catch (error) {
          ctx.log?.write?.("warn", `pr-pill status failed: ${error}`)
          return { repo: "", branch: "", scope: "branch", prs: [], missing: [] }
        }
      },
    })
  },
})
