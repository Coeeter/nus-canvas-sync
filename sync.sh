#!/bin/sh
set -eu

command -v canvas >/dev/null || { echo "canvas-cli is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="$root/snapshots/$stamp"
mkdir -p "$snapshot"

fetch() {
  destination=$1
  shift
  temporary="$destination.tmp"
  error="$destination.error"
  if "$@" --no-cache --quiet -o json >"$temporary" 2>"$error"; then
    mv "$temporary" "$destination"
    rm -f "$error"
  else
    rm -f "$temporary"
    jq -n --rawfile message "$error" '{error: $message}' >"$destination.error.json"
    rm -f "$error"
  fi
}

fetch_course() {
  course_id=$1
  course_code=$2
  course_dir="$snapshot/courses/$course_code"
  mkdir -p "$course_dir/pages"

  fetch "$course_dir/assignments.json" canvas assignments list --course-id "$course_id" --include submission
  fetch "$course_dir/quizzes.json" canvas quizzes list --course-id "$course_id"
  fetch "$course_dir/announcements.json" canvas announcements list --course-id "$course_id"
  fetch "$course_dir/modules.json" canvas modules list --course-id "$course_id" --include items,content_details
  fetch "$course_dir/front-page.json" canvas pages front --course-id "$course_id"
  fetch "$course_dir/pages.json" canvas pages list --course-id "$course_id"

  if [ -f "$course_dir/pages.json" ]; then
    jq -r '.[].url' "$course_dir/pages.json" | while IFS= read -r page_url; do
      fetch "$course_dir/pages/$page_url.json" canvas pages get --course-id "$course_id" "$page_url"
    done
  fi
}

fetch_course 93698 CS2030S
fetch_course 94257 GEA1000
fetch_course 94548 GESS1001
fetch_course 97325 IS1128
fetch_course 97359 MA1301

fetch "$snapshot/planner.json" canvas planner items \
  --context course_93698,course_94257,course_94548,course_97325,course_97359 \
  --start-date 2026-07-19 --end-date 2027-01-10

jq -n \
  --arg fetched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg instance "https://canvas.nus.edu.sg" \
  '{schema_version: 1, fetched_at: $fetched_at, instance: $instance,
    courses: [
      {id: 93698, code: "CS2030S"},
      {id: 94257, code: "GEA1000"},
      {id: 94548, code: "GESS1001"},
      {id: 97325, code: "IS1128"},
      {id: 97359, code: "MA1301"}
    ]}' >"$snapshot/manifest.json"

ln -sfn "snapshots/$stamp" "$root/latest"
echo "$snapshot"
