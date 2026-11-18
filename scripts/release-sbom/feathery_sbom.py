#!/usr/bin/env python3
"""Generate, sign and file Feathery release SBOMs.

Vendored into every repository that ships a production artifact. The canonical
copy lives in feathery-terraform at security/release-sbom/tool/; change it
there and copy it out, keeping TOOL_VERSION in step.

Standard library only (Python 3.9+). External programs: syft (downloaded and
checksum-verified here), openssl, and the AWS CLI on laptops for credentials.

Release flow (see security/release-sbom/README.md):
  sign   before the deploy: scan the artifact that ships, finalize and
         validate the SPDX document, sign it with KMS, verify the signature.
         Any failure exits non-zero so the deploy never starts.
  stage  CodePipeline only: park the signed files under pending/ so the
         post-rollout action, which runs on another machine, can file them.
  file   after the rollout has finished in every region: verify again and
         write the release folder, named by the current UTC time.
  find   which builds were live at a time, optionally searching a package.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

TOOL_VERSION = "1.2.1"

REGION = "us-west-1"
ACCOUNT_ID = "737208625848"
BUCKET = "feathery-release-sboms"
KEY_ID = "alias/feathery-sbom-signing"
SIGNER_ROLE_ARN = f"arn:aws:iam::{ACCOUNT_ID}:role/feathery-sbom-signer"

SUPPLIER = "Organization: Feathery, Inc."
NAMESPACE_BASE = "https://sbom.feathery.io/spdx"

SYFT_VERSION = "1.55.0"
SYFT_SHA256 = {
    "darwin/amd64": "e2e5831cbabaec9a36fe65c34755c1113982c842a685edce3ce0b54a0ded8003",
    "darwin/arm64": "1217c258bd5eb91ef3189cf22a82e02f9cac07e4ce934350f428e93aff674625",
    "linux/amd64": "bb65249542db5fedeeb4d3f9b018b75e7264dbfbbb10486f044581a92f90490d",
    "linux/arm64": "929bd163db2d7cd2255d3bcb8967208079813d7b46b0c952f7b794d8e2c7d304",
}

# What syft reads for each kind of artifact. Directory scans name their
# catalogers explicitly: the defaults also read lockfiles and GitHub workflow
# files, which describe things that do not ship.
PROFILES = {
    "node-installed": ["--override-default-catalogers", "javascript-package-cataloger"],
    "node-lockfile": ["--override-default-catalogers", "javascript-lock-cataloger"],
    # Bundled code (lockfile production dependencies) plus dependencies installed
    # next to the bundle, for builds that inline most code and install externals.
    "node-bundle": [
        "--override-default-catalogers",
        "javascript-lock-cataloger,javascript-package-cataloger",
    ],
    "python-installed": [
        "--override-default-catalogers",
        "python-installed-package-cataloger",
    ],
    "image": [
        "--select-catalogers",
        "-github-actions-usage-cataloger,-github-action-workflow-usage-cataloger",
    ],
}

SBOM_FILE = "sbom.spdx.json"
SIG_FILE = "sbom.spdx.json.sig"
BUILD_FILE = "build.json"
FILES = (SBOM_FILE, SIG_FILE, BUILD_FILE)
RELEASE_KEY = re.compile(
    r"^(?P<prefix>sboms(?:-test)?)/service=(?P<service>[^/]+)"
    r"/year=(?P<Y>\d{4})/month=(?P<m>\d{2})/day=(?P<d>\d{2})"
    r"/hour=(?P<H>\d{2})/minute=(?P<M>\d{2})/second=(?P<S>\d{2})/(?P<file>[^/]+)$"
)
# syft's installed-node cataloger reads every package.json, including test
# fixtures and sub-entry manifests inside packages; only package roots ship.
NODE_MANIFEST_SOURCE = "installed node module manifest file: "
NODE_PACKAGE_ROOT = re.compile(
    r"(?:^|/)node_modules/(?:@[^/]+/)?[^/@][^/]*/package\.json$"
)
UNKNOWN_VERSIONS = ("", "UNKNOWN", "NOASSERTION")
COMPONENT_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


class SbomError(Exception):
    pass


def log(message):
    print(f"[release-sbom] {message}", file=sys.stderr, flush=True)


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------- AWS access


class Credentials:
    def __init__(self, access_key, secret_key, token=None, source=""):
        self.access_key = access_key
        self.secret_key = secret_key
        self.token = token
        self.source = source


def _http(method, url, headers=None, body=None, timeout=60):
    request = urllib.request.Request(
        url, data=body, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def _sign_v4(method, url, service, credentials, headers, body):
    """Return headers signed with AWS Signature Version 4."""
    parsed = urllib.parse.urlsplit(url)
    moment = datetime.datetime.now(datetime.timezone.utc)
    amz_date = moment.strftime("%Y%m%dT%H%M%SZ")
    date = moment.strftime("%Y%m%d")
    payload_hash = sha256_bytes(body or b"")

    signed = dict((k.lower(), v.strip()) for k, v in headers.items())
    signed["host"] = parsed.netloc
    signed["x-amz-date"] = amz_date
    signed["x-amz-content-sha256"] = payload_hash
    if credentials.token:
        signed["x-amz-security-token"] = credentials.token

    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted(query)
    )
    names = sorted(signed)
    canonical_headers = "".join(f"{name}:{signed[name]}\n" for name in names)
    signed_names = ";".join(names)
    canonical_request = "\n".join(
        [
            method,
            parsed.path or "/",
            canonical_query,
            canonical_headers,
            signed_names,
            payload_hash,
        ]
    )
    scope = f"{date}/{REGION}/{service}/aws4_request"
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, sha256_bytes(canonical_request.encode())]
    )

    key = ("AWS4" + credentials.secret_key).encode()
    for part in (date, REGION, service, "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    signed["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={credentials.access_key}/{scope}, "
        f"SignedHeaders={signed_names}, Signature={signature}"
    )
    del signed["host"]
    return signed


def aws_request(method, url, service, credentials, headers=None, body=None):
    signed = _sign_v4(method, url, service, credentials, headers or {}, body)
    last = None
    for attempt in range(4):
        status, response_headers, data = _http(method, url, signed, body)
        if status < 500 and status != 429:
            return status, response_headers, data
        last = (status, data)
        time.sleep(2**attempt)
        signed = _sign_v4(method, url, service, credentials, headers or {}, body)
    return last[0], {}, last[1]


def _sts_credentials(xml_body, source):
    root = ET.fromstring(xml_body)
    found = {}
    for element in root.iter():
        tag = element.tag.split("}")[-1]
        if tag in ("AccessKeyId", "SecretAccessKey", "SessionToken"):
            found[tag] = element.text
    if len(found) != 3:
        raise SbomError("STS response did not contain credentials")
    return Credentials(
        found["AccessKeyId"], found["SecretAccessKey"], found["SessionToken"], source
    )


def _session_name(context):
    raw = f"sbom-{context}"
    return re.sub(r"[^A-Za-z0-9+=,.@_-]", "-", raw)[:64]


def base_credentials():
    """Credentials of whatever is running the tool, before assuming the signer."""
    explicit = os.environ.get("SBOM_SIGNER_AWS_ACCESS_KEY_ID")
    if explicit:
        return Credentials(
            explicit,
            os.environ["SBOM_SIGNER_AWS_SECRET_ACCESS_KEY"],
            None,
            "sbom-signer user",
        )

    relative = os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
    full = os.environ.get("AWS_CONTAINER_CREDENTIALS_FULL_URI")
    if relative or full:
        url = full or "http://169.254.170.2" + relative
        headers = {}
        token = os.environ.get("AWS_CONTAINER_AUTHORIZATION_TOKEN")
        token_file = os.environ.get("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE")
        if token_file:
            with open(token_file, encoding="utf-8") as handle:
                token = handle.read().strip()
        if token:
            headers["Authorization"] = token
        status, _, data = _http("GET", url, headers)
        if status != 200:
            raise SbomError(f"container credentials endpoint returned {status}")
        values = json.loads(data)
        return Credentials(
            values["AccessKeyId"],
            values["SecretAccessKey"],
            values.get("Token"),
            "container",
        )

    if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"):
        return Credentials(
            os.environ["AWS_ACCESS_KEY_ID"],
            os.environ["AWS_SECRET_ACCESS_KEY"],
            os.environ.get("AWS_SESSION_TOKEN"),
            "env",
        )

    if shutil.which("aws"):
        result = subprocess.run(
            ["aws", "configure", "export-credentials", "--format", "process"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            values = json.loads(result.stdout)
            return Credentials(
                values["AccessKeyId"],
                values["SecretAccessKey"],
                values.get("SessionToken"),
                "aws cli",
            )
        raise SbomError(
            f"could not read AWS credentials from the AWS CLI: {result.stderr.strip()}"
        )
    raise SbomError("no AWS credentials found")


def signer_credentials(context):
    """Assume feathery-sbom-signer from whichever release path is running."""
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if request_url and request_token:
        audience_url = (
            request_url
            + ("&" if "?" in request_url else "?")
            + "audience=sts.amazonaws.com"
        )
        status, _, data = _http(
            "GET", audience_url, {"Authorization": "Bearer " + request_token}
        )
        if status != 200:
            raise SbomError(f"GitHub OIDC token request failed with {status}")
        token = json.loads(data)["value"]
        body = urllib.parse.urlencode(
            {
                "Action": "AssumeRoleWithWebIdentity",
                "Version": "2011-06-15",
                "RoleArn": SIGNER_ROLE_ARN,
                "RoleSessionName": _session_name(context),
                "WebIdentityToken": token,
                "DurationSeconds": "3600",
            }
        ).encode()
        status, _, data = _http(
            "POST",
            f"https://sts.{REGION}.amazonaws.com/",
            {"Content-Type": "application/x-www-form-urlencoded"},
            body,
        )
        if status != 200:
            raise SbomError(
                f"GitHub Actions could not assume the signer role ({status}). "
                "Production signing works only from the default branch. "
                f"{data.decode(errors='replace')[:300]}"
            )
        return _sts_credentials(data, "github oidc")

    base = base_credentials()
    body = urllib.parse.urlencode(
        {
            "Action": "AssumeRole",
            "Version": "2011-06-15",
            "RoleArn": SIGNER_ROLE_ARN,
            "RoleSessionName": _session_name(context),
            "DurationSeconds": "3600",
        }
    ).encode()
    status, _, data = aws_request(
        "POST",
        f"https://sts.{REGION}.amazonaws.com/",
        "sts",
        base,
        {"Content-Type": "application/x-www-form-urlencoded"},
        body,
    )
    if status != 200:
        raise SbomError(
            f"could not assume {SIGNER_ROLE_ARN} with {base.source} credentials "
            f"({status}): {data.decode(errors='replace')[:300]}"
        )
    return _sts_credentials(data, base.source + " -> signer")


def kms_call(credentials, target, payload):
    body = json.dumps(payload).encode()
    status, _, data = aws_request(
        "POST",
        f"https://kms.{REGION}.amazonaws.com/",
        "kms",
        credentials,
        {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "TrentService." + target,
        },
        body,
    )
    if status != 200:
        raise SbomError(
            f"KMS {target} failed ({status}): {data.decode(errors='replace')[:300]}"
        )
    return json.loads(data)


def s3_url(key, query=""):
    path = "/" + urllib.parse.quote(key, safe="/-_.~")
    suffix = f"?{query}" if query else ""
    return f"https://{BUCKET}.s3.{REGION}.amazonaws.com{path}{suffix}"


def s3_put(credentials, key, data, content_type, create_only):
    headers = {"Content-Type": content_type}
    if create_only:
        headers["If-None-Match"] = "*"
    status, _, body = aws_request("PUT", s3_url(key), "s3", credentials, headers, data)
    if status == 412:
        return False
    if status != 200:
        raise SbomError(
            f"S3 PUT {key} failed ({status}): {body.decode(errors='replace')[:300]}"
        )
    return True


def s3_get(credentials, key):
    status, _, body = aws_request("GET", s3_url(key), "s3", credentials)
    if status in (403, 404):
        raise SbomError(
            f"s3://{BUCKET}/{key} does not exist (or is not readable): HTTP {status}"
        )
    if status != 200:
        raise SbomError(f"S3 GET {key} failed ({status})")
    return body


def s3_list(credentials, prefix, delimiter=None):
    keys, prefixes, token = [], [], None
    while True:
        params = [("list-type", "2"), ("prefix", prefix)]
        if delimiter:
            params.append(("delimiter", delimiter))
        if token:
            params.append(("continuation-token", token))
        query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        status, _, body = aws_request(
            "GET",
            f"https://{BUCKET}.s3.{REGION}.amazonaws.com/?{query}",
            "s3",
            credentials,
        )
        if status != 200:
            raise SbomError(f"S3 list {prefix} failed ({status})")
        root = ET.fromstring(body)
        ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
        keys += [element.text for element in root.iter(ns + "Key")]
        prefixes += [
            element.text
            for element in root.iter(ns + "Prefix")
            if element.text != prefix
        ]
        token_element = root.find(ns + "NextContinuationToken")
        if token_element is None:
            return keys, prefixes
        token = token_element.text


# ---------------------------------------------------------------- syft


def _platform():
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }.get(machine)
    if f"{system}/{arch}" not in SYFT_SHA256:
        raise SbomError(f"unsupported platform {system}/{machine}")
    return system, arch


def install_syft():
    system, arch = _platform()
    cache = os.path.join(
        os.environ.get("SBOM_CACHE_DIR")
        or os.path.join(os.path.expanduser("~"), ".cache", "feathery-sbom"),
        f"syft-{SYFT_VERSION}-{system}-{arch}",
    )
    binary = os.path.join(cache, "syft")
    if os.path.exists(binary):
        return binary
    name = f"syft_{SYFT_VERSION}_{system}_{arch}.tar.gz"
    url = f"https://github.com/anchore/syft/releases/download/v{SYFT_VERSION}/{name}"
    data = None
    for attempt in range(4):
        status, _, body = _http("GET", url, timeout=120)
        if status == 200:
            data = body
            break
        time.sleep(2**attempt)
    if data is None:
        raise SbomError(f"could not download {url}")
    if sha256_bytes(data) != SYFT_SHA256[f"{system}/{arch}"]:
        raise SbomError(f"syft download checksum mismatch for {name}")
    os.makedirs(cache, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        archive = os.path.join(scratch, name)
        with open(archive, "wb") as handle:
            handle.write(data)
        with tarfile.open(archive) as tar:
            member = tar.getmember("syft")
            if hasattr(tarfile, "data_filter"):
                tar.extract(member, scratch, filter="data")
            else:
                tar.extract(member, scratch)
        os.chmod(os.path.join(scratch, "syft"), 0o755)
        os.replace(os.path.join(scratch, "syft"), binary)
    return binary


def run_syft(source, profile, component, version, output):
    if profile not in PROFILES:
        raise SbomError(f"unknown profile {profile}")
    syft = install_syft()
    env = dict(
        os.environ,
        SYFT_CHECK_FOR_APP_UPDATE="false",
        SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES="false",
    )
    command = [syft, "scan", source, "-o", f"spdx-json={output}", "-q"] + PROFILES[
        profile
    ]
    command += ["--source-name", component, "--source-version", version]
    log(f"scanning {source} with {profile}")
    result = subprocess.run(
        command, env=env, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise SbomError(
            f"syft failed: {(result.stderr.strip() or result.stdout.strip())[-2000:]}"
        )


# ---------------------------------------------------------------- SPDX


def _purl(package):
    for ref in package.get("externalRefs") or []:
        if ref.get("referenceType") == "purl":
            return ref.get("referenceLocator")
    return None


def _stray_node_manifest(package):
    source = package.get("sourceInfo") or ""
    if NODE_MANIFEST_SOURCE not in source:
        return False
    path = source.split(NODE_MANIFEST_SOURCE, 1)[1].strip()
    # syft uses the same wording for lockfile entries, which are real dependencies.
    if not path.endswith("package.json"):
        return False
    return path != "/package.json" and not NODE_PACKAGE_ROOT.search(path)


def finalize(
    doc, component, version, first_party, source_description, artifact_sha256=None
):
    """Make syft's document a Feathery SBOM: author, root identity, suppliers."""
    doc["name"] = f"{component}@{version}"
    doc["documentNamespace"] = f"{NAMESPACE_BASE}/{component}/{version}/{uuid.uuid4()}"
    creation = doc.setdefault("creationInfo", {})
    tools = [c for c in creation.get("creators", []) if c.startswith("Tool:")]
    creation["creators"] = [SUPPLIER] + tools + [f"Tool: feathery-sbom-{TOOL_VERSION}"]
    creation["comment"] = (
        f"Generated at build time from the artifact that ships: {source_description}."
    )

    roots = set(
        r["relatedSpdxElement"]
        for r in doc.get("relationships", [])
        if r.get("relationshipType") == "DESCRIBES"
        and r.get("spdxElementId") == "SPDXRef-DOCUMENT"
    )
    kept = []
    for package in doc.get("packages", []):
        # GitHub Actions references found in workflow files never ship.
        if (_purl(package) or "").startswith("pkg:github/"):
            continue
        if package["SPDXID"] not in roots and _stray_node_manifest(package):
            continue
        if package["SPDXID"] in roots:
            package["name"] = component
            package["versionInfo"] = version
            package["supplier"] = SUPPLIER
            package["downloadLocation"] = (
                package.get("downloadLocation") or "NOASSERTION"
            )
            refs = [
                r
                for r in package.get("externalRefs") or []
                if r.get("referenceType") != "purl"
            ]
            refs.append(
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": f"pkg:generic/feathery/{component}@{version}",
                }
            )
            package["externalRefs"] = refs
            if artifact_sha256:
                package["checksums"] = [
                    {"algorithm": "SHA256", "checksumValue": artifact_sha256}
                ]
        elif package.get("name") == component or any(
            package.get("name", "").startswith(p) for p in first_party
        ):
            package["supplier"] = SUPPLIER
        elif not package.get("supplier"):
            # Unknown is stated explicitly, never guessed (CISA 2026 minimum elements).
            package["supplier"] = "NOASSERTION"
        kept.append(package)
    removed = set(p["SPDXID"] for p in doc.get("packages", [])) - set(
        p["SPDXID"] for p in kept
    )
    doc["packages"] = kept
    doc["relationships"] = [
        r
        for r in doc.get("relationships", [])
        if r.get("spdxElementId") not in removed
        and r.get("relatedSpdxElement") not in removed
    ]
    return doc


