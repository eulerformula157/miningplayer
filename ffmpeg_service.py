import subprocess


def run_subprocess(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True
        )
    except FileNotFoundError:
        raise RuntimeError(
            "FFmpeg/FFprobe is not installed or not available in PATH."
        )
    except subprocess.CalledProcessError as err:
        details = err.stderr.strip() if err.stderr else str(err)
        raise RuntimeError(details)

