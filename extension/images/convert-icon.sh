#!/usr/bin/env bash
# Convert icon.svg → icon.png (128x128) using one of:
#   - rsvg-convert (brew install librsvg)
#   - Inkscape
#   - ImageMagick

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SVG="$DIR/icon.svg"
PNG="$DIR/icon.png"

if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 128 -h 128 "$SVG" -o "$PNG"
    echo "Done: $PNG (via rsvg-convert)"
elif command -v inkscape &>/dev/null; then
    inkscape --export-width=128 --export-height=128 --export-filename="$PNG" "$SVG"
    echo "Done: $PNG (via inkscape)"
elif command -v convert &>/dev/null; then
    convert -background none -resize 128x128 "$SVG" "$PNG"
    echo "Done: $PNG (via ImageMagick)"
else
    echo "ERROR: Install one of: librsvg (brew install librsvg), inkscape, or imagemagick"
    exit 1
fi
