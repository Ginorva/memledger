// Smoke test: ML model persistence uses original root path, not lowercased key.
//
// Validates the fix for the bug where ModelRegistry.saveAll() used the
// lowercased normalized key as the save path, causing Windows paths to
// never persist correctly (e.g. D:\foo → d:/foo → save to wrong location).

import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

// Use a temp directory with mixed case to simulate Windows paths
const TEMP_ROOT = join(ROOT, 'test', '_TempMLTest')
const DOCS_DIR = join(TEMP_ROOT, 'docs')
const MODEL_FILE = join(DOCS_DIR, '.memledger-ml.json')

// Clean up any previous run
try { rmSync(TEMP_ROOT, { recursive: true, force: true }) } catch {}

async function main() {
  // Dynamic import to get fresh module
  const { ModelRegistry, RelevanceModel } = await import(
    new URL('../lib/ml-model.js', import.meta.url).href + '?t=' + Date.now()
  )

  console.log('ML model persistence:')

  // 1. Create a registry and get a model with a mixed-case root
  const registry = new ModelRegistry()
  const model = registry.get(TEMP_ROOT)
  check('model starts with 0 samples', model.sampleCount === 0)

  // 2. Train the model with some samples
  for (let i = 0; i < 5; i++) {
    model.update([0.5, 0.8, 1.0, 0, 0, 0.5, 0, 0], 1)
  }
  check('model has 5 samples after training', model.sampleCount === 5)

  // 3. Save via saveAll — this should use the ORIGINAL root, not lowercased
  mkdirSync(DOCS_DIR, { recursive: true })
  registry.saveAll()

  check('model file was written', existsSync(MODEL_FILE),
    'expected at: ' + MODEL_FILE)

  // 4. Verify the saved data
  if (existsSync(MODEL_FILE)) {
    const saved = JSON.parse(readFileSync(MODEL_FILE, 'utf-8'))
    check('saved sampleCount matches', saved.sampleCount === 5,
      'got ' + saved.sampleCount)
    check('saved weights array has 8 elements', 
      Array.isArray(saved.weights) && saved.weights.length === 8)
  }

  // 5. Load into a fresh model and verify
  const model2 = new RelevanceModel()
  const loaded = model2.load(TEMP_ROOT)
  check('model loaded from disk', loaded === true)
  check('loaded sampleCount matches', model2.sampleCount === 5,
    'got ' + model2.sampleCount)

  // 6. Clean up
  try { rmSync(TEMP_ROOT, { recursive: true, force: true }) } catch {}

  if (failures > 0) {
    console.log('\n' + failures + ' CHECK(S) FAILED')
    process.exitCode = 1
    return
  }
  console.log('\nALL ML PERSISTENCE CHECKS PASSED')
}

main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
