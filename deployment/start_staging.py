"""Create only the empty private volume directory, then drop container root.

The application and state-import commands run as uid/gid 10001. This small
entrypoint never recursively chmods/chowns imported financial history or keys.
"""

import os
from pathlib import Path
import stat
import sys


def main():
    state = Path("/var/data/memy")
    if os.geteuid() == 0:
        # A Docker volume may be mounted root-owned even though the image's
        # directory was prepared for the runtime user.
        parent = state.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode):
            raise ValueError
        try:
            state.mkdir(mode=0o700)
        except FileExistsError:
            pass
        info = state.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 10001)
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError
        os.chown(state, 10001, 10001, follow_symlinks=False)
        os.setgroups([])
        os.setgid(10001)
        os.setuid(10001)
    os.umask(0o077)
    os.execv(sys.executable, [sys.executable, "/app/backend/scripts/run_staging.py", *sys.argv[1:]])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError):
        print("Staging volume preparation failed.", file=sys.stderr)
        raise SystemExit(2)
