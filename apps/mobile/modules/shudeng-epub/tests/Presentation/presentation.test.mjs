import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const moduleRoot = fileURLToPath(new URL('../../', import.meta.url))
const repositoryRoot = resolve(moduleRoot, '../../../../')
const source = readFileSync(resolve(moduleRoot, 'ios/ShudengEpubModule.swift'), 'utf8')
const controllerStart = source.indexOf('private final class EpubPresentationController:')
assert.ok(controllerStart >= 0)
const controller = source.slice(controllerStart)
// Copy the production methods without translating their branches. The test host
// below replaces UIKit/WebKit and the browser bridge, not scheduling or queues.
function method(signature) {
    const entry = controller.indexOf(signature)
    assert.ok(entry >= 0, 'production method exists: ' + signature)
    assert.equal(controller.indexOf(signature, entry + 1), -1, 'unique production method: ' + signature)
    const begin = controller.indexOf('{', entry)
    let depth = 1
    let quoted = false
    let escaped = false
    let comment = false
    for (let index = begin + 1; index < controller.length; index++) {
        const current = controller[index]
        if (comment) { if (current === '\n') comment = false; continue }
        if (quoted) {
            if (escaped) escaped = false
            else if (current === '\\') escaped = true
            else if (current === '"') quoted = false
            continue
        }
        if (current === '/' && controller[index + 1] === '/') { comment = true; continue }
        if (current === '"') { quoted = true; continue }
        if (current === '{') depth++
        if (current === '}' && --depth === 0) return controller.slice(entry, index + 1)
    }
    throw Error('Unclosed production method: ' + signature)
}
const stateStart = controller.indexOf('  private var source = ""')
const stateEnd = controller.indexOf('\n\n  override func viewDidLoad()', stateStart)
assert.ok(stateStart >= 0 && stateEnd > stateStart, 'production presentation state must be identifiable')
const state = controller.slice(stateStart, stateEnd)
const methods = [
    'func load(_ html: String)', 'func setActive(_ value: Bool)', 'func setCurl(_ value: Bool)',
    'private func clearCache()', 'private func invalidate()', 'func submit(_ raw: String)',
    'private func attachWeb(to container: UIView)', 'private func removePager()',
    'private func jsonString(_ value: Any)', 'private func schedule()', 'private func drain() async',
].map(method).join('\n\n')
const template = readFileSync(new URL('./presentation-test-host.swift', import.meta.url), 'utf8')
const generated = template.replace('/* PRODUCTION_STATE */', state).replace('/* PRODUCTION_METHODS */', methods)
const temporaryRoot = resolve(repositoryRoot, '.build/reader-code-quality-20261109')
mkdirSync(temporaryRoot, { recursive: true })
const temporary = mkdtempSync(resolve(temporaryRoot, 'native-presentation-'))
let result
try {
    const path = resolve(temporary, 'main.swift')
    writeFileSync(path, generated)
    // A small macOS Swift interpreter probe, without Expo, iOS, xcodebuild or
    // device interaction. All generated input and module cache are task-local.
    result = spawnSync('swift', ['-module-cache-path', resolve(temporary, 'module-cache'), path], { encoding: 'utf8', timeout: 60000 })
} finally {
    rmSync(temporary, { recursive: true, force: true })
}
assert.equal(result.error, undefined, result.error?.message)
assert.equal(result.status, 0, result.stderr)
const cases = JSON.parse(result.stdout.trim())
for (const entry of cases) {
    test(entry.name, () => assert.deepEqual(entry.failures, [], entry.failures.join('\n')))
}
