# DSH official source evidence fixtures

The two TypeScript files are unmodified upstream evidence, not replacement implementations and not compiled by this project.

- [registry source](<registry.ca33fd6.ts>) from [packages/skill/skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/skill/src/index.ts).
- [tool consumer source](<tool-skill.ca33fd6.ts>) from [packages/skill/tool-skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/tool-skill/src/index.ts).

Both retrieved through GitHub Contents API at fixed commit ca33fd6843b205e279c7ccb6cb73a472c78f5760 on 2026-11-18. Upstream [MIT license](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/LICENSE) is reproduced below.

[verify.mjs](<verify.mjs>) executes an isolated official npm release and this project actual manager/provider/verifier. It does not execute the TypeScript snapshots or installed GUI host. See [verification report](<../../../docs/overlay-verification.md>) for commands, scope and limits. Runtime fixture data is isolated under this directory and removed on successful completion. Do not run two copies concurrently.

## Upstream copyright and permission

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
