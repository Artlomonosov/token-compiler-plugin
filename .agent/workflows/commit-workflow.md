---
description: How to make changes and commit to git for this project
---

# Change & Commit Workflow

1. Make code changes in `src/`
2. Run build:
```bash
npm run build
```
3. Tell the user: **"Ready for review — please test in Figma and approve before committing."**
4. Wait for explicit user approval ("аппрув", "commit", "ok", "выглядит хорошо", etc.)
// turbo
5. Only after approval, commit and push:
```bash
git add -A && git commit -m "<description>" && git push
```
