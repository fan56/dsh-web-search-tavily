// Regression for dsh-subagent-registry#10: pnpm 11 enables strictDepBuilds by
// default and refuses an install whose dependency carries an unapproved
// preinstall/install/postinstall script (ERR_PNPM_IGNORED_BUILDS), so the dsh
// host plugin manager rolls the update back. This test pins the npm packaged
// upgrade path for this plugin: install the published baseline from the
// official registry, pack the repo, then upgrade that consumer to the locally
// packed tarball and assert the package carries no install hook, still ships
// its bundle patch and entry, and leaves the consumer tree alone.
// Run: node test/packaged-upgrade.test.mjs  (after `npm run build`; needs
// network access to registry.npmjs.org for the baseline install)
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..')
// Windows needs cmd.exe to launch npm's .cmd shim; keep paths as separate arguments.
const npm = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
const npmArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : []
const registry = 'https://registry.npmjs.org'
const installHooks = ['preinstall', 'install', 'postinstall']

const repoManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const pkgName = repoManifest.name
// Hardcoded instead of read from the repo manifest: a version bump must keep
// exercising a real registry -> newer-local upgrade rather than silently
// installing the tarball over itself.
const baselineVersion = '0.7.0'

if (!existsSync(join(repoRoot, 'lib', 'index.js'))) {
  throw new Error('lib/index.js missing — run `npm run build` before the test chain')
}

const scratch = mkdtempSync(join(tmpdir(), 'web-search-tavily packaged upgrade-'))
try {
  const consumer = join(scratch, 'consumer')
  const installedDir = join(consumer, 'node_modules', '@aiwayds', 'dsh-web-search-tavily')
  const installedManifest = () => JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'))
  // Same reason as packaged-install: a failed guard must reach realpathSync
  // and fail, even on machines without dsh.
  const env = { ...process.env, DSH_CLOSURE_DIR: join(scratch, 'missing-closure') }

  // 1. Baseline: the published release, pinned to the official registry so a
  //    dev mirror does not decide the fixture. A published version is
  //    immutable, so this cannot drift.
  const baseline = spawnSync(
    npm,
    [...npmArgs, 'install', `${pkgName}@${baselineVersion}`, '--prefix', consumer, '--no-audit', '--no-fund', '--loglevel=error', `--registry=${registry}`],
    { cwd: scratch, encoding: 'utf8', env },
  )
  assert.equal(baseline.status, 0, `baseline ${baselineVersion} install failed:\n${baseline.stdout}\n${baseline.stderr}`)
  const base = installedManifest()
  assert.equal(base.version, baselineVersion, `baseline fixture is ${baselineVersion}`)
  for (const key of installHooks) {
    assert.ok(!Object.hasOwn(base.scripts, key), `baseline ${baselineVersion} carries no ${key} script (#10)`)
  }

  // 2. Pack the repo the way CI's release job does. The tarball name comes
  //    from the filesystem, not stdout: npm 10's lifecycle log lines can
  //    corrupt `--json` output. A dedicated empty directory keeps the result
  //    unambiguous on every npm version.
  const packDir = join(scratch, 'pack')
  mkdirSync(packDir)
  execFileSync(npm, [...npmArgs, 'pack', '--pack-destination', packDir], { cwd: repoRoot, encoding: 'utf8' })
  const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'))
  assert.equal(tarballs.length, 1, `pack emitted exactly one tarball, got ${tarballs.join(', ') || 'none'}`)
  const tarball = join(packDir, tarballs[0])

  // 3. Tarball manifest: the install-hook gate set is empty, the version and
  //    bundle patch still mirror the repo manifest.
  const tarManifest = JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(tarManifest.version, repoManifest.version, 'packed version matches the repo manifest')
  for (const key of installHooks) {
    assert.ok(!Object.hasOwn(tarManifest.scripts, key), `tarball manifest carries no ${key} script (#10)`)
  }
  assert.ok(repoManifest.dsh?.bundle?.patch, 'repo manifest declares a bundle patch')
  assert.equal(tarManifest.dsh?.bundle?.patch, repoManifest.dsh.bundle.patch, 'bundle patch still declared')

  // 4. Upgrade in place: the plugin manager's exact step. Must exit 0 and
  //    must not produce a pnpm-11 unapproved-build report (the regression
  //    class this test pins).
  const upgrade = spawnSync(
    npm,
    [...npmArgs, 'install', tarball, '--prefix', consumer, '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: scratch, encoding: 'utf8', env },
  )
  const output = `${upgrade.stdout ?? ''}\n${upgrade.stderr ?? ''}`
  assert.equal(upgrade.status, 0, 'upgrade to the packed tarball failed:\n' + output)
  assert.ok(
    !/ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/i.test(output),
    `upgrade output carries a pnpm-11 unapproved-build report:\n${output}`,
  )

  const upgraded = installedManifest()
  assert.equal(upgraded.version, repoManifest.version, 'upgrade landed the packed version')
  for (const key of installHooks) {
    assert.ok(!Object.hasOwn(upgraded.scripts, key), `installed manifest carries no ${key} script (#10)`)
  }
  assert.ok(existsSync(join(installedDir, 'cordis.patch.yml')), 'bundle patch ships')
  assert.ok(existsSync(join(installedDir, 'lib', 'index.js')), 'plugin entry ships')
  // The tarball really won the tree (not a no-op same-version resolve): npm
  // records the upgrade spec as a file: dependency.
  const consumerManifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'))
  assert.match(consumerManifest.dependencies[pkgName], /^file:/, 'consumer resolves the plugin from the packed tarball')

  // 5. Consumer safety unchanged: no optional host SDK peer materialized a
  //    second copy inside the consumer tree.
  assert.ok(
    !existsSync(join(installedDir, 'node_modules', '@deepseek-ai')),
    'no nested @deepseek-ai copy inside the package',
  )
  assert.ok(
    !existsSync(join(consumer, 'node_modules', '@deepseek-ai')),
    'optional host SDK peers did not install a consumer-side copy',
  )
  console.log(`packaged-upgrade: ${baselineVersion} -> packed ${repoManifest.version} upgrades cleanly with no install hook`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
