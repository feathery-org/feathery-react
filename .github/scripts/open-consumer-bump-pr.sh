#!/usr/bin/env bash
# Opens (or refreshes) a PR in a consumer repo that bumps @feathery/react to
# the version just published. Runs from the root of a checked-out consumer.
#
# Required env:
#   VERSION       - the newly published @feathery/react version (e.g. 2.86.0)
#   REPO          - consumer repo slug (e.g. feathery-org/feathery-frontend)
#   BASE_BRANCH   - consumer default branch (master / main)
#   RELEASE_URL   - link to the @feathery/react GitHub release
#   GH_TOKEN      - token with contents + pull_requests write on $REPO
set -euo pipefail

: "${VERSION:?}" "${REPO:?}" "${BASE_BRANCH:?}" "${RELEASE_URL:?}" "${GH_TOKEN:?}"

BRANCH="chore/bump-feathery-react-${VERSION}"
TITLE="chore: bump @feathery/react to ${VERSION}"

current=$(node -p "require('./package.json').dependencies['@feathery/react']")
echo "Current pin in ${REPO}: ${current}"

# The publish finished moments ago; give the npm registry time to serve it.
for attempt in $(seq 1 12); do
  if npm view "@feathery/react@${VERSION}" version >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 12 ]; then
    echo "::error::@feathery/react@${VERSION} not visible on npm after 2 minutes"
    exit 1
  fi
  echo "Waiting for @feathery/react@${VERSION} on npm (attempt ${attempt})..."
  sleep 10
done

# Keep the caret range the consumers already use; yarn rewrites package.json
# and yarn.lock together. --ignore-scripts skips husky/postinstall hooks the
# runner doesn't need for a lockfile update.
yarn add --ignore-scripts "@feathery/react@^${VERSION}"

if git diff --quiet -- package.json yarn.lock; then
  echo "${REPO} already depends on @feathery/react ${VERSION}; nothing to do."
  exit 0
fi

git checkout -B "$BRANCH"
git add package.json yarn.lock
git commit -m "$TITLE"
# Force-push so a re-run of the release workflow refreshes the same branch.
git push --force -u origin "$BRANCH"

existing=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -n "$existing" ]; then
  echo "PR #${existing} already open for ${BRANCH}; branch updated."
  exit 0
fi

body=$(cat <<BODY
Automated bump of \`@feathery/react\` from \`${current}\` to \`^${VERSION}\`.

Release notes: ${RELEASE_URL}

Opened by the feathery-react **Release & Publish** workflow.
BODY
)

gh pr create \
  --repo "$REPO" \
  --base "$BASE_BRANCH" \
  --head "$BRANCH" \
  --title "$TITLE" \
  --body "$body"
