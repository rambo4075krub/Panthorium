"""Apply Linux native-decoder limits in a fresh process, never in a server thread."""
import os
import resource
import sys


def main():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Cloud credentials and application secrets are not needed by a decoder.
    environment = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C",
                   "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}
    os.execvpe("ffmpeg", ["ffmpeg", *sys.argv[1:]], environment)


if __name__ == "__main__":
    main()
