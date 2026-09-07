import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * Pins the shape of the pull-request CI workflow. A workflow cannot be
 * verified from inside the pull request that adds it, so the facts it depends
 * on — the trigger and its path filter, the token permissions, that each check
 * is its own step inside site/ — are asserted here instead of being discovered
 * from a red (or misleadingly green) run. Assertions read the parsed workflow,
 * so reformatting the YAML is free but changing its meaning is not. The deploy
 * workflow is read here too, to pin that the two never fire each other's jobs.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const readSiteFile = (relativePath: string): string =>
  readFileSync(resolve(siteDir, relativePath), 'utf8')

const workflowSource = readSiteFile('../.github/workflows/ci.yml')
const deploySource = readSiteFile('../.github/workflows/deploy-pages.yml')
const packageJson: { scripts?: Record<string, string> } = JSON.parse(
  readSiteFile('package.json'),
)

interface Step {
  name?: string
  uses?: string
  run?: string
  'working-directory'?: string
}

interface Job {
  'runs-on'?: string
  defaults?: { run?: { 'working-directory'?: string } }
  steps?: Step[]
}

interface Workflow {
  on?: {
    push?: unknown
    pull_request?: { paths?: string[] }
    workflow_dispatch?: unknown
  }
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, Job>
}

const workflow: Workflow = parse(workflowSource)
const deployWorkflow: Workflow = parse(deploySource)
const jobs = workflow.jobs ?? {}
const checkJob = jobs.check

/** The directory a step runs in, falling back to the job-level default. */
const runsIn = (job: Job, step: Step): string | undefined =>
  step['working-directory'] ?? job.defaults?.run?.['working-directory']

const stepIndex = (job: Job | undefined, command: string): number =>
  job?.steps?.findIndex((step) => step.run === command) ?? -1

const stepRunning = (job: Job | undefined, command: string): Step | undefined =>
  job?.steps?.find((step) => step.run === command)

const stepNamed = (job: Job | undefined, name: string): Step | undefined =>
  job?.steps?.find((step) => step.name === name)

/*
 * The Lint step's command is read out of the workflow rather than written out
 * again here: CI hardens the bare `npm run lint` (see the step's comment), and
 * the tests below assert both what that hardening is and that it works.
 */
const lintRun = stepNamed(checkJob, 'Lint')?.run ?? ''

/** The command that checks the built asset against the file it came from. */
const comparePdfRun = 'cmp dist/resume.pdf ../resume.pdf'

describe('CI workflow triggers', () => {
  it('parses as YAML with exactly one job', () => {
    expect(Object.keys(jobs)).toEqual(['check'])
    expect(checkJob).toBeDefined()
  })

  it('runs on pull requests touching the site or the workflow', () => {
    expect(workflow.on?.pull_request?.paths).toContain('site/**')
    expect(workflow.on?.pull_request?.paths).toContain(
      '.github/workflows/ci.yml',
    )
  })

  it('runs on pull requests that only regenerate the PDF', () => {
    // The build copies the repo-root PDF into dist/, so a change to that file
    // alone still has to run the step that compares the two — without the
    // path, the pull request most likely to break the download is the one CI
    // stays silent on.
    expect(workflow.on?.pull_request?.paths).toContain('resume.pdf')
  })

  it('does not duplicate the deploy workflow, and vice versa', () => {
    // Neither workflow's triggers may fire the other's job: CI is for pull
    // requests only, the deploy is for pushes to main only.
    expect(workflow.on).not.toHaveProperty('push')
    expect(workflow.on).not.toHaveProperty('workflow_dispatch')
    expect(deployWorkflow.on).not.toHaveProperty('pull_request')
    expect(deployWorkflow.on).toHaveProperty('push')
  })
})

describe('CI workflow safety', () => {
  it('asks only to read the code', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('grants nothing a Pages deploy would need', () => {
    expect(workflow.permissions).not.toHaveProperty('pages')
    expect(workflow.permissions).not.toHaveProperty('id-token')
  })

  it('cancels superseded runs instead of queueing them', () => {
    expect(workflow.concurrency?.group).toBe('ci-${{ github.ref }}')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true)
  })
})

