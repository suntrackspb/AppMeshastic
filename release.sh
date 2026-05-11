#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: ./release.sh <version>  (e.g. ./release.sh 0.1.1)"
    exit 1
fi

TAG="v$VERSION"

# Ensure clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Error: working tree is not clean. Commit or stash changes first."
    exit 1
fi

echo "→ Bumping version to $VERSION"

# pyproject.toml
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml

# app/__init__.py
sed -i '' "s/__version__ = \".*\"/__version__ = \"$VERSION\"/" app/__init__.py

echo "→ Committing version bump"
git add pyproject.toml app/__init__.py
git commit -m "chore: bump version to $VERSION"

echo "→ Pushing commit"
git push origin main

echo "→ Tagging $TAG"
git tag "$TAG"
git push origin "$TAG"

echo ""
echo "✓ Released $TAG — watch the build at:"
echo "  https://github.com/suntrackspb/AppMeshastic/actions"
