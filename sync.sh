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

capture_json() {
  destination=$1
  shift
  temporary="$destination.tmp"
  error="$destination.error"
  if "$@" >"$temporary" 2>"$error"; then
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
  fetch "$course_dir/files.json" canvas files list --course-id "$course_id"
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

github_dir="$snapshot/github"
commits_dir="$github_dir/cs2030s-exercise-commits"
mkdir -p "$commits_dir"
capture_json "$github_dir/viewer.json" gh api user --jq '{login: .login}'
capture_json "$github_dir/cs2030s-repos.json" gh repo list nus-cs2030s-2627-s1 \
  --limit 1000 --json name,nameWithOwner,description,isPrivate,updatedAt,url,defaultBranchRef

if [ -f "$github_dir/viewer.json" ] && [ -f "$github_dir/cs2030s-repos.json" ]; then
  viewer_login=$(jq -r '.login | ascii_downcase' "$github_dir/viewer.json")
  filtered_repos="$github_dir/cs2030s-repos.filtered.json"
  jq --arg login "$viewer_login" \
    '[.[] | select((.name | test("^ex[0-9]+-skeleton$")) or (.name | endswith("-" + $login)))]' \
    "$github_dir/cs2030s-repos.json" >"$filtered_repos"
  mv "$filtered_repos" "$github_dir/cs2030s-repos.json"

  jq -r --arg login "$viewer_login" \
    '.[].name | select(test("^exercises-ex[0-9]+-" + $login + "$"))' \
    "$github_dir/cs2030s-repos.json" |
    while IFS= read -r repo_name; do
      capture_json "$commits_dir/$repo_name.json" gh api -X GET \
        "repos/nus-cs2030s-2627-s1/$repo_name/commits" -f per_page=100
    done
fi

jq -n \
  --arg fetched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg instance "https://canvas.nus.edu.sg" \
  '{schema_version: 3, fetched_at: $fetched_at, instance: $instance,
    expected_course_endpoints: ["assignments", "quizzes", "announcements", "files", "modules", "front-page", "pages"],
    expected_top_level_endpoints: ["planner", "github/viewer", "github/cs2030s-repos"],
    github: {
      cs2030s_org: "nus-cs2030s-2627-s1",
      repositories: "github/cs2030s-repos.json",
      exercise_commits_dir: "github/cs2030s-exercise-commits"
    },
    courses: [
      {id: 93698, code: "CS2030S"},
      {id: 94257, code: "GEA1000"},
      {id: 94548, code: "GESS1001"},
      {id: 97325, code: "IS1128"},
      {id: 97359, code: "MA1301"}
    ]}' >"$snapshot/manifest.json"

ln -sfn "snapshots/$stamp" "$root/latest"
echo "$snapshot"
