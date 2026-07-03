#!/usr/bin/env python3
"""Resumably download the Strix sandbox image into an OCI layout, surviving flaky-WiFi drops.

`docker pull` cannot resume a dropped layer; `curl -C -` can. This fetches every blob (manifest,
config, 36 layers ≈ 3 GB) of ghcr.io/usestrix/strix-sandbox:1.0.0 directly from the registry with
resume-on-drop + sha256 verification, into ./strix-oci/ as an OCI image layout. Then:

    sg docker -c 'docker load -i strix-oci.tar'   # (assembled by the companion step)

Re-runnable: blobs that are already complete + verified are skipped, so interrupted runs resume.
"""
import hashlib, json, os, subprocess, sys, time, urllib.request

REPO = "usestrix/strix-sandbox"
TAG = "1.0.0"
REGISTRY = "ghcr.io"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "strix-oci")
BLOBS = os.path.join(OUT, "blobs", "sha256")

ACCEPT = ",".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
])


def token():
    url = f"https://{REGISTRY}/token?service={REGISTRY}&scope=repository:{REPO}:pull"
    return json.load(urllib.request.urlopen(url, timeout=30))["token"]


def get_json(url, tok):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "Accept": ACCEPT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def blob_path(digest):
    return os.path.join(BLOBS, digest.split(":")[1])


def have_blob(digest, size):
    p = blob_path(digest)
    return os.path.exists(p) and os.path.getsize(p) == size and sha256_file(p) == digest


def download_blob(digest, size, label):
    p = blob_path(digest)
    if have_blob(digest, size):
        print(f"  ✓ {label} {digest[7:19]} already complete ({size/1e6:.0f} MB)", flush=True)
        return
    url = f"https://{REGISTRY}/v2/{REPO}/blobs/{digest}"
    attempts = 0
    while True:
        attempts += 1
        cur = os.path.getsize(p) if os.path.exists(p) else 0
        if cur >= size:
            break
        pct = 100 * cur / size if size else 0
        print(f"  ↓ {label} {digest[7:19]} attempt {attempts}: {cur/1e6:.0f}/{size/1e6:.0f} MB ({pct:.0f}%)", flush=True)
        tok = token()  # fresh token each attempt (they expire ~5 min)
        # -C -: resume; -L: follow CDN redirect; abort only on a real stall (<2KB/s for 30s), not on slowness.
        rc = subprocess.call([
            "curl", "-sS", "-L", "-C", "-",
            "-H", f"Authorization: Bearer {tok}",
            "--speed-limit", "2048", "--speed-time", "30",
            "--retry", "5", "--retry-delay", "3", "--retry-all-errors",
            "-o", p, url,
        ])
        if rc != 0:
            print(f"    curl exited {rc} (drop/stall) — will resume", flush=True)
            time.sleep(3)
        if attempts > 200:
            print(f"  ✗ {label} {digest} gave up after {attempts} attempts", flush=True)
            sys.exit(2)
    got = sha256_file(p)
    if got != digest:
        print(f"  ✗ {label} sha mismatch ({got} != {digest}) — removing, will re-fetch next run", flush=True)
        os.remove(p)
        sys.exit(3)
    print(f"  ✓ {label} {digest[7:19]} verified ({size/1e6:.0f} MB)", flush=True)


def main():
    os.makedirs(BLOBS, exist_ok=True)
    tok = token()

    # Resolve the index → the linux/amd64 image manifest.
    raw_idx, _ = get_json(f"https://{REGISTRY}/v2/{REPO}/manifests/{TAG}", tok)
    idx = json.loads(raw_idx)
    if "manifests" in idx:
        amd = [m for m in idx["manifests"]
               if m.get("platform", {}).get("architecture") == "amd64"
               and m.get("platform", {}).get("os") == "linux"]
        man_desc = amd[0] if amd else idx["manifests"][0]
        man_digest = man_desc["digest"]
        raw_man, man_ct = get_json(f"https://{REGISTRY}/v2/{REPO}/manifests/{man_digest}", tok)
        man_media = man_desc.get("mediaType", man_ct)
    else:
        raw_man = raw_idx
        man_digest = "sha256:" + hashlib.sha256(raw_man).hexdigest()
        man_media = idx.get("mediaType", "application/vnd.oci.image.manifest.v1+json")

    man = json.loads(raw_man)
    total = sum(l["size"] for l in man["layers"]) + man["config"]["size"]
    print(f"image manifest {man_digest[7:19]} — {len(man['layers'])} layers, ~{total/1e6:.0f} MB total\n", flush=True)

    # Store the manifest blob itself (index.json references it by digest).
    with open(blob_path(man_digest), "wb") as f:
        f.write(raw_man)

    # Config + layers.
    download_blob(man["config"]["digest"], man["config"]["size"], "config")
    for i, layer in enumerate(man["layers"], 1):
        download_blob(layer["digest"], layer["size"], f"layer {i}/{len(man['layers'])}")

    # OCI layout scaffolding.
    with open(os.path.join(OUT, "oci-layout"), "w") as f:
        json.dump({"imageLayoutVersion": "1.0.0"}, f)
    index = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [{
            "mediaType": man_media,
            "digest": man_digest,
            "size": len(raw_man),
            "annotations": {"org.opencontainers.image.ref.name": f"{REGISTRY}/{REPO}:{TAG}"},
        }],
    }
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f)

    print(f"\n✓ OCI layout complete at {os.path.relpath(OUT)} — assemble + load:", flush=True)
    print("  tar -C strix-oci -cf strix-oci.tar . && sg docker -c 'docker load -i strix-oci.tar'", flush=True)


if __name__ == "__main__":
    main()
