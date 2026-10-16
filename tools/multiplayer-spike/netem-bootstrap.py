"""Extract a user-local QEMU/Alpine test environment; never install host drivers.

Windows Python 3.10 (msilib), Windows tar/expand. Download sources are the QEMU
Windows maintainer linked by qemu.org, official 7-Zip, and Alpine CDN.
"""
import concurrent.futures
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

CACHE = Path(os.environ["LOCALAPPDATA"]) / "carwars-netem"
QEMU_URL = "https://qemu.weilnetz.de/w64/qemu-w64-setup-20260811.exe"
QEMU_SHA512 = "5bcf9eed634e8575a37b74f445af41a2fe4106da512d0c30c368301d4c105037fdfab40a5287367a28a957624cddebbc8c07e16c88ab6634f554cdf3d16bf543"
ZIP_URL = "https://github.com/ip7z/7zip/releases/download/26.04/7z2604-x64.msi"
ALPINE_URL = "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/alpine-virt-3.22.6-x86_64.iso"


def download(url):
    target = CACHE / url.rsplit("/", 1)[1]
    if not target.exists():
        temp = target.with_suffix(target.suffix + ".part")
        print("Download", url, flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, temp.open("wb") as out:
            while data := response.read(1024 * 1024):
                out.write(data)
        temp.replace(target)
    return target


def check(path, expected, algorithm):
    actual = hashlib.new(algorithm, path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch: {path.name}")
    print("Verified", path.name, algorithm, actual, flush=True)


def extract_msi(msi):
    import msilib
    directory = CACHE / "7zip"
    directory.mkdir(exist_ok=True)
    if (directory / "7z.exe").exists():
        return directory / "7z.exe"
    db = msilib.OpenDatabase(str(msi), msilib.MSIDBOPEN_READONLY)
    view = db.OpenView("SELECT `Name`, `Data` FROM `_Streams`")
    view.Execute(None)
    while row := view.Fetch():
        name = row.GetString(1)
        if name.lower().endswith(".cab"):
            cab = CACHE / "7zip.cab"
            cab.write_bytes(read_msi_stream(msi, name))
            subprocess.run(["expand.exe", "-F:*", str(cab), str(directory)], check=True,
                           stdout=subprocess.DEVNULL)
    # CAB filenames are File-table keys, not necessarily the long installed names.
    view = db.OpenView("SELECT `File`, `FileName` FROM `File`")
    view.Execute(None)
    while row := view.Fetch():
        key, filename = row.GetString(1), row.GetString(2).split("|")[-1]
        source = directory / key
        target = directory / filename
        if source.exists() and source != target:
            source.replace(target)
    if not (directory / "7z.exe").exists():
        raise RuntimeError("Could not extract 7-Zip console executable")
    return directory / "7z.exe"


def read_msi_stream(path, name):
    # Python's _msi exposes SetStream but not GetStream; use the read-only API.
    api = ctypes.WinDLL("msi")
    handle = ctypes.c_uint
    api.MsiOpenDatabaseW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.POINTER(handle)]
    api.MsiDatabaseOpenViewW.argtypes = [handle, ctypes.c_wchar_p, ctypes.POINTER(handle)]
    api.MsiViewExecute.argtypes = [handle, handle]
    api.MsiViewFetch.argtypes = [handle, ctypes.POINTER(handle)]
    api.MsiRecordReadStream.argtypes = [handle, ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint)]
    handles = []
    def checked(code):
        if code:
            raise RuntimeError(f"MSI read-only API failed: {code}")
    try:
        db = handle(); checked(api.MsiOpenDatabaseW(str(path), None, ctypes.byref(db))); handles.append(db)
        view = handle()
        query = "SELECT `Data` FROM `_Streams` WHERE `Name`='" + name.replace("'", "''") + "'"
        checked(api.MsiDatabaseOpenViewW(db, query, ctypes.byref(view))); handles.append(view)
        checked(api.MsiViewExecute(view, 0))
        record = handle(); checked(api.MsiViewFetch(view, ctypes.byref(record))); handles.append(record)
        chunks = []
        while True:
            buffer = ctypes.create_string_buffer(65536); size = ctypes.c_uint(len(buffer))
            checked(api.MsiRecordReadStream(record, 1, buffer, ctypes.byref(size)))
            if size.value == 0:
                return b"".join(chunks)
            chunks.append(buffer.raw[:size.value])
    finally:
        for h in reversed(handles):
            api.MsiCloseHandle(h)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        qemu, msi, iso = list(executor.map(download, [QEMU_URL, ZIP_URL, ALPINE_URL]))
    check(qemu, QEMU_SHA512, "sha512")
    expected = urllib.request.urlopen(ALPINE_URL + ".sha256", timeout=30).read().decode().split()[0]
    check(iso, expected, "sha256")
    seven = extract_msi(msi)
    qemu_dir = CACHE / "qemu"
    if not (qemu_dir / "qemu-system-x86_64.exe").exists():
        subprocess.run([str(seven), "x", "-y", f"-o{qemu_dir}", str(qemu)],
                       check=True, stdout=subprocess.DEVNULL)
    boot = CACHE / "alpine"
    if not (boot / "boot/vmlinuz-virt").exists():
        subprocess.run([str(seven), "x", "-y", f"-o{boot}", str(iso), "boot/*"],
                       check=True, stdout=subprocess.DEVNULL)
    executable = qemu_dir / "qemu-system-x86_64.exe"
    subprocess.run([str(executable), "--version"], check=True)
    node_url = "https://nodejs.org/dist/v22.23.3/win-x64/node.exe"
    node_dir = CACHE / "node22"
    node_dir.mkdir(exist_ok=True)
    node = node_dir / "node.exe"
    if not node.exists():
        with urllib.request.urlopen(node_url, timeout=60) as source, node.open("wb") as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)
    sums = urllib.request.urlopen("https://nodejs.org/dist/v22.23.3/SHASUMS256.txt", timeout=30).read().decode()
    node_sum = next(line.split()[0] for line in sums.splitlines() if line.endswith("win-x64/node.exe"))
    check(node, node_sum, "sha256")
    subprocess.run([str(node), "--version"], check=True)
    manifest = {"qemu": str(executable), "kernel": str(boot / "boot/vmlinuz-virt"),
                "initrd": str(boot / "boot/initramfs-virt"), "iso": str(iso),
                "sources": [QEMU_URL, ZIP_URL, ALPINE_URL], "qemuSha512": QEMU_SHA512,
                "alpineSha256": expected, "nodeLts": str(node), "nodeSha256": node_sum}
    (CACHE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
    print("Environment extracted under", CACHE, flush=True)


if __name__ == "__main__":
    main()
