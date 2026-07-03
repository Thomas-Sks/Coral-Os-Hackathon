#!/usr/bin/env python3
"""Stream the downloaded OCI layout as a legacy docker-load tar to stdout.

Docker's classic image store `docker load` wants the legacy format: a root manifest.json plus
UNCOMPRESSED layer tars (diff_ids = sha256 of the decompressed tar). Registry blobs are gzip-
compressed, so we decompress each layer on the fly. Streamed to stdout and piped into `docker load`
so at most one decompressed layer is on disk at a time:

    python3 scripts/oci-to-docker-load.py | sg docker -c 'docker load'
"""
import gzip, io, json, os, sys, tarfile, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "strix-oci")
BLOBS = os.path.join(ROOT, "blobs", "sha256")
REPO_TAG = "ghcr.io/usestrix/strix-sandbox:1.0.0"

def blob(digest):
    return os.path.join(BLOBS, digest.split(":")[1])

def log(m):
    print(m, file=sys.stderr, flush=True)

def main():
    index = json.load(open(os.path.join(ROOT, "index.json")))
    man_digest = index["manifests"][0]["digest"]
    man = json.load(open(blob(man_digest)))
    config_digest = man["config"]["digest"]
    layer_digests = [l["digest"] for l in man["layers"]]
    log(f"assembling docker-load stream: {len(layer_digests)} layers")

    tar = tarfile.open(fileobj=sys.stdout.buffer, mode="w|")

    # config.json (raw, not compressed)
    cfg = open(blob(config_digest), "rb").read()
    ti = tarfile.TarInfo("config.json"); ti.size = len(cfg)
    tar.addfile(ti, io.BytesIO(cfg))

    layer_names = []
    for i, dig in enumerate(layer_digests):
        name = f"layer-{i:02d}.tar"
        layer_names.append(name)
        # Decompress this gzipped layer blob to a temp file (need its size for the tar header).
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
            with gzip.open(blob(dig), "rb") as gz:
                sz = 0
                while True:
                    chunk = gz.read(1 << 20)
                    if not chunk:
                        break
                    tmp.write(chunk); sz += len(chunk)
        ti = tarfile.TarInfo(name); ti.size = sz
        with open(tmp_path, "rb") as fh:
            tar.addfile(ti, fh)
        os.remove(tmp_path)
        log(f"  + {name} ({sz/1e6:.0f} MB decompressed)")

    manifest = [{
        "Config": "config.json",
        "RepoTags": [REPO_TAG],
        "Layers": layer_names,
    }]
    mj = json.dumps(manifest).encode()
    ti = tarfile.TarInfo("manifest.json"); ti.size = len(mj)
    tar.addfile(ti, io.BytesIO(mj))

    tar.close()
    log("stream complete")

if __name__ == "__main__":
    main()