def validate(doc, component, version, min_packages, required):
    """Deterministic gate: a document that fails here is never signed."""
    problems = []

    def need(condition, message):
        if not condition:
            problems.append(message)

    need(doc.get("spdxVersion") == "SPDX-2.3", "spdxVersion must be SPDX-2.3")
    need(doc.get("dataLicense") == "CC0-1.0", "dataLicense must be CC0-1.0")
    need(doc.get("SPDXID") == "SPDXRef-DOCUMENT", "document SPDXID")
    need(
        str(doc.get("documentNamespace", "")).startswith(NAMESPACE_BASE + "/"),
        "documentNamespace",
    )
    creation = doc.get("creationInfo") or {}
    need(bool(creation.get("created")), "creationInfo.created (timestamp)")
    need(
        SUPPLIER in (creation.get("creators") or []),
        "SBOM author must be Feathery, Inc.",
    )
    need(
        any(c.startswith("Tool: syft") for c in creation.get("creators") or []),
        "SBOM tool name",
    )

    relationships = doc.get("relationships") or []
    root_ids = set(
        r["relatedSpdxElement"]
        for r in relationships
        if r.get("relationshipType") == "DESCRIBES"
    )
    packages = doc.get("packages") or []
    roots = [p for p in packages if p["SPDXID"] in root_ids]
    need(len(roots) == 1, f"exactly one described root package, found {len(roots)}")
    for root in roots:
        need(root.get("name") == component, f"root name must be {component}")
        need(root.get("versionInfo") == version, f"root version must be {version}")
        need(root.get("supplier") == SUPPLIER, "root supplier must be Feathery, Inc.")

    components = [p for p in packages if p["SPDXID"] not in root_ids]
    need(
        len(components) >= min_packages,
        f"expected at least {min_packages} components, found {len(components)}",
    )
    need(
        any(r.get("relationshipType") != "DESCRIBES" for r in relationships),
        "dependency relationships",
    )
    for package in packages:
        label = f"{package.get('name')} ({package.get('SPDXID')})"
        need(bool(package.get("name")), f"{label}: name")
        need(package.get("versionInfo") not in UNKNOWN_VERSIONS, f"{label}: version")
        need(bool(package.get("supplier")), f"{label}: supplier (or NOASSERTION)")
        need(bool(package.get("downloadLocation")), f"{label}: downloadLocation")
        need(bool(_purl(package)), f"{label}: purl")

    names = {}
    for package in components:
        names.setdefault(package.get("name", "").lower(), []).append(
            package.get("versionInfo", "")
        )
    for requirement in required:
        # NAME or NAME@VERSION_REGEX; a leading "@" belongs to a scoped npm name.
        at = requirement.find("@", 1)
        name, version_pattern = (
            (requirement, "") if at < 0 else (requirement[:at], requirement[at + 1 :])
        )
        versions = names.get(name.lower())
        if not versions:
            problems.append(f"required component {name} is missing")
        elif version_pattern and not any(
            re.fullmatch(version_pattern, v) for v in versions
        ):
            problems.append(
                f"required component {name} has version {versions}, "
                f"expected {version_pattern}"
            )
    if problems:
        raise SbomError("SBOM validation failed:\n  - " + "\n  - ".join(problems[:50]))
    return len(components)


