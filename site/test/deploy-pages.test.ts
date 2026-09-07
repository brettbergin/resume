import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

/*
 * Pins the shape of the Pages deploy workflow. A deploy only breaks once it
 * has already been pushed to `main`, so the facts it depends on — the trigger,
 * the token permissions, where the build runs, what gets uploaded — are
 * asserted here instead of being discovered from a red run. Assertions read
 * the parsed workflow, so reformatting the YAML is free but changing its
 * meaning is not.
 */

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = resolve(here, '..')

const readSiteFile = (relativePath: string): string =>
  readFileSync(resolve(siteDir, relativePath), 'utf8')

const workflowSource = readSiteFile('../.github/workflows/deploy-pages.yml')
const packageJson: { scripts?: Record<string, string> } = JSON.parse(
  readSiteFile('package.json'),
)

interface Step {
  uses?: string
  run?: string
  'working-directory'?: string
  with?: Record<string, unknown>
}

interface Job {
  needs?: string | string[]
  defaults?: { run?: { 'working-directory'?: string } }
  environment?: { name?: string; url?: string }
  steps?: Step[]
}

interface Workflow {
  on?: {
    push?: { branches?: string[]; paths?: string[] }
    workflow_dispatch?: unknown
  }
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, Job>
}

const workflow: Workflow = parse(workflowSource)
const jobs = workflow.jobs ?? {}
const buildJob = jobs.build
const deployJob = jobs.deploy

/** The directory a step runs in, falling back to the job-level default. */
const runsIn = (job: Job, step: Step): string | undefined =>
  step['working-directory'] ?? job.defaults?.run?.['working-directory']

const findStep = (job: Job | undefined, match: (step: Step) => boolean) =>
  job?.steps?.find(match)

describe('Pages deploy workflow triggers', () => {
  it('parses as YAML with both jobs', () => {
    expect(buildJob).toBeDefined()
    expect(deployJob).toBeDefined()
  })

  it('runs on pushes to main touching the site or the workflow', () => {
    expect(workflow.on?.push?.branches).toContain('main')
    expect(workflow.on?.push?.paths).toContain('site/**')
    expect(workflow.on?.push?.paths).toContain(
      '.github/workflows/deploy-pages.yml',
    )
  })

  it('can be re-run by hand', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })
})

describe('Pages deploy workflow safety', () => {
  it('grants exactly what a Pages deploy needs', () => {
    expect(workflow.permissions).toMatchObject({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    })
  })

  it('queues overlapping deploys instead of racing them', () => {
    expect(workflow.concurrency?.group).toBeTruthy()
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('Pages deploy build job', () => {
  it('installs from the committed lockfile inside site/', () => {
    const install = findStep(buildJob, (step) => step.run === 'npm ci')
    expect(install).toBeDefined()
    expect(runsIn(buildJob!, install!)).toBe('site')
  })

  it('runs the production build inside site/', () => {
    const build = findStep(buildJob, (step) => step.run === 'npm run build')
    expect(build).toBeDefined()
    expect(runsIn(buildJob!, build!)).toBe('site')
  })

  it('uploads site/dist as the Pages artifact', () => {
    const upload = findStep(buildJob, (step) =>
      step.uses?.startsWith('actions/upload-pages-artifact@') ?? false,
    )
    expect(upload).toBeDefined()
    expect(upload?.with?.path).toBe('site/dist')
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
})

describe('Pages deploy job', () => {
  it('waits for the build so a failed build never deploys', () => {
    const needs = deployJob?.needs
    expect(typeof needs === 'string' ? [needs] : needs).toContain('build')
  })

  it('deploys to the github-pages environment', () => {
    expect(deployJob?.environment?.name).toBe('github-pages')
  })

  it('deploys with actions/deploy-pages', () => {
    const deploy = findStep(deployJob, (step) =>
      step.uses?.startsWith('actions/deploy-pages@') ?? false,
    )
    expect(deploy).toBeDefined()
  })
})

describe('Pages base path', () => {
  it('builds assets under the project page path', () => {
    // Without this the deploy returns 200 and renders nothing: asset URLs
    // point at / instead of /resume/.
    expect(readSiteFile('vite.config.ts')).toMatch(/base:\s*'\/resume\/'/)
  })
})
