#!/bin/bash
set -e

# Release script: bump version, commit, tag, and push
# Usage: ./release.sh patch|minor|major [version]
# Examples:
#   ./release.sh patch        # bumps from 1.2.2 to 1.2.3
#   ./release.sh minor        # bumps from 1.2.2 to 1.3.0
#   ./release.sh major        # bumps from 1.2.2 to 2.0.0
#   ./release.sh 1.3.0       # bumps to specific version 1.3.0

VERSION_TYPE=$1

if [ -z "$VERSION_TYPE" ]; then
  echo "Usage: ./release.sh <patch|minor|major|version>"
  echo "  patch  - bump patch version (e.g., 1.2.2 → 1.2.3)"
  echo "  minor  - bump minor version (e.g., 1.2.2 → 1.3.0)"
  echo "  major  - bump major version (e.g., 1.2.2 → 2.0.0)"
  echo "  x.y.z  - specific version"
  exit 1
fi

echo "🚀 Releasing version: $VERSION_TYPE"

# Check for uncommitted changes
if ! git diff --quiet; then
  echo "❌ Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Bump version and create tag
if [[ "$VERSION_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  npm version "$VERSION_TYPE" -m "chore(release): bump to v%s"
else
  npm version "$VERSION_TYPE" -m "chore(release): bump to v%s"
fi

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "📦 Version bumped to: $NEW_VERSION"

# Push commit and tags
echo "🚀 Pushing to remote..."
git push
git push origin "v$NEW_VERSION"

echo "✅ Release v$NEW_VERSION published!"
echo "📝 GitHub Actions workflow will trigger automatically."
