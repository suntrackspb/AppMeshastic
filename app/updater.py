"""Self-update via GitHub Releases.

Flow:
  1. check_for_update() — async, returns (tag, download_url) or None
  2. download_and_apply(tag, url) — downloads new binary, replaces self, restarts

Self-replace strategy:
  - macOS/Linux: os.replace() works on running files → replace → os.execv()
  - Windows: write a .bat script that waits for our PID to exit, then replaces
"""

import logging
import os
import platform
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from packaging.version import Version

from . import __version__

logger = logging.getLogger("app.updater")

GITHUB_REPO = "suntrackspb/AppMeshastic"

pending_update: tuple[str, str] | None = None
RELEASES_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

_PLATFORM_ASSET: dict[str, str] = {
    "darwin-arm64": "AppMeshastic-macos-arm64",
    "darwin-x86_64": "AppMeshastic-macos-x86_64",
    "linux-x86_64": "AppMeshastic-linux-x86_64",
    "windows-AMD64": "AppMeshastic-windows-x64.exe",
}


def _asset_name() -> str:
    system = sys.platform  # "darwin", "linux", "win32"
    machine = platform.machine()  # "arm64", "x86_64", "AMD64"
    key = f"{'darwin' if system == 'darwin' else 'linux' if system == 'linux' else 'windows'}-{machine}"
    return _PLATFORM_ASSET.get(key, "")


async def check_for_update() -> Optional[tuple[str, str]]:
    """Return (tag, download_url) if a newer release exists, else None."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(RELEASES_API, headers={"Accept": "application/vnd.github+json"})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.debug("Update check failed: %s", exc)
        return None

    tag: str = data.get("tag_name", "")
    remote_version = tag.lstrip("v")
    try:
        if Version(remote_version) <= Version(__version__):
            return None
    except Exception:
        return None

    asset_name = _asset_name()
    if not asset_name:
        logger.warning("No asset mapping for this platform, skipping update")
        return None

    for asset in data.get("assets", []):
        if asset["name"] == asset_name:
            return tag, asset["browser_download_url"]

    logger.debug("Asset '%s' not found in release %s", asset_name, tag)
    return None


async def download_and_apply(tag: str, url: str) -> None:
    """Download new binary, replace self, restart process."""
    current_exe = Path(sys.executable if getattr(sys, "frozen", False) else sys.argv[0]).resolve()
    logger.info("Downloading update %s from %s", tag, url)

    tmp_dir = Path(tempfile.mkdtemp(prefix="appmeshastic_update_"))
    new_bin = tmp_dir / current_exe.name

    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                with new_bin.open("wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        f.write(chunk)

        logger.info("Download complete: %s", new_bin)

        if sys.platform != "win32":
            _apply_unix(current_exe, new_bin)
        else:
            _apply_windows(current_exe, new_bin)

    except Exception:
        logger.exception("Update failed")
        raise


def _apply_unix(current_exe: Path, new_bin: Path) -> None:
    new_bin.chmod(new_bin.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    backup = current_exe.with_suffix(".old")
    os.replace(current_exe, backup)
    try:
        os.replace(new_bin, current_exe)
    except Exception:
        os.replace(backup, current_exe)  # restore
        raise
    backup.unlink(missing_ok=True)
    logger.info("Replaced binary, restarting...")
    os.execv(str(current_exe), sys.argv)


def _apply_windows(current_exe: Path, new_bin: Path) -> None:
    bat = Path(tempfile.mktemp(suffix=".bat"))
    pid = os.getpid()
    bat.write_text(
        f'@echo off\n'
        f':wait\n'
        f'tasklist /fi "PID eq {pid}" | find "{pid}" >nul && timeout /t 1 /nobreak >nul && goto wait\n'
        f'move /y "{new_bin}" "{current_exe}"\n'
        f'start "" "{current_exe}"\n'
        f'del "%~f0"\n',
        encoding="utf-8",
    )
    subprocess.Popen(
        ["cmd", "/c", str(bat)],
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )
    logger.info("Launched updater script, exiting for replacement...")
    sys.exit(0)
