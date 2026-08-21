#!/usr/bin/env bash
# Acceptance check for the container font stack.
#
# No unit test can assert apt state, so this is the guard: build an image and
# ask fontconfig, inside it, what each SAFE_FONT actually resolves to. Run from
# the repo root:
#
#   docker/check-container-fonts.sh                                   # root Dockerfile
#   docker/check-container-fonts.sh services/jto-render-server/Dockerfile
#
# Both images must produce the same 15-row table. The five metric-compatible
# families (Arial, Times New Roman, Courier New, Calibri, Cambria) MUST NOT land
# on a DejaVu face — that is the regression this script exists to catch.
set -euo pipefail

DOCKERFILE="${1:-Dockerfile}"
TAG="jto-fonts-check:$(printf '%s' "$DOCKERFILE" | tr '/.' '--')"

# family|expected fc-match filename
EXPECTED=(
  "Arial|LiberationSans-Regular.ttf"
  "Calibri|Carlito-Regular.ttf"
  "Cambria|Caladea-Regular.ttf"
  "Consolas|DejaVuSansMono.ttf"
  "Courier New|LiberationMono-Regular.ttf"
  "Georgia|DejaVuSerif.ttf"
  "Segoe UI|Carlito-Regular.ttf"
  "Tahoma|DejaVuSans.ttf"
  "Times New Roman|LiberationSerif-Regular.ttf"
  "Trebuchet MS|DejaVuSans.ttf"
  "Verdana|DejaVuSans.ttf"
  "Helvetica|LiberationSans-Regular.ttf"
  "Helvetica Neue|LiberationSans-Regular.ttf"
  "Menlo|DejaVuSansMono.ttf"
  "Monaco|DejaVuSansMono.ttf"
)

# Metric-compatible families: a DejaVu result here means the font packages are
# missing and page counts will not match Word.
METRIC="Arial Calibri Cambria Courier New Times New Roman"

echo "building $DOCKERFILE ..."
docker build -q -t "$TAG" -f "$DOCKERFILE" . >/dev/null

failed=0

# fontconfig-config's dependency is an alternation:
#   fonts-dejavu-core | ttf-bitstream-vera | fonts-liberation | fonts-liberation2 | ...
# Naming fonts-liberation2 in the apt line satisfies it, so DejaVu is only
# present if fonts-dejavu-core is ALSO named explicitly. Drop it and every
# proportional fallback below silently becomes Liberation Mono.
families="$(docker run --rm --entrypoint fc-list "$TAG" : family | tr ',' '\n' | sort -u)"
for want in "DejaVu Sans" "DejaVu Sans Mono" "DejaVu Serif" "Liberation Sans" \
            "Liberation Serif" "Liberation Mono" "Carlito" "Caladea"; do
  if printf '%s\n' "$families" | grep -qx "$want"; then
    printf '  ok   family present: %s\n' "$want"
  else
    printf '  FAIL family missing: %s\n' "$want"
    failed=1
  fi
done

for row in "${EXPECTED[@]}"; do
  family="${row%%|*}"
  want="${row##*|}"
  got="$(docker run --rm --entrypoint fc-match "$TAG" "$family" | awk '{print $1}' | tr -d '"')"
  if [ "$got" = "$want" ]; then
    printf '  ok   %-18s -> %s\n' "$family" "$got"
  else
    printf '  FAIL %-18s -> %s (expected %s)\n' "$family" "$got" "$want"
    failed=1
  fi
  case " $METRIC " in
    *" $family "*)
      case "$got" in
        DejaVu*)
          printf '       ^ metric-compatible family fell back to DejaVu\n'
          failed=1
          ;;
      esac
      ;;
  esac
done

exit "$failed"
