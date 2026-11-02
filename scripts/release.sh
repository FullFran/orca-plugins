#!/usr/bin/env bash
# Publish the current HEAD of one plugin as a release in orca-catalog.json.
#
#   scripts/release.sh plugins/<id>          # validate, test, add the release entry
#   scripts/release.sh plugins/<id> --push   # ...and commit + push the catalog
#
# Orca installs from the catalog at its main branch, pins the release commit and
# checks contentHash, then updates installed copies when a newer release appears.
# Bump "version" in the plugin's orca-plugin.json and push that commit first:
# the release must point at a commit GitHub already has.
set -euo pipefail

ORCA_BIN="${ORCA_BIN:-orca-ide}"
OWNER="FullFran"
REPO_URL="https://github.com/FullFran/orca-plugins.git"
root=$(git rev-parse --show-toplevel)
catalog="$root/orca-catalog.json"
dir="${1:?usage: scripts/release.sh plugins/<id> [--push]}"; push="${2:-}"
cd "$root"

die() { echo "❌ $*" >&2; exit 1; }
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('result', d)))"; }

[[ -f $dir/orca-plugin.json ]] || die "$dir has no orca-plugin.json"
[[ -z $(git status --porcelain -- "$dir") ]] || die "$dir has uncommitted changes"
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main: push it first"

"$ORCA_BIN" plugin validate "$dir" --json >/dev/null || die "plugin validate failed"
if compgen -G "$dir/src/*.test.ts*" >/dev/null; then
  "$ORCA_BIN" plugin test "$dir" --json >/dev/null || die "plugin tests failed"
fi

entry=$("$ORCA_BIN" plugin release-entry "$dir" --json | json)
python3 -I - "$catalog" "$entry" "$OWNER" "$REPO_URL" "$dir" <<'EOF'
import json, sys, os, datetime
path, entry, owner, url, plugin_dir = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
manifest = json.load(open(os.path.join(plugin_dir, "orca-plugin.json")))
release = dict(entry["entry"]); release["updatedAt"] = datetime.date.today().isoformat()
release["repository"] = url.removesuffix(".git")
cat = json.load(open(path)) if os.path.exists(path) else {
    "$schema": "https://raw.githubusercontent.com/stablyai/orca/main/docs/schemas/plugins/orca-catalog.v2.schema.json",
    "catalogVersion": 2, "name": "FullFran Orca plugins", "owner": owner, "plugins": []}
pid = f"{owner.lower()}.{manifest['id']}"
plugin = next((p for p in cat["plugins"] if p["id"] == pid), None)
if plugin is None:
    plugin = {"id": pid, "source": {"kind": "git", "url": url, "ref": "main", "path": entry["sourcePath"]},
              "description": manifest.get("description", ""), "releases": []}
    cat["plugins"].append(plugin)
if any(r["version"] == release["version"] for r in plugin["releases"]):
    sys.exit(f"{pid} {release['version']} is already in the catalog: bump version in orca-plugin.json")
plugin["releases"].insert(0, release)
json.dump(cat, open(path, "w"), indent=2, ensure_ascii=False); open(path, "a").write("\n")
print(f"✅ {pid} {release['version']} @ {release['commit'][:7]}")
EOF

"$ORCA_BIN" plugin validate "$catalog" --json >/dev/null || die "catalog validation failed"

if [[ $push == --push ]]; then
  version=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$dir/orca-plugin.json")
  git add orca-catalog.json
  git commit -q -m "chore(catalog): release $(basename "$dir") $version"
  git push -q origin main
  echo "✅ catalog pushed; installed copies update automatically"
fi
