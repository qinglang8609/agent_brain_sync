// test/lint.test.js — 体检的判定逻辑（原先 50% 覆盖，缺 hasTail / listPages）。
//
// hasTail 是「知识页必须有可执行尾巴」这条规则的实现 —— 它本身有段遍历逻辑
// （按标题层级找段、跳注释、认列表形态），不是一行正则，值得单独钉。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasTail, listPages, checkGeneratedFileLinks, PAGE_DIRS } from '../src/lint.js';

let sandbox;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-lint-'));
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('hasTail — 「做完怎么确认」段的存在性', () => {
  test('有验证段且段内有内容 → true', () => {
    const md = '# 标题\n\n## 触发场景\n事\n\n## 验证\n跑 npm test\n';
    assert.equal(hasTail(md), true);
  });

  test('标题命中但段内是空的 → false（空标题不算尾巴）', () => {
    const md = '# 标题\n\n## 验证\n\n## 关联连接\n- [[x]]\n';
    assert.equal(hasTail(md), false, '标题后面没内容不算');
  });

  test('段内只有 HTML 占位注释 → false（占位不算内容）', () => {
    const md = '## 验证\n<!-- 待填 -->\n\n## 下一节\n';
    assert.equal(hasTail(md), false);
  });

  test('标题层级回退即段结束（不误收下一段）', () => {
    // ## 验证 段内空，紧跟的 ## 关联连接 的内容不该被当成验证段
    const md = '## 验证\n\n## 关联连接\n- [[a]] — 说明\n';
    assert.equal(hasTail(md), false, '并列标题下的内容不属于验证段');
  });

  test('列表形态也算（"1. 先..." / "- **检查**"）', () => {
    assert.equal(hasTail('## 别的\n1. 先跑测试\n'), true);
    assert.equal(hasTail('## 别的\n- **检查**一遍\n'), true);
  });

  test('完全没尾巴 → false', () => {
    assert.equal(hasTail('# 标题\n\n就是一段说明文字，没有任何可执行的东西。\n'), false);
  });

  test('空/畸形输入不炸', () => {
    assert.equal(hasTail(''), false);
    assert.equal(hasTail(null), false);
    assert.equal(hasTail('###'), false);
  });
});

describe('checkGeneratedFileLinks — 生成的链接名必须逐字等于磁盘文件名', () => {
  const writeVault = async ({ index, todo, files }) => {
    await fs.mkdir(join(sandbox, 'sessions'), { recursive: true });
    for (const f of files) {
      await fs.writeFile(join(sandbox, 'sessions', `${f}.md`), '---\ntags: [session-log]\n---\n\n# x\n', 'utf8');
    }
    if (index !== undefined) await fs.writeFile(join(sandbox, 'index.md'), index, 'utf8');
    if (todo !== undefined) await fs.writeFile(join(sandbox, 'todo.md'), todo, 'utf8');
  };

  test('todo.md 归档行的链接名在 sessions/ 里没有同名文件 → 报 LINK-NAME-STALE', async () => {
    // 实测形态：2026-09-15 治理时旧归档页 `2026-09-12-todo归档` 并进了 log-2026-09-12，
    // 但 todo.md 里那行链接名没跟着改，挂了两个月没人发现。
    await writeVault({
      files: ['log-2026-09-12'],
      todo: '# 📋 Todo Board\n\n## Done\n\n### Archived\n- [[2026-09-12-todo归档]] 完成任务 13 条\n',
    });
    const out = await checkGeneratedFileLinks(sandbox);
    assert.equal(out.length, 1, JSON.stringify(out));
    assert.match(out[0], /LINK-NAME-STALE: todo\.md ### Archived -> \[\[2026-09-12-todo归档\]\]/);
  });

  test('归档行链接名就是文件名 → 不报', async () => {
    await writeVault({
      files: ['log-2026-09-12'],
      todo: '## Done\n\n### Archived\n- [[log-2026-09-12]] 完成任务 13 条\n',
    });
    assert.deepEqual(await checkGeneratedFileLinks(sandbox), []);
  });

  test('index.md ## Sessions 行同样管；指向不存在的名字即报', async () => {
    await writeVault({
      files: ['log-2026-11-08'],
      index: '# 🗂 Graph Index\n\n## Sessions\n- [[session-2026-11-05-s01a1a9c6]] — 会话\n\n## Syntheses\n- [[别处]]\n',
    });
    const out = await checkGeneratedFileLinks(sandbox);
    assert.equal(out.length, 1, JSON.stringify(out));
    assert.match(out[0], /index\.md ## Sessions -> \[\[session-2026-11-05-s01a1a9c6\]\]/);
  });

  test('只看自己那一段：## Sessions 之外的行不参与', async () => {
    await writeVault({
      files: ['log-2026-11-08'],
      index: '# 🗂 Graph Index\n\n## Concepts\n- [[session-2026-11-05-s01a1a9c6]] — 不在 Sessions 段\n\n## Sessions\n- [[log-2026-11-08]] — 会话\n',
    });
    assert.deepEqual(await checkGeneratedFileLinks(sandbox), []);
  });

  test('别名写法 [[真名|别名]] 认真名', async () => {
    await writeVault({
      files: ['log-2026-11-08'],
      todo: '## Done\n\n### Archived\n- [[log-2026-11-08|本周]] 完成任务 4 条\n',
    });
    assert.deepEqual(await checkGeneratedFileLinks(sandbox), []);
  });

  test('无 index.md / todo.md / sessions 目录都不炸', async () => {
    await assert.doesNotReject(() => checkGeneratedFileLinks(sandbox));
    await assert.doesNotReject(() => checkGeneratedFileLinks(join(sandbox, 'no-such-vault')));
  });
});

describe('listPages — 扫页面清单', () => {
  test('无 index.md 也不炸（返回数组）', async () => {
    const r = await listPages(sandbox);
    assert.ok(Array.isArray(r));
  });

  test('扫到各目录下的 .md 页', async () => {
    for (const d of PAGE_DIRS.slice(0, 2)) {
      await fs.mkdir(join(sandbox, d), { recursive: true });
      await fs.writeFile(join(sandbox, d, 'probe-page.md'),
        '---\ntags: [concept]\nstatus: active\n---\n\n# 探针\n', 'utf8');
    }
    const r = await listPages(sandbox);
    const found = r.filter((p) => JSON.stringify(p).includes('probe-page'));
    assert.ok(found.length >= 1, `应扫到 probe-page: ${JSON.stringify(r).slice(0, 200)}`);
  });

  test('目录不存在时跳过（不抛）', async () => {
    await assert.doesNotReject(() => listPages(join(sandbox, 'no-such-vault')));
  });
});