def serialize(doc):
    return (
        json.dumps(doc, indent=2, sort_keys=False, ensure_ascii=False) + "\n"
    ).encode("utf-8")


# ---------------------------------------------------------------- signatures


def public_key_pem(der):
    body = base64.b64encode(der).decode()
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    return (
        "-----BEGIN PUBLIC KEY-----\n"
        + "\n".join(lines)
        + "\n-----END PUBLIC KEY-----\n"
    )


def openssl_verify(data, signature_b64, pem):
    with tempfile.TemporaryDirectory() as scratch:
        paths = {
            name: os.path.join(scratch, name) for name in ("data", "sig", "key.pem")
        }
        with open(paths["data"], "wb") as handle:
            handle.write(data)
        with open(paths["sig"], "wb") as handle:
            handle.write(base64.b64decode(signature_b64))
        with open(paths["key.pem"], "w", encoding="utf-8") as handle:
            handle.write(pem)
        result = subprocess.run(
            [
                "openssl",
                "dgst",
                "-sha256",
                "-verify",
                paths["key.pem"],
                "-signature",
                paths["sig"],
                paths["data"],
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode == 0 and "Verified OK" in result.stdout


def fetch_public_key(credentials):
    response = kms_call(credentials, "GetPublicKey", {"KeyId": KEY_ID})
    der = base64.b64decode(response["PublicKey"])
    return response["KeyId"], public_key_pem(der), sha256_bytes(der)


def kms_sign(credentials, data):
    digest = base64.b64encode(hashlib.sha256(data).digest()).decode()
    response = kms_call(
        credentials,
        "Sign",
        {
            "KeyId": KEY_ID,
            "Message": digest,
            "MessageType": "DIGEST",
            "SigningAlgorithm": "ECDSA_SHA_256",
        },
    )
    return response["Signature"]


# ---------------------------------------------------------------- context


def git_state(path):
    if not shutil.which("git"):
        return None, None
    inside = subprocess.run(
        ["git", "-C", path, "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if inside.returncode != 0:
        return None, None
    status = subprocess.run(
        ["git", "-C", path, "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=False,
    )
    return inside.stdout.strip(), bool(status.stdout.strip())


def build_context():
    env = os.environ
    if env.get("CODEBUILD_BUILD_ID"):
        return {
            "system": "codebuild",
            "id": env["CODEBUILD_BUILD_ID"],
            "initiator": env.get("CODEBUILD_INITIATOR"),
        }
    if env.get("GITHUB_ACTIONS") == "true":
        run = (
            f"{env.get('GITHUB_SERVER_URL')}/{env.get('GITHUB_REPOSITORY')}"
            f"/actions/runs/{env.get('GITHUB_RUN_ID')}"
        )
        return {
            "system": "github-actions",
            "id": run,
            "actor": env.get("GITHUB_ACTOR"),
            "ref": env.get("GITHUB_REF"),
        }
    if env.get("NETLIFY") == "true":
        return {
            "system": "netlify",
            "id": env.get("DEPLOY_ID"),
            "site": env.get("SITE_NAME"),
            "context": env.get("CONTEXT"),
        }
    if env.get("CODEPIPELINE_EXECUTION_ID"):
        return {"system": "codepipeline", "id": env.get("CODEPIPELINE_EXECUTION_ID")}
    return {"system": "laptop", "id": None, "actor": env.get("USER")}


# ---------------------------------------------------------------- commands


def command_sign(args):
    if not COMPONENT_NAME.match(args.component):
        raise SbomError("component must be lowercase letters, digits and dashes")
    commit, dirty = git_state(args.git_dir or ".")
    if args.require_clean_git:
        if commit is None:
            raise SbomError("production deploys must run from a git checkout")
        if dirty:
            raise SbomError(
                "Production deploys need a clean commit. "
                "Commit or stash your changes, then rerun the deploy."
            )
    version = args.version or commit
    if not version:
        raise SbomError("pass --version (the commit being released)")

    artifact_sha256 = args.artifact_sha256
    if args.artifact_file:
        artifact_sha256 = sha256_file(args.artifact_file)

    os.makedirs(args.out, exist_ok=True)
    raw = os.path.join(args.out, "syft.spdx.json")
    run_syft(args.source, args.profile, args.component, version, raw)
    with open(raw, encoding="utf-8") as handle:
        doc = json.load(handle)
    os.remove(raw)
    source_description = (
        args.describe or f"{args.source} scanned with the {args.profile} profile"
    )
    finalize(
        doc,
        args.component,
        version,
        args.first_party or [],
        source_description,
        artifact_sha256,
    )
    count = validate(
        doc, args.component, version, args.min_packages, args.require or []
    )
    data = serialize(doc)

    context = build_context()
    credentials = signer_credentials(f"{args.component}-{context.get('system')}")
    key_arn, pem, fingerprint = fetch_public_key(credentials)
    signature = kms_sign(credentials, data)
    if not openssl_verify(data, signature, pem):
        raise SbomError(
            "the new signature did not verify with the signing key's public key"
        )
    if openssl_verify(data + b" ", signature, pem):
        raise SbomError("signature verification accepted modified content")

    with open(os.path.join(args.out, SBOM_FILE), "wb") as handle:
        handle.write(data)
    with open(os.path.join(args.out, SIG_FILE), "w", encoding="utf-8") as handle:
        handle.write(signature + "\n")
    build = {
        "schema": 1,
        "component": args.component,
        "version": version,
        "commit": commit or version,
        "git_dirty": dirty,
        "source": source_description,
        "artifact_sha256": artifact_sha256,
        "build": context,
        "sbom_sha256": sha256_bytes(data),
        "components": count,
        "signature": {
            "algorithm": "ECDSA_P256_SHA256",
            "key": key_arn,
            "public_key_sha256": fingerprint,
        },
        "tools": {"syft": SYFT_VERSION, "feathery_sbom": TOOL_VERSION},
        "signed_at": iso(utcnow()),
    }
    with open(os.path.join(args.out, BUILD_FILE), "w", encoding="utf-8") as handle:
        json.dump(build, handle, indent=2)
        handle.write("\n")
    log(
        f"signed {args.component}@{version}: {count} components, "
        f"sbom sha256 {build['sbom_sha256']}"
    )


def _read_local(directory):
    result = {}
    for name in FILES:
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            raise SbomError(
                f"{name} is missing from {directory}; did the sign step run?"
            )
        with open(path, "rb") as handle:
            result[name] = handle.read()
    return result


def _pending_prefix(pending_id):
    if not re.match(r"^[a-z0-9-]+/[A-Za-z0-9-]+$", pending_id or ""):
        raise SbomError("pending id must look like <component>/<pipeline-execution-id>")
    return f"pending/{pending_id}/"


def command_stage(args):
    files = _read_local(args.out)
    credentials = signer_credentials("stage")
    prefix = _pending_prefix(args.pending_id)
    for name in FILES:
        s3_put(
            credentials,
            prefix + name,
            files[name],
            "application/json",
            create_only=False,
        )
    log(f"staged signed SBOM at s3://{BUCKET}/{prefix}")


def release_prefix(root, component, moment):
    return (
        f"{root}/service={component}/year={moment:%Y}/month={moment:%m}/day={moment:%d}"
        f"/hour={moment:%H}/minute={moment:%M}/second={moment:%S}/"
    )


def command_file(args):
    credentials = signer_credentials("file")
    if args.pending_id:
        prefix = _pending_prefix(args.pending_id)
        files = dict((name, s3_get(credentials, prefix + name)) for name in FILES)
    else:
        files = _read_local(args.out)
    build = json.loads(files[BUILD_FILE])
    if sha256_bytes(files[SBOM_FILE]) != build["sbom_sha256"]:
        raise SbomError("SBOM bytes do not match build.json")
    _, pem, fingerprint = fetch_public_key(credentials)
    if fingerprint != build["signature"]["public_key_sha256"]:
        raise SbomError(
            "SBOM was signed with a different key than the current signing key"
        )
    if not openssl_verify(files[SBOM_FILE], files[SIG_FILE].decode().strip(), pem):
        raise SbomError("signature does not verify; refusing to file")

    root = "sboms-test" if args.dry_run else "sboms"
    for _ in range(5):
        moment = utcnow()
        build["filed_at"] = iso(moment)
        build["filed_by"] = build_context()
        if args.regions:
            build["regions"] = args.regions
        prefix = release_prefix(root, build["component"], moment)
        if s3_put(
            credentials,
            prefix + SBOM_FILE,
            files[SBOM_FILE],
            "application/spdx+json",
            create_only=True,
        ):
            break
        time.sleep(1.1)
    else:
        raise SbomError("could not claim a release folder")
    s3_put(
        credentials, prefix + SIG_FILE, files[SIG_FILE], "text/plain", create_only=True
    )
    data = (json.dumps(build, indent=2) + "\n").encode()
    s3_put(credentials, prefix + BUILD_FILE, data, "application/json", create_only=True)
    print(f"s3://{BUCKET}/{prefix}")
    log(f"filed {build['component']}@{build['version']} at s3://{BUCKET}/{prefix}")


def _parse_time(value):
    text = value.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    moment = datetime.datetime.fromisoformat(text)
    if moment.tzinfo is None:
        raise SbomError("give --at with a timezone, for example 2026-11-18T13:05:26Z")
    return moment.astimezone(datetime.timezone.utc)


def command_find(args):
    credentials = base_credentials()
    at = _parse_time(args.at) if args.at else utcnow()
    root = "sboms-test" if args.dry_run else "sboms"
    _, service_prefixes = s3_list(credentials, root + "/", "/")
    services = sorted(
        p.split("service=", 1)[1].rstrip("/")
        for p in service_prefixes
        if "service=" in p
    )
    if args.service:
        services = [s for s in services if s in args.service]
    rows = []
    for service in services:
        keys, _ = s3_list(credentials, f"{root}/service={service}/")
        live_at, live_folder = None, None
        for key in keys:
            match = RELEASE_KEY.match(key)
            if not match or match.group("file") != BUILD_FILE:
                continue
            moment = datetime.datetime(
                *(int(match.group(g)) for g in ("Y", "m", "d", "H", "M", "S")),
                tzinfo=datetime.timezone.utc,
            )
            if moment <= at and (live_at is None or moment > live_at):
                live_at, live_folder = moment, key.rsplit("/", 1)[0] + "/"
        if live_at is None:
            rows.append({"service": service, "live_since": None})
            continue
        build = json.loads(s3_get(credentials, live_folder + BUILD_FILE))
        row = {
            "service": service,
            "live_since": iso(live_at),
            "version": build["version"],
            "folder": live_folder,
        }
        if args.package:
            doc = json.loads(s3_get(credentials, live_folder + SBOM_FILE))
            wanted = args.package.lower()
            row["matches"] = sorted(
                set(
                    f"{p.get('name')}@{p.get('versionInfo')}"
                    for p in doc.get("packages", [])
                    if p.get("name", "").lower() == wanted
                )
            )
        rows.append(row)
    print(
        json.dumps({"at": iso(at), "package": args.package, "services": rows}, indent=2)
    )


def command_verify(args):
    def read(path):
        with open(path, "rb") as handle:
            return handle.read()

    sbom = read(args.sbom or os.path.join(args.dir, SBOM_FILE))
    signature = (
        read(args.signature or os.path.join(args.dir, SIG_FILE)).decode().strip()
    )
    pem = read(args.public_key).decode()
    if not openssl_verify(sbom, signature, pem):
        raise SbomError("signature does NOT verify")
    print("Verified OK")


def parser():
    root = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    root.add_argument("--version", action="version", version=TOOL_VERSION)
    sub = root.add_subparsers(dest="command", required=True)

    sign = sub.add_parser(
        "sign", help="scan, finalize, validate and sign (before the deploy)"
    )
    sign.add_argument(
        "--component",
        required=True,
        help="archive service name, for example ai-services",
    )
    sign.add_argument(
        "--source",
        required=True,
        help="syft source: dir:PATH, docker:IMAGE, oci-archive:PATH",
    )
    sign.add_argument("--profile", required=True, choices=sorted(PROFILES))
    sign.add_argument(
        "--version", dest="version", help="release version; defaults to the git commit"
    )
    sign.add_argument(
        "--git-dir",
        help="checkout whose commit is released (default: current directory)",
    )
    sign.add_argument(
        "--require-clean-git",
        action="store_true",
        help="refuse uncommitted changes (laptop deploys)",
    )
    sign.add_argument(
        "--first-party",
        action="append",
        help="package-name prefix that Feathery supplies",
    )
    sign.add_argument(
        "--require",
        action="append",
        help="component that must be present, NAME or NAME@VERSION_REGEX",
    )
    sign.add_argument("--min-packages", type=int, default=1)
    sign.add_argument(
        "--artifact-file", help="the shipped artifact file; its sha256 is recorded"
    )
    sign.add_argument(
        "--artifact-sha256",
        help="sha256 of the shipped artifact when there is no single file",
    )
    sign.add_argument("--describe", help="one-line description of what was scanned")
    sign.add_argument("--out", required=True, help="directory for the signed files")
    sign.set_defaults(func=command_sign)

    stage = sub.add_parser("stage", help="park signed files for a later pipeline stage")
    stage.add_argument("--out", required=True)
    stage.add_argument(
        "--pending-id", required=True, help="<component>/<pipeline-execution-id>"
    )
    stage.set_defaults(func=command_stage)

    file_ = sub.add_parser(
        "file", help="file a signed SBOM once the rollout has finished"
    )
    source = file_.add_mutually_exclusive_group(required=True)
    source.add_argument("--out", help="directory written by sign")
    source.add_argument(
        "--pending-id", help="<component>/<pipeline-execution-id> written by stage"
    )
    file_.add_argument(
        "--regions",
        nargs="+",
        help="regions this run deployed, for releases that roll out one region per run",
    )
    file_.add_argument(
        "--dry-run",
        action="store_true",
        help="file under sboms-test/ instead of sboms/",
    )
    file_.set_defaults(func=command_file)

    find = sub.add_parser(
        "find", help="which builds were live at a time, optionally searching a package"
    )
    find.add_argument(
        "--at", help="UTC time, for example 2026-11-18T13:05:26Z (default: now)"
    )
    find.add_argument(
        "--package", help="package name to search for, for example lodash"
    )
    find.add_argument("--service", action="append", help="limit to these services")
    find.add_argument(
        "--dry-run", action="store_true", help="search sboms-test/ instead of sboms/"
    )
    find.set_defaults(func=command_find)

    verify = sub.add_parser(
        "verify", help="verify a signed SBOM with a public key (offline)"
    )
    verify.add_argument(
        "--dir", default=".", help="folder containing sbom.spdx.json and its .sig"
    )
    verify.add_argument("--sbom")
    verify.add_argument("--signature")
    verify.add_argument("--public-key", required=True)
    verify.set_defaults(func=command_verify)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        args.func(args)
    except SbomError as error:
        log(f"ERROR: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
