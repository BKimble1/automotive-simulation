#!/usr/bin/env python3
"""One-time model acquisition for the FAB / ONE narration pipeline.

TTS model (always):
    Downloads the npm package ``expo-kokoro@1.1.9`` from registry.npmjs.org, checks the
    tarball against the registry's ``dist.integrity`` (sha512) and ``dist.shasum``
    (sha1), checks the registry's ECDSA signature over that integrity value, and
    extracts ONLY:
      package/build/kokoro-quantized.onnx   Kokoro-82M v1.0, quantized ONNX (Apache-2.0)
      package/build/voices/<voice>.bin      the voices we use; float32 [510, 1, 256]
      package/build/tokenizer.json          phoneme -> id vocabulary shipped with the model
      package/LICENSE, README.md, package.json
    into ``.cache/model/expo-kokoro-1.1.9/``.

Optional ASR model for QA (``--asr``; never shipped with the app):
    ``@moonshine-ai/moonshine-js@0.1.29`` (npm, MIT; its English Moonshine model is MIT)
      -> dist/model/tiny/quantized/{encoder_model,decoder_model_merged}.onnx, LICENSE, README
    ``useful-moonshine-onnx==20251121`` (PyPI wheel, MIT, sha256 checked against PyPI)
      -> moonshine_onnx/assets/tokenizer.json, LICENSE
    into ``.cache/asr/``.

Every extracted file's sha256 and size is recorded in ``model-lock.json``. This is
the only step that needs network access (registry.npmjs.org, pypi.org and
files.pythonhosted.org); synthesis afterwards is fully local. A verified download
in ``.cache/downloads`` is reused, so re-running is cheap.

Usage:
    .venv/bin/python fetch_model.py [--asr]             fetch + extract
    .venv/bin/python fetch_model.py --voices bf_emma    also extract another voice
    .venv/bin/python fetch_model.py --verify            verify .cache against the lock
    .venv/bin/python fetch_model.py --tarball PATH      use a pre-downloaded expo-kokoro tarball
    .venv/bin/python fetch_model.py --offline           re-extract from .cache/downloads only
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import json
import shutil
import sys
import tarfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
LOCK_PATH = HERE / "model-lock.json"
DOWNLOADS = CACHE / "downloads"
REGISTRY = "https://registry.npmjs.org"
PYPI = "https://pypi.org/pypi"

PACKAGE = "expo-kokoro"
VERSION = "1.1.9"
MODEL_DIR = CACHE / "model" / f"{PACKAGE}-{VERSION}"
MODEL_MEMBER = "package/build/kokoro-quantized.onnx"
VOCAB_MEMBER = "package/build/tokenizer.json"
DOC_MEMBERS = ["package/LICENSE", "package/README.md", "package/package.json"]
VOICE_MEMBER = "package/build/voices/{voice}.bin"
DEFAULT_VOICES = ["bm_george", "bm_fable", "bm_lewis", "bm_daniel"]
VOICE_BYTES = 510 * 1 * 256 * 4  # float32 [510, 1, 256]
# Size of onnx-community/Kokoro-82M-v1.0-ONNX onnx/model_quantized.onnx as given in the
# task brief. It could NOT be checked here: huggingface.co is blocked by this
# environment's egress policy, so only this size is compared, never a hash.
REFERENCE_QUANTIZED_BYTES = 92_361_116

ASR_NPM = ("@moonshine-ai/moonshine-js", "0.1.29")
ASR_NPM_MEMBERS = [
    "package/dist/model/tiny/quantized/encoder_model.onnx",
    "package/dist/model/tiny/quantized/decoder_model_merged.onnx",
    "package/LICENSE",
    "package/README.md",
]
ASR_PYPI = ("useful-moonshine-onnx", "20251121")
ASR_PYPI_MEMBERS = [
    "moonshine_onnx/assets/tokenizer.json",
    "useful_moonshine_onnx-20251121.dist-info/LICENSE",
]
ASR_DIR = CACHE / "asr"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def http_get(url: str, timeout: float = 60.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "fab-one-narration/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    log(f"downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "fab-one-narration/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, part.open("wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        got, last = 0, -1
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            got += len(chunk)
            pct = int(100 * got / total) if total else -1
            if pct != last and pct % 25 == 0:
                log(f"  {got / 1e6:6.1f} MB{f' ({pct}%)' if total else ''}")
                last = pct
    part.replace(dest)


# ---------------------------------------------------------------------------------
# npm
# ---------------------------------------------------------------------------------
def npm_metadata(name: str, version: str) -> dict:
    url = f"{REGISTRY}/{urllib.parse.quote(name, safe='@')}/{version}"
    log(f"registry metadata: {url}")
    meta = json.loads(http_get(url))
    if meta.get("name") != name or meta.get("version") != version:
        raise SystemExit(f"unexpected registry metadata for {name}@{version}")
    return meta


def verify_registry_signature(meta: dict) -> dict:
    """Check the npm registry ECDSA signature over '<name>@<version>:<integrity>'."""
    sigs = meta.get("dist", {}).get("signatures") or []
    result = {
        "method": "ECDSA P-256 / SHA-256 over '<name>@<version>:<dist.integrity>', "
                  "public key from https://registry.npmjs.org/-/npm/v1/keys",
        "keyid": sigs[0]["keyid"] if sigs else None,
        "verified": False,
    }
    if not sigs:
        result["detail"] = "registry metadata carries no signature"
        return result
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError:
        result["detail"] = "cryptography not installed; signature not checked"
        return result
    keys = {k["keyid"]: k for k in json.loads(http_get(f"{REGISTRY}/-/npm/v1/keys"))["keys"]}
    message = f"{meta['name']}@{meta['version']}:{meta['dist']['integrity']}".encode()
    for sig in sigs:
        key = keys.get(sig["keyid"])
        if key is None:
            continue
        public_key = serialization.load_der_public_key(base64.b64decode(key["key"]))
        try:
            public_key.verify(base64.b64decode(sig["sig"]), message, ec.ECDSA(hashes.SHA256()))
        except InvalidSignature:
            raise SystemExit(f"registry signature {sig['keyid']} does NOT verify - aborting")
        result.update(keyid=sig["keyid"], verified=True, keyExpires=key.get("expires"))
        return result
    result["detail"] = "no signature key id matched the registry key list"
    return result


def check_npm_tarball(path: Path, dist: dict) -> dict:
    h512, h1, h256 = hashlib.sha512(), hashlib.sha1(), hashlib.sha256()
    n = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h512.update(chunk)
            h1.update(chunk)
            h256.update(chunk)
            n += len(chunk)
    integrity = "sha512-" + base64.b64encode(h512.digest()).decode()
    if integrity != dist["integrity"]:
        raise SystemExit(f"integrity mismatch for {path}:\n  got      {integrity}\n  expected {dist['integrity']}")
    if dist.get("shasum") and h1.hexdigest() != dist["shasum"]:
        raise SystemExit(f"sha1 mismatch for {path}")
    log(f"tarball verified: {integrity[:30]}... ({n} bytes)")
    return {"sha256": h256.hexdigest(), "bytes": n}


def extract_members(archive: Path, members: list[str], dest_dir: Path, strip: str = "",
                    optional: tuple[str, ...] = ()) -> tuple[list[dict], list[str]]:
    """Extract exactly the listed regular files (from a .tgz or .whl) into dest_dir."""
    files, missing = [], []
    if archive.suffix == ".whl":
        zf = zipfile.ZipFile(archive)
        index = {i.filename: i for i in zf.infolist()}
        opener = lambda name: zf.open(index[name])  # noqa: E731
        is_file = lambda name: not index[name].is_dir()  # noqa: E731
    else:
        tf = tarfile.open(archive, "r:gz")
        index = {m.name: m for m in tf.getmembers()}
        opener = lambda name: tf.extractfile(index[name])  # noqa: E731
        is_file = lambda name: index[name].isfile()  # noqa: E731
    for name in members:
        if name not in index:
            if name in optional or name.endswith((".md", "LICENSE", "package.json")):
                missing.append(name)
                log(f"  (not in archive: {name})")
                continue
            raise SystemExit(f"required member {name} not found in {archive.name}")
        if not is_file(name):
            raise SystemExit(f"{name} is not a regular file in {archive.name}")
        rel = name[len(strip):] if strip and name.startswith(strip) else name
        dest = dest_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with opener(name) as src, tmp.open("wb") as out:
            shutil.copyfileobj(src, out, 1 << 20)
        tmp.replace(dest)
        files.append({"path": name, "dest": dest.relative_to(HERE).as_posix(),
                      "bytes": dest.stat().st_size, "sha256": sha256_file(dest)})
        log(f"  extracted {name} -> {dest.relative_to(HERE)} ({dest.stat().st_size} bytes)")
    return files, missing


def fetch_npm(name: str, version: str, members: list[str], dest_dir: Path, locked: dict | None,
              offline: bool, tarball: Path | None = None, optional: tuple[str, ...] = ()) -> dict:
    base = name.split("/")[-1]
    url = f"{REGISTRY}/{name}/-/{base}-{version}.tgz"
    if offline:
        if not locked:
            raise SystemExit(f"--offline needs {name} in model-lock.json")
        dist = {"integrity": locked["integrity"], "shasum": locked.get("shasum"), "tarball": locked["tarball"]}
        signature, lic = locked.get("registrySignature", {}), locked.get("packageLicense")
    else:
        meta = npm_metadata(name, version)
        dist, lic = meta["dist"], meta.get("license")
        if dist["tarball"] != url:
            raise SystemExit(f"registry points to an unexpected tarball URL: {dist['tarball']}")
        if locked and locked["integrity"] != dist["integrity"]:
            raise SystemExit(f"{name}: registry integrity differs from model-lock.json - refusing to continue")
        signature = verify_registry_signature(meta)
        log(f"registry signature verified: {signature['verified']} ({signature.get('keyid')})")
    tar_path = tarball or DOWNLOADS / f"{base}-{version}.tgz"
    if tar_path.exists():
        log(f"using existing tarball {tar_path}")
    elif offline:
        raise SystemExit(f"--offline but {tar_path} does not exist")
    else:
        download(dist["tarball"], tar_path)
    tar_info = check_npm_tarball(tar_path, dist)
    files, missing = extract_members(tar_path, members, dest_dir, strip="package/", optional=optional)
    if locked:
        old = {f["path"]: f["sha256"] for f in locked.get("files", [])}
        for f in files:
            if f["path"] in old and old[f["path"]] != f["sha256"]:
                raise SystemExit(f"{f['path']} sha256 changed versus model-lock.json")
    return {
        "package": name, "version": version, "packageLicense": lic, "registry": REGISTRY,
        "tarball": dist["tarball"], "integrity": dist["integrity"], "shasum": dist.get("shasum"),
        "tarballSha256": tar_info["sha256"], "tarballBytes": tar_info["bytes"],
        "registrySignature": signature, "files": files, "_missing": missing,
    }


# ---------------------------------------------------------------------------------
# PyPI
# ---------------------------------------------------------------------------------
def fetch_pypi_wheel(name: str, version: str, members: list[str], dest_dir: Path,
                     locked: dict | None, offline: bool) -> dict:
    if offline:
        if not locked:
            raise SystemExit(f"--offline needs {name} in model-lock.json")
        url, digest, lic = locked["wheel"], locked["sha256"], locked.get("license")
    else:
        meta = json.loads(http_get(f"{PYPI}/{name}/{version}/json"))
        wheels = [f for f in meta["urls"] if f["filename"].endswith("-py3-none-any.whl")]
        if len(wheels) != 1:
            raise SystemExit(f"{name}=={version}: expected one pure-Python wheel")
        url, digest, lic = wheels[0]["url"], wheels[0]["digests"]["sha256"], meta["info"].get("license")
        if locked and locked["sha256"] != digest:
            raise SystemExit(f"{name}: PyPI sha256 differs from model-lock.json - refusing to continue")
    whl = DOWNLOADS / url.rsplit("/", 1)[-1]
    if not whl.exists():
        if offline:
            raise SystemExit(f"--offline but {whl} does not exist")
        download(url, whl)
    got = sha256_file(whl)
    if got != digest:
        raise SystemExit(f"sha256 mismatch for {whl.name}: {got} != {digest}")
    log(f"wheel verified: sha256 {digest[:16]}...")
    files, _ = extract_members(whl, members, dest_dir)
    return {"package": name, "version": version, "license": lic, "wheel": url, "sha256": digest, "files": files}


# ---------------------------------------------------------------------------------
def verify_cache(lock: dict) -> bool:
    ok, n = True, 0
    groups = [lock["files"]]
    if lock.get("asr"):
        groups += [lock["asr"]["npm"]["files"], lock["asr"]["pypi"]["files"]]
    for files in groups:
        for f in files:
            n += 1
            p = HERE / f["dest"]
            if not p.exists():
                log(f"MISSING {f['dest']}")
                ok = False
            elif sha256_file(p) != f["sha256"] or p.stat().st_size != f["bytes"]:
                log(f"MISMATCH {f['dest']}")
                ok = False
    log(f"{n} files checked against model-lock.json: {'all match' if ok else 'PROBLEMS above'}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voices", nargs="*", default=[], help="extra voice ids to extract besides the defaults")
    ap.add_argument("--asr", action="store_true", help="also fetch the Moonshine-tiny ASR model used for QA")
    ap.add_argument("--tarball", type=Path, help="use this pre-downloaded expo-kokoro tarball instead of downloading")
    ap.add_argument("--verify", action="store_true", help="only verify the extracted files against model-lock.json")
    ap.add_argument("--offline", action="store_true",
                    help="do not contact any registry; trust the hashes recorded in model-lock.json")
    args = ap.parse_args()

    lock = json.loads(LOCK_PATH.read_text()) if LOCK_PATH.exists() else None
    if args.verify:
        if not lock:
            log("no model-lock.json yet; run fetch_model.py first")
            return 1
        return 0 if verify_cache(lock) else 1

    voices = list(dict.fromkeys(DEFAULT_VOICES + (lock or {}).get("voices", []) + args.voices))
    voice_members = [VOICE_MEMBER.format(voice=v) for v in voices]
    tts = fetch_npm(PACKAGE, VERSION, [MODEL_MEMBER, VOCAB_MEMBER, *DOC_MEMBERS, *voice_members],
                    MODEL_DIR, lock, args.offline, args.tarball, optional=tuple(voice_members))
    missing_voices = [m.split("/")[-1][:-4] for m in tts.pop("_missing") if m in voice_members]
    files = tts["files"]
    model = next(f for f in files if f["path"] == MODEL_MEMBER)
    for f in files:
        if f["path"] in voice_members and f["bytes"] != VOICE_BYTES:
            raise SystemExit(f"{f['path']} is {f['bytes']} bytes, expected {VOICE_BYTES} (float32 [510,1,256])")
    size_note = (
        f"kokoro-quantized.onnx is {model['bytes']} bytes, the same size as onnx-community/"
        "Kokoro-82M-v1.0-ONNX onnx/model_quantized.onnx (size quoted in the task brief). "
        "Only the size could be compared."
        if model["bytes"] == REFERENCE_QUANTIZED_BYTES else
        f"WARNING: model size {model['bytes']} differs from the reference {REFERENCE_QUANTIZED_BYTES}"
    )

    asr = (lock or {}).get("asr")
    if args.asr or asr:
        npm_part = fetch_npm(*ASR_NPM, ASR_NPM_MEMBERS, ASR_DIR / f"moonshine-js-{ASR_NPM[1]}",
                             (asr or {}).get("npm"), args.offline)
        npm_part.pop("_missing")
        pypi_part = fetch_pypi_wheel(*ASR_PYPI, ASR_PYPI_MEMBERS, ASR_DIR / f"useful-moonshine-onnx-{ASR_PYPI[1]}",
                                     (asr or {}).get("pypi"), args.offline)
        asr = {
            "purpose": "optional QA only: transcribe each narration cue and compute a word error "
                       "rate. Never bundled with the app.",
            "model": {"name": "Moonshine tiny (English), quantized ONNX",
                      "author": "Useful Sensors / Moonshine AI", "license": "MIT"},
            "npm": npm_part,
            "pypi": pypi_part,
            "retrievedAt": (asr or {}).get("retrievedAt") or _dt.date.today().isoformat(),
        }

    new_lock = {
        "schema": 1,
        **{k: tts[k] for k in ("package", "version", "packageLicense", "registry", "tarball",
                               "integrity", "shasum", "tarballSha256", "tarballBytes", "registrySignature")},
        "retrievedAt": (lock or {}).get("retrievedAt") or _dt.date.today().isoformat(),
        "lastVerifiedAt": _dt.date.today().isoformat(),
        "model": {
            "name": "Kokoro-82M v1.0 (quantized ONNX export)",
            "author": "hexgrad",
            "license": "Apache-2.0",
            "file": model["dest"],
            "sha256": model["sha256"],
            "bytes": model["bytes"],
            "believedToMatch": "onnx-community/Kokoro-82M-v1.0-ONNX onnx/model_quantized.onnx (same byte size)",
        },
        "voices": sorted(v for v in voices if v not in missing_voices),
        "missingVoices": missing_voices,
        "files": files,
        "upstreamComparison": {
            "performed": False,
            "reason": "huggingface.co and github.com downloads are blocked (HTTP 403) by this "
                      "environment's egress proxy, so the file hashes could not be compared with "
                      "hexgrad/Kokoro-82M or onnx-community/Kokoro-82M-v1.0-ONNX. Only the model "
                      "byte size was compared.",
            "todo": "When huggingface.co is reachable, compare model.sha256 with the LFS sha256 of "
                    "onnx-community/Kokoro-82M-v1.0-ONNX onnx/model_quantized.onnx and each voice file "
                    "with voices/<voice>.bin there.",
        },
        "notes": [
            size_note,
            "expo-kokoro's own code is MIT (Dane Madsen). The model weights and voice styles it "
            "bundles are Kokoro-82M v1.0 by hexgrad, Apache-2.0. See LICENSES/.",
        ],
    }
    if asr:
        new_lock["asr"] = asr
    LOCK_PATH.write_text(json.dumps(new_lock, indent=2) + "\n")
    log(f"wrote {LOCK_PATH.relative_to(HERE)}")
    if missing_voices:
        log(f"voices missing from the package: {', '.join(missing_voices)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