describe('CI check job', () => {
  it('checks out and sets up Node the same way the deploy does', () => {
    const uses = (checkJob?.steps ?? []).map((step) => step.uses)
    expect(uses).toContain('actions/checkout@v5')
    expect(uses).toContain('actions/setup-node@v5')
  })

  it('installs from the committed lockfile before checking anything', () => {
    const install = stepIndex(checkJob, 'npm ci')
    expect(install).toBeGreaterThanOrEqual(0)
    const checks = [lintRun, 'npm run typecheck', 'npm run build']
    for (const command of checks) {
      expect(stepIndex(checkJob, command), command).toBeGreaterThan(install)
    }
  })

  it('runs lint, type-check and build as separate steps inside site/', () => {
    // Separate steps so any one of them can fail the job on its own.
    const commands = ['npm ci', lintRun, 'npm run typecheck', 'npm run build']
    const steps = commands.map((command) => stepRunning(checkJob, command))
    for (const [index, step] of steps.entries()) {
      expect(step, commands[index]).toBeDefined()
      expect(runsIn(checkJob!, step!), commands[index]).toBe('site')
    }
    expect(new Set(steps).size).toBe(commands.length)
  })

  it('compares the emitted PDF with the repo-root one after building', () => {
    // The plugin behind the download button is unit-tested against stand-in
    // Vite objects, so this step is the only check on what the real build
    // emits. It has to run after the build that produces dist/, and inside
    // site/ for both of its relative paths to point where they should.
    const compare = stepRunning(checkJob, comparePdfRun)
    expect(compare).toBeDefined()
    expect(runsIn(checkJob!, compare!)).toBe('site')
    expect(stepIndex(checkJob, comparePdfRun)).toBeGreaterThan(
      stepIndex(checkJob, 'npm run build'),
    )
  })

  it('leaves the vitest suite to a separate change', () => {
    const runs = (checkJob?.steps ?? []).map((step) => step.run ?? '')
    for (const run of runs) {
      expect(run).not.toMatch(/\b(npm test|npm run test|vitest)\b/)
    }
  })

  it('only invokes npm scripts that site/package.json defines', () => {
    const scripts = Object.keys(packageJson.scripts ?? {})
    const invoked = [...workflowSource.matchAll(/npm run ([\w:-]+)/g)].map(
      (match) => match[1],
    )
    expect(invoked).not.toHaveLength(0)
    for (const script of invoked) {
      expect(scripts, `npm run ${script}`).toContain(script)
    }
  })

  it('lints with warnings promoted to failures', () => {
    // oxlint reports its default (correctness) rules at *warning* severity and
    // exits 0 when only warnings are present, so a bare `npm run lint` is a
    // gate that lets no-debugger, no-unused-vars and the rest straight
    // through. The step has to say otherwise for "any lint error fails the
    // check" to be true.
    expect(lintRun).toMatch(/^npm run lint\b/)
    expect(lintRun).toMatch(/--deny-warnings|--max-warnings[= ]?0/)
  })

  it('type-checks without emitting build output', () => {
    // `tsc -b` writes to disk unless told not to, which would leave the build
    // step type-checking against stale output.
    const typecheck = packageJson.scripts?.typecheck ?? ''
    expect(typecheck).toMatch(/\btsc\b.*\s-b\b/)
    expect(typecheck).toContain('--noEmit')
  })
})

/*
 * The static assertions above pin what the Lint step *says*. These run it, on
 * files written the way a contributor would write them, and check the exit
 * code a check run would actually see — the workflow cannot be exercised from
 * inside the pull request that changes it, and a lint gate that reports
 * problems while exiting 0 looks identical to a working one in the log.
 */
describe('CI lint step behaviour', () => {
  let fixtures: string

  /** Writes a fixture and returns its absolute path. */
  const fixture = (name: string, source: string): string => {
    const path = join(fixtures, name)
    writeFileSync(path, source, 'utf8')
    return path
  }

  /**
   * Runs the Lint step's own command from `site/`, with any extra paths
   * appended, and returns the exit code. Fixtures live outside the repository
   * so the project's own lint, type-check and build never see them.
   */
  const runLintStep = (...paths: string[]): number => {
    const [command, ...args] = lintRun.split(/\s+/)
    const { status } = spawnSync(command, [...args, ...paths], {
      cwd: siteDir,
      encoding: 'utf8',
    })
    return status ?? -1
  }

  beforeAll(() => {
    fixtures = mkdtempSync(join(tmpdir(), 'ci-lint-'))
  })

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  it('fails on warning-severity lint problems', { timeout: 60_000 }, () => {
    // Both of oxlint's default rules the reviewer's repro used, at the
    // severity oxlint gives them by default: warning. Nothing in
    // .oxlintrc.json promotes them, so only the step's flag can fail these —
    // and the same flag covers the rules the config itself sets to "warn".
    const path = fixture(
      'warns.tsx',
      [
        'export function warnHere(value: unknown) {',
        '  const unused = 1',
        '  debugger',
        '  return value == null',
        '}',
        '',
      ].join('\n'),
    )
    expect(runLintStep(path)).not.toBe(0)
  })

  it('fails on error-severity lint problems', { timeout: 60_000 }, () => {
    // react/rules-of-hooks is the one rule .oxlintrc.json promotes to error,
    // so this case already failed the bare script — asserted so a fix aimed
    // at warnings cannot quietly cost the errors.
    const path = fixture(
      'hooks.tsx',
      [
        "import { useState } from 'react'",
        '',
        'export function Conditional({ on }: { on: boolean }) {',
        '  if (on) {',
        '    const [count] = useState(0)',
        '    return count',
        '  }',
        '  return 0',
        '}',
        '',
      ].join('\n'),
    )
    expect(runLintStep(path)).not.toBe(0)
  })

  it('passes a file with no lint problems', { timeout: 60_000 }, () => {
    // The other half of a usable gate: denying warnings must not fail
    // everything, or the check carries no information.
    const path = fixture('clean.tsx', 'export const answer = 42\n')
    expect(runLintStep(path)).toBe(0)
  })

  it('passes on the current tree', { timeout: 60_000 }, () => {
    // The tree is warning-free today, so the hardened command is green here —
    // the check will not land already red on unrelated pull requests.
    expect(runLintStep()).toBe(0)
  })
})
