#!/usr/bin/env bash
# Download the demo videos shown on the Demo Videos page (docs/videos.mdx) into static/videos/.
# The MP4 files are assets of the `demo-videos` GitHub release, not files in git, so that re-recording a video
# doesn't grow the repository. The docs deploy workflow runs this before the build; run it locally
# (`npm run fetch-videos`) to play the videos in `npm start`. Files that are already there are kept.
#
# To publish new videos: gh release upload demo-videos <name>.mp4 --clobber, then run the
# "Deploy Doc Website to GitHub Pages" workflow (workflow_dispatch) so the site picks them up.
set -euo pipefail

base="https://github.com/posit-dev/positron-sas-extension/releases/download/demo-videos"
dest="$(cd "$(dirname "$0")/.." && pwd)/static/videos"
videos=(demo-apro demo-viya demo-apro-housing demo-viya-housing demo-viya-clinical
        demo-apro-studio demo-apro-local demo-viya-shiny)

mkdir -p "$dest"
for v in "${videos[@]}"; do
  if [ -s "$dest/$v.mp4" ]; then
    echo "have $v.mp4"
    continue
  fi
  echo "downloading $v.mp4"
  curl -fsSL --retry 3 -o "$dest/$v.mp4.part" "$base/$v.mp4"
  mv "$dest/$v.mp4.part" "$dest/$v.mp4"
done
