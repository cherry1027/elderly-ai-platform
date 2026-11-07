"""Prepare only the private volume directory, then drop container root.

The application and state-import commands run as uid/gid 10001. This small
entrypoint never recursively chmods/chowns imported financial history or keys.
Boot diagnostics contain only fixed stages and numeric OS metadata, never paths
or exception messages. They do not change or bypass any preparation check.
"""

import json
import os
from pathlib import Path
import stat
import sys


class StagingBootFailure(Exception):
    def __init__(self, stage, error, info=None):
        self.diagnostic = {
            "event": "staging_volume_preparation", "ok": False, "stage": stage,
            "kind": "os-error" if isinstance(error, OSError) else "validation-error",
            "errno": error.errno if isinstance(error, OSError) and isinstance(error.errno, int) else None,
            "euid": os.geteuid(), "egid": os.getegid(),
        }
        if info is not None:
            self.diagnostic.update(is_directory=stat.S_ISDIR(info.st_mode), uid=info.st_uid, mode=stat.S_IMODE(info.st_mode))
        super().__init__("Staging volume preparation failed.")


def main():
    stage = "entry"
    info = None
    try:
        state = Path("/var/data/memy")
        if os.geteuid() == 0:
            # A Docker volume may be mounted root-owned even though the image's
            # directory was prepared for the runtime user.
            stage = "parent-lstat"
            parent = state.parent.lstat()
            stage = "parent-validation"
            if not stat.S_ISDIR(parent.st_mode):
                raise ValueError
            stage = "state-mkdir"
            try:
                state.mkdir(mode=0o700)
            except FileExistsError:
                pass
            stage = "state-lstat"
            info = state.lstat()
            stage = "state-validation"
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 10001)
                    or stat.S_IMODE(info.st_mode) != 0o700):
                # A platform-created EMPTY directory may have a different uid
                # or mode. Claim only this exact directory during explicit
                # AI-off provisioning; never repair populated/imported state.
                if (not stat.S_ISDIR(info.st_mode)
                        or os.environ.get("STAGING_BOOTSTRAP_AI_OFF") != "true"
                        or os.environ.get("STAGING_ENABLE_REAL_AI") != "false"
                        or os.environ.get("REAL_AI_ENABLED") != "false"):
                    raise ValueError
                stage = "bootstrap-open"
                descriptor = os.open(state, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    stage = "bootstrap-identity"
                    opened = os.fstat(descriptor)
                    if (not stat.S_ISDIR(opened.st_mode)
                            or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino)):
                        raise ValueError
                    stage = "bootstrap-empty"
                    if os.listdir(descriptor):
                        raise ValueError
                    stage = "bootstrap-mode"
                    os.fchmod(descriptor, 0o700)
                    stage = "bootstrap-owner"
                    os.fchown(descriptor, 10001, 10001)
                    stage = "bootstrap-recheck"
                    changed = os.fstat(descriptor)
                    info = state.lstat()
                    if (not stat.S_ISDIR(info.st_mode)
                            or (info.st_dev, info.st_ino) != (changed.st_dev, changed.st_ino)
                            or (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino)
                            or info.st_uid != 10001 or info.st_gid != 10001
                            or stat.S_IMODE(info.st_mode) != 0o700
                            or os.listdir(descriptor)):
                        raise ValueError
                finally:
                    os.close(descriptor)
            stage = "state-chown"
            os.chown(state, 10001, 10001, follow_symlinks=False)
            stage = "drop-supplementary-groups"
            os.setgroups([])
            stage = "drop-gid"
            os.setgid(10001)
            stage = "drop-uid"
            os.setuid(10001)
        stage = "private-umask"
        os.umask(0o077)
        stage = "exec-launcher"
        os.execv(sys.executable, [sys.executable, "/app/backend/scripts/run_staging.py", *sys.argv[1:]])
    except (OSError, ValueError) as error:
        raise StagingBootFailure(stage, error, info) from None


def run():
    try:
        main()
        return 0
    except StagingBootFailure as error:
        print(json.dumps(error.diagnostic, sort_keys=True), file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
