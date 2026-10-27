import test from 'node:test'
import assert from 'node:assert/strict'
import { safeMarkdown } from '../src/client/display.ts'

test('remote markdown images become links instead of automatic requests', () => {
  assert.equal(safeMarkdown('![a](https://tracker.test/p.png)'), '[a](https://tracker.test/p.png)')
  assert.equal(safeMarkdown('![](http://tracker.test/p.gif "t")'), '<http://tracker.test/p.gif>')
})

test('raw HTML images with a remote src are neutralised', () => {
  const out = safeMarkdown('<img src="https://tracker.test/x.png" width=1>')
  assert.ok(!/<img/i.test(out), out)
  assert.ok(out.includes('https://tracker.test/x.png'))
})

test('local image references and ordinary markdown are untouched', () => {
  const local = '![shot](file:///c/a.png)'
  assert.equal(safeMarkdown(local), local)
  const prose = 'text [link](https://example.test) and `code`'
  assert.equal(safeMarkdown(prose), prose)
  assert.equal(safeMarkdown(''), '')
})
