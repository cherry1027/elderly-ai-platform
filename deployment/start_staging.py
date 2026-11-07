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
    def __init__(self, stage, error):
        self.diagnostic = {
            "event": "staging_volume_preparation", "ok": False, "stage": stage,
            "kind": "os-error" if isinstance(error, OSError) else "validation-error",
            "errno": error.errno if isinstance(error, OSError) and isinstance(error.errno, int) else None,
            "euid": os.geteuid(), "egid": os.getegid(),
        }
        super().__init__("Staging volume preparation failed.")


def main():
    stage = "entry"
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
                raise ValueError
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
        raise StagingBootFailure(stage, error) from None


def run():
    try:
        main()
        return 0
    except StagingBootFailure as error:
        print(json.dumps(error.diagnostic, sort_keys=True), file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
